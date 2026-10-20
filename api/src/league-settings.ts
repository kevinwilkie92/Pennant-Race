import type { Hono } from 'hono';
import { DEFAULT_RULES, HIT_LABELS, LIMITS, PIT_LABELS, SCORE_MAX, SCORE_MIN, applyRulesPatch, assignSlots, checkCommissionerChange, rosterLabels, rosterSizeOf, cleanJoinCode, cleanLeagueName, describeRulesChange, generateJoinCode, joinCodeMatches, normalizeRules, scoringChanged, type LeagueRules } from '@pennant/domain';
import { requireAuth, requireCommissioner } from './auth';
import { broadcast } from './realtime';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;
type Settings = { waiverDays?: number; signupsOpen?: boolean; joinCode?: string };

async function load(env: Env): Promise<{ name: string; settings: Settings }> {
  const row = await env.DB.prepare('SELECT name, settings_json AS s FROM league WHERE id = 1').first<{ name: string; s: string }>();
  let settings: Settings = {};
  try { settings = JSON.parse(row?.s ?? '{}'); } catch { /* defaults */ }
  return { name: row?.name ?? 'Pennant Race', settings };
}
const save = (env: Env, settings: Settings) => env.DB.prepare('UPDATE league SET settings_json = ? WHERE id = 1').bind(JSON.stringify(settings));

/** Whether new managers may sign up (existing managers always can sign in). */
export async function signupsOpen(env: Env) { return (await load(env)).settings.signupsOpen !== false; }
/** The code new managers need: the one set in the app, else the server's JOIN_CODE. */
export async function activeJoinCode(env: Env): Promise<{ code: string | null; source: 'app' | 'server' | 'none' }> {
  const { settings } = await load(env);
  if (settings.joinCode) return { code: settings.joinCode, source: 'app' };
  return env.JOIN_CODE ? { code: env.JOIN_CODE, source: 'server' } : { code: null, source: 'none' };
}
/** The shared gate for every way of signing up. Returns an error message (and status) or null if the person may join. */
export async function signupGate(env: Env, givenCode: unknown): Promise<{ error: string; status: 403 } | null> {
  if (!(await signupsOpen(env))) return { error: 'Sign-ups are closed. Ask your commissioner to open them.', status: 403 };
  const { code } = await activeJoinCode(env);
  if (!joinCodeMatches(givenCode, code)) return { error: 'Invalid league join code', status: 403 };
  return null;
}

/** The league's editable rules (scoring, auction, keepers, FAAB, injured list), with defaults filling any gaps. */
export async function loadRules(env: Env): Promise<LeagueRules> {
  const row = await env.DB.prepare('SELECT scoring_json AS s FROM league WHERE id = 1').first<{ s: string }>();
  try { return normalizeRules(JSON.parse(row?.s || '{}')); } catch { return normalizeRules({}); }
}

/** Would these rules break something already in progress? Returns the reason, or null if it is safe. */
async function conflictWith(env: Env, next: LeagueRules): Promise<string | null> {
  const live = (await env.DB.prepare("SELECT year FROM season WHERE status = 'live' ORDER BY year DESC LIMIT 1").first<{ year: number }>())?.year;
  if (live != null) {
    const { results } = await env.DB.prepare(
      `SELECT t.name, COALESCE(SUM(ds.price), 0) AS spent, COUNT(ds.id) AS filled FROM team t LEFT JOIN draft_sale ds ON ds.team_id = t.id AND ds.season = ?1 GROUP BY t.id`,
    ).bind(live).all<{ name: string; spent: number; filled: number }>();
    const size = rosterSizeOf(next.roster);
    for (const t of results) {
      if (t.filled > size) return `${t.name} already has ${t.filled} players, more than a ${size}-player roster`;
      const spots = size - t.filled;
      if (spots <= 0 ? t.spent > next.budget : next.budget - t.spent - (spots - 1) * next.minBid < next.minBid) return `${t.name} has already spent too much to fit a $${next.budget} budget with a $${next.minBid} minimum bid`;
    }
    // Lineups: every stored active slot must still exist, and drafted players not yet seated must all still fit.
    const labels = new Set(rosterLabels(next.roster));
    const stored = (await env.DB.prepare('SELECT x.team_id AS teamId, x.slot, t.name FROM roster_slot x JOIN team t ON t.id = x.team_id WHERE x.season = ?').bind(live).all<{ teamId: string; slot: string; name: string }>()).results;
    const bad = stored.find((r) => !r.slot.startsWith('IL') && !labels.has(r.slot));
    if (bad) return `A player on ${bad.name} is in slot ${bad.slot}, which that layout wouldn't have; move him first`;
    const storedTeams = new Set(stored.map((r) => r.teamId));
    const sales = (await env.DB.prepare(
      `SELECT ds.team_id AS teamId, t.name, ds.player_id AS playerId,
              COALESCE((SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = ds.player_id AND pp.season = ds.season), p.pos || COALESCE(',' || p.pos2, '')) AS positions
         FROM draft_sale ds JOIN player p ON p.id = ds.player_id JOIN team t ON t.id = ds.team_id WHERE ds.season = ? ORDER BY ds.seq`,
    ).bind(live).all<{ teamId: string; name: string; playerId: number; positions: string }>()).results;
    const byTeam = new Map<string, typeof sales>();
    for (const r of sales) if (!storedTeams.has(r.teamId)) byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r]);
    for (const [, rows] of byTeam) {
      const seated = assignSlots(rows.map((r) => ({ playerId: r.playerId, positions: r.positions.split(',').filter(Boolean), slot: null })), next.roster);
      if (seated.size < rows.length) return `${rows[0].name} couldn't seat all ${rows.length} of its drafted players in that layout`;
    }
    const over = await env.DB.prepare('SELECT t.name, COUNT(*) AS n FROM keeper k JOIN team t ON t.id = k.team_id WHERE k.season = ? GROUP BY k.team_id HAVING n > ? LIMIT 1').bind(live, next.maxKeepers).first<{ name: string; n: number }>();
    if (over) return `${over.name} has already kept ${over.n} players, more than ${next.maxKeepers}`;
  }
  const il = await env.DB.prepare("SELECT slot FROM roster_slot WHERE slot GLOB 'IL[0-9]*' AND CAST(SUBSTR(slot, 3) AS INTEGER) > ? LIMIT 1").bind(next.ilSlots).first<{ slot: string }>();
  if (il) return `A player is in ${il.slot}; move him out of the injured list before reducing it to ${next.ilSlots} slot${next.ilSlots === 1 ? '' : 's'}`;
  return null;
}

/** Recomputes every stored game and daily total from the saved stat lines under the current scoring. */
async function rescoreEverything(env: Env, rules: LeagueRules) {
  const sum = (keys: string[]) => keys.map((k) => `COALESCE(json_extract(line_json, '$."${k}"'), 0) * ?`).join(' + ');
  const hk = Object.keys(HIT_LABELS), pk = Object.keys(PIT_LABELS);
  await env.DB.batch([
    env.DB.prepare(`UPDATE player_game SET points = ROUND(${sum(hk)}, 2) WHERE role = 'H'`).bind(...hk.map((k) => rules.hit[k as keyof typeof rules.hit])),
    env.DB.prepare(`UPDATE player_game SET points = ROUND(${sum(pk)}, 2) WHERE role = 'P'`).bind(...pk.map((k) => rules.pit[k as keyof typeof rules.pit])),
    env.DB.prepare('UPDATE daily_points SET points = COALESCE((SELECT ROUND(SUM(g.points), 2) FROM player_game g WHERE g.player_id = daily_points.player_id AND g.date = daily_points.date), points)'),
    env.DB.prepare('DELETE FROM career_cache'),                         // careers are scored on the way in; they'll be recomputed on next view
  ]);
}

async function audit(env: Env, team: string | null, action: string, detail: string) {
  await env.DB.prepare('INSERT INTO league_audit (at, team_id, action, detail) VALUES (?, ?, ?, ?)').bind(Date.now(), team, action, detail).run();
}

export function registerLeagueSettings(app: App) {
  // The login screen shows the league's name before anyone is signed in.
  app.get('/public/league', async (c) => {
    const { name, settings } = await load(c.env);
    return c.json({ name, signupsOpen: settings.signupsOpen !== false });
  });

  app.get('/league/settings', requireAuth, async (c) => {
    const u = c.get('user');
    const { name, settings } = await load(c.env);
    const { results: teams } = await c.env.DB.prepare(
      `SELECT t.id AS teamId, t.name, t.owner_name AS owner, t.is_commissioner AS isCommissioner, EXISTS (SELECT 1 FROM user x WHERE x.team_id = t.id) AS hasAccount
         FROM team t ORDER BY t.is_commissioner DESC, t.name`,
    ).all<{ teamId: string; name: string; owner: string; isCommissioner: number; hasAccount: number }>();
    const season = (await c.env.DB.prepare("SELECT year FROM season ORDER BY (status = 'live') DESC, year DESC LIMIT 1").first<{ year: number }>())?.year ?? null;
    const sched = season == null ? null : await c.env.DB.prepare('SELECT COUNT(*) AS n, MIN(start_date) AS start FROM week WHERE season = ?').bind(season).first<{ n: number; start: string | null }>();
    const out: Record<string, unknown> = {
      name, waiverDays: Number.isInteger(settings.waiverDays) ? settings.waiverDays : 2, signupsOpen: settings.signupsOpen !== false,
      season, schedule: { created: (sched?.n ?? 0) > 0, start: sched?.start ?? null },
      commissioners: teams.map((t) => ({ ...t, isCommissioner: !!t.isCommissioner, hasAccount: !!t.hasAccount })),
    };
    if (u.isCommissioner) {
      const jc = await activeJoinCode(c.env);
      out.joinCode = jc.code; out.joinCodeSource = jc.source;
      out.audit = (await c.env.DB.prepare('SELECT a.id, a.at, a.team_id AS teamId, a.detail FROM league_audit a ORDER BY a.id DESC LIMIT 20').all()).results;
    }
    return c.json(out);
  });

  app.put('/league/settings', requireAuth, requireCommissioner, async (c) => {
    const me = c.get('user');
    const b = await c.req.json<{ name?: unknown; waiverDays?: unknown; signupsOpen?: unknown }>().catch(() => ({} as { name?: unknown; waiverDays?: unknown; signupsOpen?: unknown }));
    const cur = await load(c.env);
    const next: Settings = { ...cur.settings };
    const stmts: D1PreparedStatement[] = [];
    const notes: [string, string][] = [];
    if (b.name === undefined && b.waiverDays === undefined && b.signupsOpen === undefined) return c.json({ error: 'Nothing to change' }, 400);

    if (b.name !== undefined) {
      const n = cleanLeagueName(b.name);
      if (!n.ok) return c.json({ error: n.reason }, 400);
      if (n.name !== cur.name) { stmts.push(c.env.DB.prepare('UPDATE league SET name = ? WHERE id = 1').bind(n.name)); notes.push(['league_renamed', `League renamed from “${cur.name}” to “${n.name}”`]); }
    }
    if (b.waiverDays !== undefined) {
      if (!(Number.isInteger(b.waiverDays) && (b.waiverDays as number) >= 0 && (b.waiverDays as number) <= 14)) return c.json({ error: 'Waiver period must be 0–14 days' }, 400);
      if (b.waiverDays !== (cur.settings.waiverDays ?? 2)) { next.waiverDays = b.waiverDays as number; notes.push(['waiver_days', `Waiver period set to ${b.waiverDays} day${b.waiverDays === 1 ? '' : 's'}`]); }
    }
    if (b.signupsOpen !== undefined) {
      if (typeof b.signupsOpen !== 'boolean') return c.json({ error: 'signupsOpen must be true or false' }, 400);
      if (b.signupsOpen !== (cur.settings.signupsOpen !== false)) { next.signupsOpen = b.signupsOpen; notes.push(['signups', b.signupsOpen ? 'Sign-ups opened' : 'Sign-ups closed']); }
    }
    if (JSON.stringify(next) !== JSON.stringify(cur.settings)) stmts.push(save(c.env, next));
    if (stmts.length) await c.env.DB.batch(stmts);
    for (const [a, d] of notes) await audit(c.env, me.teamId, a, `${d} by ${await teamName(c.env, me.teamId)}`);
    if (notes.length) await broadcast(c.env, { type: 'league' });
    const after = await load(c.env);
    return c.json({ name: after.name, waiverDays: after.settings.waiverDays ?? 2, signupsOpen: after.settings.signupsOpen !== false });
  });

  // Set a custom join code, or (no body) make a fresh random one. The old code stops working at once.
  app.post('/league/join-code', requireAuth, requireCommissioner, async (c) => {
    const me = c.get('user');
    const b = await c.req.json<{ code?: unknown }>().catch(() => ({} as { code?: unknown }));
    let code: string;
    if (b.code === undefined) code = generateJoinCode(crypto.getRandomValues(new Uint8Array(8)));
    else { const v = cleanJoinCode(b.code); if (!v.ok) return c.json({ error: v.reason }, 400); code = v.code; }
    const cur = await load(c.env);
    await save(c.env, { ...cur.settings, joinCode: code }).run();
    await audit(c.env, me.teamId, 'join_code', `Join code changed by ${await teamName(c.env, me.teamId)}`);
    await broadcast(c.env, { type: 'league' });
    return c.json({ code, source: 'app' });
  });

  // Go back to the code the server was deployed with.
  app.delete('/league/join-code', requireAuth, requireCommissioner, async (c) => {
    if (!c.env.JOIN_CODE) return c.json({ error: 'This server has no built-in code to go back to; set a new one instead' }, 400);
    const cur = await load(c.env);
    const { joinCode: _drop, ...rest } = cur.settings;
    await save(c.env, rest).run();
    await audit(c.env, c.get('user').teamId, 'join_code', `Join code reset to the server's by ${await teamName(c.env, c.get('user').teamId)}`);
    await broadcast(c.env, { type: 'league' });
    return c.json({ code: c.env.JOIN_CODE, source: 'server' });
  });

  // The rules a commissioner can tune. Anyone can read them (the app needs them for bids, budgets and lineups).
  app.get('/league/rules', requireAuth, async (c) => c.json({ rules: await loadRules(c.env), defaults: DEFAULT_RULES, limits: LIMITS, scoreRange: [SCORE_MIN, SCORE_MAX] }));

  app.put('/league/rules', requireAuth, requireCommissioner, async (c) => {
    const me = c.get('user');
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const cur = await loadRules(c.env);
    let patch: unknown = body;
    if (body.reset === 'scoring') patch = { hit: DEFAULT_RULES.hit, pit: DEFAULT_RULES.pit };
    else if (body.reset === 'all') patch = { ...DEFAULT_RULES };
    const r = applyRulesPatch(cur, patch);
    if (!r.ok) return c.json({ error: r.reason }, 400);
    const changes = describeRulesChange(cur, r.rules);
    if (!changes.length) return c.json({ rules: cur, changed: [], rescored: false });
    const conflict = await conflictWith(c.env, r.rules);
    if (conflict) return c.json({ error: conflict }, 409);

    await c.env.DB.prepare('UPDATE league SET scoring_json = ? WHERE id = 1').bind(JSON.stringify(r.rules)).run();
    const rescore = scoringChanged(cur, r.rules);
    if (rescore) await rescoreEverything(c.env, r.rules);
    const who = await teamName(c.env, me.teamId);
    await audit(c.env, me.teamId, 'rules', `Rules changed by ${who}: ${changes.join('; ')}${rescore ? ' (all scores recalculated)' : ''}`.slice(0, 480));
    await broadcast(c.env, { type: 'league' });
    return c.json({ rules: r.rules, changed: changes, rescored: rescore });
  });

  app.put('/league/commissioners/:teamId', requireAuth, requireCommissioner, async (c) => {
    const me = c.get('user');
    const teamId = c.req.param('teamId') as string;
    const { commissioner } = await c.req.json<{ commissioner?: unknown }>().catch(() => ({} as { commissioner?: unknown }));
    if (typeof commissioner !== 'boolean') return c.json({ error: 'commissioner must be true or false' }, 400);
    const { results } = await c.env.DB.prepare(
      'SELECT t.id AS teamId, t.is_commissioner AS isCommissioner, EXISTS (SELECT 1 FROM user x WHERE x.team_id = t.id) AS hasAccount FROM team t',
    ).all<{ teamId: string; isCommissioner: number; hasAccount: number }>();
    const check = checkCommissionerChange(results.map((r) => ({ teamId: r.teamId, isCommissioner: !!r.isCommissioner, hasAccount: !!r.hasAccount })), teamId, commissioner);
    if (!check.ok) return c.json({ error: check.reason }, check.reason === 'Unknown team' ? 404 : 400);
    if (check.changed) {
      await c.env.DB.prepare('UPDATE team SET is_commissioner = ? WHERE id = ?').bind(commissioner ? 1 : 0, teamId).run();
      const names = await Promise.all([teamName(c.env, me.teamId), teamName(c.env, teamId)]);
      await audit(c.env, me.teamId, commissioner ? 'commissioner_added' : 'commissioner_removed',
        teamId === me.teamId ? `${names[0]} stepped down as commissioner` : `${names[1]} ${commissioner ? 'was made a commissioner' : 'is no longer a commissioner'} by ${names[0]}`);
      await broadcast(c.env, { type: 'league' });
    }
    return c.json({ ok: true, changed: check.changed });
  });
}

const teamName = async (env: Env, id: string | null) => (id ? (await env.DB.prepare('SELECT name FROM team WHERE id = ?').bind(id).first<{ name: string }>())?.name : null) ?? 'the commissioner';
