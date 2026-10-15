import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  MAX_KEEPERS, assignSlots, keeperCost, keeperTier, maxBid, validateBid, ROSTER_SIZE, slotLabelRank,
} from '@pennant/domain';
import {
  bearer, createSession, destroySession, hashPassword, requireAuth, requireCommissioner, verifyPassword, userForToken,
} from './auth';
import type { AppVars, Env } from './types';
import type { DraftEvent } from './draft-room';
import { registerLeague } from './league';
import { registerLineup } from './lineup';
import { loadRoster } from './roster';

export { DraftRoom } from './draft-room';

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();
app.use('*', cors());

const DEFAULT_SEASON = 2026;
const season = (q: string | undefined) => (q && /^\d{4}$/.test(q) ? Number(q) : DEFAULT_SEASON);

const room = (env: Env) => env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName('league'));
const broadcast = (env: Env, ev: DraftEvent) =>
  room(env).fetch('https://room/broadcast', { method: 'POST', body: JSON.stringify(ev) });

app.get('/', (c) => c.json({ ok: true, service: 'pennant-race-api' }));

// ------------------------------------------------------------------ auth
app.post('/auth/register', async (c) => {
  const { email, password, teamId, joinCode } = await c.req.json<{ email: string; password: string; teamId: string; joinCode: string }>();
  if (!c.env.JOIN_CODE || joinCode !== c.env.JOIN_CODE) return c.json({ error: 'Invalid league join code' }, 403);
  if (!email || !password || password.length < 8) return c.json({ error: 'Email and a password of 8+ characters required' }, 400);
  const team = await c.env.DB.prepare('SELECT id FROM team WHERE id = ?').bind(teamId).first();
  if (!team) return c.json({ error: 'Unknown team' }, 400);
  const taken = await c.env.DB.prepare('SELECT 1 FROM user WHERE team_id = ?').bind(teamId).first();
  if (taken) return c.json({ error: 'That team already has an owner account' }, 409);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare('INSERT INTO user (id, email, password_hash, team_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, email.trim().toLowerCase(), await hashPassword(password), teamId, Date.now()).run();
  } catch {
    return c.json({ error: 'Email already registered' }, 409);
  }
  return c.json({ token: await createSession(c.env.DB, id) }, 201);
});

app.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const row = await c.env.DB.prepare('SELECT id, password_hash FROM user WHERE email = ?')
    .bind((email ?? '').trim().toLowerCase()).first<{ id: string; password_hash: string }>();
  // Same error for unknown email and bad password.
  if (!row || !(await verifyPassword(password ?? '', row.password_hash))) return c.json({ error: 'Invalid email or password' }, 401);
  return c.json({ token: await createSession(c.env.DB, row.id) });
});

app.post('/auth/logout', async (c) => {
  const t = bearer(c);
  if (t) await destroySession(c.env.DB, t);
  return c.json({ ok: true });
});

app.get('/me', requireAuth, async (c) => {
  const u = c.get('user');
  const team = u.teamId ? await c.env.DB.prepare('SELECT * FROM team WHERE id = ?').bind(u.teamId).first() : null;
  return c.json({ user: u, team });
});

// Needed by the sign-up screen before anyone is logged in; exposes only public team info.
app.get('/public/teams', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.owner_name AS owner, EXISTS(SELECT 1 FROM user u WHERE u.team_id = t.id) AS claimed
       FROM team t ORDER BY t.name`,
  ).all();
  return c.json(results);
});

// ------------------------------------------------------------------ read APIs
app.get('/teams', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, owner_name AS owner, name, color, logo_key AS logoKey, faab FROM team ORDER BY name').all();
  return c.json(results);
});

app.get('/teams/:id/roster', requireAuth, async (c) => {
  const yr = season(c.req.query('season'));
  return c.json({ season: yr, teamId: c.req.param('id'), slots: await loadRoster(c.env, yr, c.req.param('id') as string) });
});

app.get('/mlb-teams', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT abbr, name, logo, color, color2 FROM mlb_team ORDER BY name').all();
  return c.json(results);
});

// ------------------------------------------------------------------ draft
async function draftState(env: Env, yr: number) {
  const { results: money } = await env.DB.prepare(
    `SELECT t.id AS teamId, COALESCE(SUM(ds.price), 0) AS spent, COUNT(ds.id) AS filled
       FROM team t LEFT JOIN draft_sale ds ON ds.team_id = t.id AND ds.season = ?1 GROUP BY t.id`,
  ).bind(yr).all<{ teamId: string; spent: number; filled: number }>();
  const { results: sales } = await env.DB.prepare(
    `SELECT ds.seq, ds.player_id AS playerId, p.name, ds.team_id AS teamId, ds.price, ds.is_keeper AS isKeeper,
            k.year AS keeperYear, rs.slot
       FROM draft_sale ds JOIN player p ON p.id = ds.player_id
       LEFT JOIN keeper k ON k.season = ds.season AND k.player_id = ds.player_id
       LEFT JOIN roster_slot rs ON rs.season = ds.season AND rs.player_id = ds.player_id
      WHERE ds.season = ? ORDER BY ds.seq`,
  ).bind(yr).all();
  const hat = await (await room(env).fetch('https://room/hat')).json<{ mlbTeam: string | null }>();
  return {
    season: yr,
    hat: hat.mlbTeam,
    managers: money.map((m) => ({ ...m, remaining: 300 - m.spent, maxBid: maxBid(m.spent, m.filled), spots: ROSTER_SIZE - m.filled })),
    sales,
  };
}

app.get('/seasons', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT year, status FROM season ORDER BY year DESC').all();
  return c.json(results);
});

// "Push to next season": archives the live season (freezing its rosters), then opens the next one with
// last season's eligible positions carried over. Rosters are materialised from the draft sales; in-season
// adds/drops will write roster_slot directly once transactions exist.
app.post('/seasons/push', requireAuth, requireCommissioner, async (c) => {
  const live = await liveSeason(c.env);
  const latest = await c.env.DB.prepare('SELECT MAX(year) AS y FROM season').first<{ y: number | null }>();
  if (latest?.y == null) return c.json({ error: 'No seasons to push from' }, 409);
  const next = latest.y + 1;
  const stmts: D1PreparedStatement[] = [];
  if (live != null) {
    const { results: sales } = await c.env.DB.prepare(
      `SELECT ds.team_id AS teamId, ds.player_id AS playerId, ds.seq,
              COALESCE((SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = ds.player_id AND pp.season = ds.season),
                       p.pos || COALESCE(',' || p.pos2, '')) AS positions
         FROM draft_sale ds JOIN player p ON p.id = ds.player_id
        WHERE ds.season = ? AND NOT EXISTS (SELECT 1 FROM roster_slot rs WHERE rs.season = ds.season AND rs.player_id = ds.player_id)
        ORDER BY ds.seq`,
    ).bind(live).all<{ teamId: string; playerId: number; seq: number; positions: string }>();
    const used = await c.env.DB.prepare('SELECT team_id AS teamId, slot FROM roster_slot WHERE season = ?').bind(live).all<{ teamId: string; slot: string }>();
    const byTeam = new Map<string, typeof sales>();
    for (const r of sales) byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r]);
    for (const [teamId, rows] of byTeam) {
      const taken = used.results.filter((u) => u.teamId === teamId).map((u, i) => ({ playerId: -1 - i, positions: [] as string[], slot: u.slot }));
      const slots = assignSlots([...taken, ...rows.map((r) => ({ playerId: r.playerId, positions: r.positions.split(','), slot: null }))]);
      for (const r of rows) {
        const slot = slots.get(r.playerId);
        if (slot) stmts.push(c.env.DB.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(live, teamId, r.playerId, slot));
      }
    }
    stmts.push(c.env.DB.prepare("UPDATE season SET status = 'archived' WHERE year = ?").bind(live));
  }
  stmts.push(c.env.DB.prepare("INSERT INTO season (year, status) VALUES (?, 'live')").bind(next));
  stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO player_position (player_id, season, position) SELECT player_id, ?, position FROM player_position WHERE season = ?').bind(next, latest.y));
  await c.env.DB.batch(stmts);
  await broadcast(c.env, { type: 'keepers', season: next });
  return c.json({ year: next }, 201);
});

// ------------------------------------------------------------------ keepers
type Cand = {
  teamId: string; playerId: number; name: string; mlbTeam: string | null; pos: string; pos2: string | null;
  yearsKept: number | null; lastPrice: number | null; avgSalary: number | null;
};

async function keeperView(env: Env, yr: number) {
  const status = await env.DB.prepare('SELECT status FROM season WHERE year = ?').bind(yr).first<{ status: string }>();
  const { results: kept } = await env.DB.prepare(
    `SELECT k.team_id AS teamId, k.player_id AS playerId, p.name, p.mlb_team AS mlbTeam, p.pos, k.year, k.cost
       FROM keeper k JOIN player p ON p.id = k.player_id WHERE k.season = ? ORDER BY k.cost DESC`,
  ).bind(yr).all<{ teamId: string; playerId: number }>();
  let candidates: ReturnType<typeof mapCand>[] = [];
  if (status?.status === 'live') {
    const prior = await env.DB.prepare('SELECT MAX(year) AS y FROM season WHERE year < ?').bind(yr).first<{ y: number | null }>();
    if (prior?.y != null) {
      const { results } = await env.DB.prepare(
        `SELECT rs.team_id AS teamId, p.id AS playerId, p.name, p.mlb_team AS mlbTeam, p.pos, p.pos2,
                k.year AS yearsKept, ds.price AS lastPrice, pv.avg_salary AS avgSalary
           FROM roster_slot rs
           JOIN player p ON p.id = rs.player_id
           LEFT JOIN keeper k ON k.season = rs.season AND k.player_id = p.id
           LEFT JOIN draft_sale ds ON ds.season = rs.season AND ds.player_id = p.id
           LEFT JOIN player_value pv ON pv.season = ?1 AND pv.player_id = p.id
          WHERE rs.season = ?2`,
      ).bind(yr, prior.y).all<Cand>();
      candidates = results.map(mapCand);
    }
  }
  const keptIds = new Set(kept.map((k) => k.playerId));
  const auction = status?.status === 'live'
    ? !!(await env.DB.prepare('SELECT 1 FROM draft_sale WHERE season = ? AND is_keeper = 0 LIMIT 1').bind(yr).first())
    : true;
  return {
    season: yr, status: status?.status ?? null, max: MAX_KEEPERS, locked: auction, kept,
    candidates: candidates.map((c) => ({ ...c, kept: keptIds.has(c.playerId) })),
  };
}

// Rollover rules live in @pennant/domain: Y2 -> not eligible, Y1 -> Year 2, everyone else -> Year 1.
function mapCand(c: Cand) {
  const history = { yearsKept: (c.yearsKept ?? 0) as 0 | 1 | 2, lastPrice: c.lastPrice, avgSalary: c.avgSalary };
  return {
    teamId: c.teamId, playerId: c.playerId, name: c.name, mlbTeam: c.mlbTeam, pos: c.pos,
    positions: [c.pos, c.pos2].filter(Boolean) as string[],
    tier: keeperTier(history), cost: keeperCost(history), lastPrice: c.lastPrice, avgSalary: c.avgSalary,
  };
}

app.get('/keepers', requireAuth, async (c) => {
  const yr = c.req.query('season') ? season(c.req.query('season')) : (await liveSeason(c.env)) ?? DEFAULT_SEASON;
  return c.json(await keeperView(c.env, yr));
});

app.put('/keepers', requireAuth, async (c) => {
  const u = c.get('user');
  const { teamId, playerId, kept } = await c.req.json<{ teamId: string; playerId: number; kept: boolean }>();
  if (!u.isCommissioner && u.teamId !== teamId) return c.json({ error: 'You can only edit your own keepers' }, 403);
  const yr = await liveSeason(c.env);
  if (yr == null) return c.json({ error: 'No live season' }, 409);
  const view = await keeperView(c.env, yr);
  if (view.locked) return c.json({ error: 'The auction has started; keepers are locked' }, 409);

  if (!kept) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM keeper WHERE season = ? AND team_id = ? AND player_id = ?').bind(yr, teamId, playerId),
      c.env.DB.prepare('DELETE FROM draft_sale WHERE season = ? AND team_id = ? AND player_id = ? AND is_keeper = 1').bind(yr, teamId, playerId),
    ]);
  } else {
    const cand = view.candidates.find((x) => x.teamId === teamId && x.playerId === playerId);
    if (!cand) return c.json({ error: 'Player was not on this team at the end of last season' }, 400);
    if (cand.tier === 0) return c.json({ error: 'Kept two years running; he returns to the draft' }, 400);
    if (cand.cost == null) return c.json({ error: 'Set the ESPN average salary first' }, 400);
    if (cand.kept) return c.json({ ok: true });
    const mine = view.kept.filter((k) => k.teamId === teamId).length;
    if (mine >= MAX_KEEPERS) return c.json({ error: `At most ${MAX_KEEPERS} keepers per team` }, 400);
    const money = await c.env.DB.prepare('SELECT COALESCE(SUM(price), 0) AS spent, COUNT(*) AS filled FROM draft_sale WHERE season = ? AND team_id = ?')
      .bind(yr, teamId).first<{ spent: number; filled: number }>();
    const check = validateBid(cand.cost, money?.spent ?? 0, money?.filled ?? 0);
    if (!check.ok) return c.json({ error: check.reason }, 400);
    const seq = ((await c.env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM draft_sale WHERE season = ?').bind(yr).first<{ s: number }>())?.s ?? 0) + 1;
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO keeper (season, team_id, player_id, year, cost) VALUES (?, ?, ?, ?, ?)').bind(yr, teamId, playerId, cand.tier, cand.cost),
      c.env.DB.prepare('INSERT INTO draft_sale (season, player_id, team_id, price, seq, is_keeper) VALUES (?, ?, ?, ?, ?, 1)').bind(yr, playerId, teamId, cand.cost, seq),
    ]);
  }
  await broadcast(c.env, { type: 'keepers', season: yr });
  return c.json({ ok: true });
});

app.put('/player-values', requireAuth, requireCommissioner, async (c) => {
  const { playerId, avgSalary } = await c.req.json<{ playerId: number; avgSalary: number }>();
  const yr = await liveSeason(c.env);
  if (yr == null) return c.json({ error: 'No live season' }, 409);
  if (!Number.isFinite(avgSalary) || avgSalary < 0) return c.json({ error: 'Invalid salary' }, 400);
  const view = await keeperView(c.env, yr);
  const cand = view.candidates.find((x) => x.playerId === playerId);
  if (cand?.kept) return c.json({ error: 'Un-keep him before changing his cost' }, 409);
  await c.env.DB.prepare('INSERT INTO player_value (season, player_id, avg_salary) VALUES (?, ?, ?) ON CONFLICT(season, player_id) DO UPDATE SET avg_salary = excluded.avg_salary')
    .bind(yr, playerId, avgSalary).run();
  await broadcast(c.env, { type: 'keepers', season: yr });
  return c.json({ ok: true });
});

// Player pool for the draft board. Eligible positions come from player_position for that season,
// falling back to the player's listed positions (a new season has none until the stats feed fills it).
app.get('/draft/players', requireAuth, async (c) => {
  const yr = season(c.req.query('season'));
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.mlb_team AS mlbTeam, p.pos, p.pos2,
            (SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = p.id AND pp.season = ?) AS positions
       FROM player p ORDER BY p.name`,
  ).bind(yr).all<{ pos: string; pos2: string | null; positions: string | null }>();
  return c.json(results.map((r) => ({
    ...r,
    positions: (r.positions ?? [r.pos, r.pos2].filter(Boolean).join(',')).split(',').filter(Boolean),
  })));
});

app.get('/draft/state', requireAuth, async (c) => c.json(await draftState(c.env, season(c.req.query('season')))));

app.get('/draft/ws', async (c) => {
  // Browsers can't set headers on WebSockets, so the token rides in the query string.
  const token = c.req.query('token');
  if (!token || !(await userForToken(c.env.DB, token))) return c.text('Unauthorized', 401);
  return room(c.env).fetch(new Request('https://room/ws', c.req.raw));
});

app.post('/draft/hat', requireAuth, requireCommissioner, async (c) => {
  const { mlbTeam } = await c.req.json<{ mlbTeam: string | null }>();
  await broadcast(c.env, { type: 'hat', mlbTeam });
  return c.json({ ok: true });
});

app.post('/draft/sales', requireAuth, requireCommissioner, async (c) => {
  const { playerId, teamId, price } = await c.req.json<{ playerId: number; teamId: string; price: number }>();
  const yr = await liveSeason(c.env);
  if (yr == null) return c.json({ error: 'No live season; push the new season first' }, 409);

  const money = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(price), 0) AS spent, COUNT(*) AS filled FROM draft_sale WHERE season = ? AND team_id = ?',
  ).bind(yr, teamId).first<{ spent: number; filled: number }>();
  const check = validateBid(price, money?.spent ?? 0, money?.filled ?? 0);
  if (!check.ok) return c.json({ error: check.reason }, 400);

  const last = await c.env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM draft_sale WHERE season = ?').bind(yr).first<{ seq: number }>();
  const seq = (last?.seq ?? 0) + 1;
  try {
    await c.env.DB.prepare('INSERT INTO draft_sale (season, player_id, team_id, price, seq) VALUES (?, ?, ?, ?, ?)')
      .bind(yr, playerId, teamId, price, seq).run();
  } catch {
    return c.json({ error: 'Player already drafted' }, 409);
  }
  await broadcast(c.env, { type: 'sale', season: yr, playerId, teamId, price, seq });
  return c.json({ seq }, 201);
});

app.delete('/draft/sales/last', requireAuth, requireCommissioner, async (c) => {
  const yr = await liveSeason(c.env);
  if (yr == null) return c.json({ error: 'No live season' }, 409);
  const last = await c.env.DB.prepare('SELECT seq FROM draft_sale WHERE season = ? AND is_keeper = 0 ORDER BY seq DESC LIMIT 1').bind(yr).first<{ seq: number }>();
  if (!last) return c.json({ error: 'Nothing to undo' }, 404);
  await c.env.DB.prepare('DELETE FROM draft_sale WHERE season = ? AND seq = ?').bind(yr, last.seq).run();
  await broadcast(c.env, { type: 'undo', season: yr, seq: last.seq });
  return c.json({ ok: true, seq: last.seq });
});

async function liveSeason(env: Env): Promise<number | null> {
  const row = await env.DB.prepare("SELECT year FROM season WHERE status = 'live' ORDER BY year DESC LIMIT 1").first<{ year: number }>();
  return row?.year ?? null;
}

registerLeague(app);
registerLineup(app);

export default app;
