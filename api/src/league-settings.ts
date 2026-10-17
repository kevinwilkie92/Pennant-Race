import type { Hono } from 'hono';
import { checkCommissionerChange, cleanJoinCode, cleanLeagueName, generateJoinCode, joinCodeMatches } from '@pennant/domain';
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
