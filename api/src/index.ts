import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { maxBid, validateBid, ROSTER_SIZE, slotLabelRank } from '@pennant/domain';
import {
  bearer, createSession, destroySession, hashPassword, requireAuth, requireCommissioner, verifyPassword, userForToken,
} from './auth';
import type { AppVars, Env } from './types';
import type { DraftEvent } from './draft-room';

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
  const { results } = await c.env.DB.prepare(
    `SELECT rs.slot, p.id AS playerId, p.name, p.mlb_team AS mlbTeam, p.pos, p.pos2,
            (SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = p.id AND pp.season = ?1) AS positions,
            k.year AS keeperYear, ds.price
       FROM roster_slot rs
       JOIN player p ON p.id = rs.player_id
       LEFT JOIN keeper k ON k.season = rs.season AND k.player_id = p.id
       LEFT JOIN draft_sale ds ON ds.season = rs.season AND ds.player_id = p.id
      WHERE rs.season = ?1 AND rs.team_id = ?2`,
  ).bind(yr, c.req.param('id')).all<{ slot: string; positions: string | null; pos: string; pos2: string | null }>();
  const slots = results
    .map((r) => ({ ...r, positions: (r.positions ?? [r.pos, r.pos2].filter(Boolean).join(',')).split(',').filter(Boolean) }))
    .sort((a, b) => slotLabelRank(a.slot) - slotLabelRank(b.slot));
  return c.json({ season: yr, teamId: c.req.param('id'), slots });
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
    `SELECT ds.seq, ds.player_id AS playerId, p.name, ds.team_id AS teamId, ds.price, ds.is_keeper AS isKeeper
       FROM draft_sale ds JOIN player p ON p.id = ds.player_id WHERE ds.season = ? ORDER BY ds.seq`,
  ).bind(yr).all();
  const hat = await (await room(env).fetch('https://room/hat')).json<{ mlbTeam: string | null }>();
  return {
    season: yr,
    hat: hat.mlbTeam,
    managers: money.map((m) => ({ ...m, remaining: 300 - m.spent, maxBid: maxBid(m.spent, m.filled), spots: ROSTER_SIZE - m.filled })),
    sales,
  };
}

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

export default app;
