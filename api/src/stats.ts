import type { Hono } from 'hono';
import { careerTotals, countQualityStarts, hittingSeason, pickSeasons, pitchingSeason, gameStat, isInjuredListCode, matchPlayers, normalizeName, roleOf, summarize, hitterEligibility, pitcherEligibility, type BoxBatting, type BoxPitching, type Role, type Split } from '@pennant/domain';
import { requireAuth, requireCommissioner } from './auth';
import { lineupAt } from './lineup';
import { ownerMap } from './roster';
import { leagueToday } from './time';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;

const base = (env: Env) => (env.MLB_API_BASE || 'https://statsapi.mlb.com/api/v1').replace(/\/$/, '');

async function mlb<T>(env: Env, path: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${base(env)}${path}`);
      if (r.ok) return (await r.json()) as T;
      last = new Error(`MLB API ${r.status} for ${path}`);
      if (r.status < 500) break;                       // a 4xx won't improve on retry
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error('MLB API request failed');
}

const teamCache = new Map<string, Map<number, string>>();
/** MLB team id -> abbreviation (they match our mlb_team abbreviations). */
async function mlbTeams(env: Env, season: number): Promise<Map<number, string>> {
  const key = `${base(env)}|${season}`;
  const hit = teamCache.get(key);
  if (hit) return hit;
  const { teams } = await mlb<{ teams: { id: number; abbreviation: string }[] }>(env, `/teams?sportId=1&season=${season}`);
  const m = new Map(teams.map((t) => [t.id, t.abbreviation]));
  teamCache.set(key, m);
  return m;
}

const setState = (env: Env, key: string, value: unknown) =>
  env.DB.prepare('INSERT INTO feed_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), Date.now()).run();
const getState = async <T>(env: Env, key: string): Promise<{ value: T; at: number } | null> => {
  const r = await env.DB.prepare('SELECT value, updated_at AS at FROM feed_state WHERE key = ?').bind(key).first<{ value: string; at: number }>();
  return r ? { value: JSON.parse(r.value) as T, at: r.at } : null;
};

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const addDays = (d: string, k: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + k)).toISOString().slice(0, 10);
const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

// ------------------------------------------------------------------ player matching

type Person = { id: number; fullName: string; currentTeam?: { id: number } };

async function unmappedPlayers(env: Env) {
  return (await env.DB.prepare('SELECT id, name, mlb_team AS team FROM player WHERE mlb_id IS NULL').all<{ id: number; name: string; team: string | null }>()).results;
}
async function saveMatches(env: Env, matched: Map<number, number>) {
  const stmts = [...matched].map(([id, mlbId]) => env.DB.prepare('UPDATE player SET mlb_id = ? WHERE id = ?').bind(mlbId, id));
  for (const part of chunk(stmts, 50)) await env.DB.batch(part);
  // Ohtani is two rows for one person: whichever row matched gives the other its id.
  await env.DB.prepare(
    `UPDATE player SET mlb_id = (SELECT p2.mlb_id FROM player p2 WHERE p2.mlb_id IS NOT NULL AND REPLACE(REPLACE(p2.name, ' (Batter)', ''), ' (Pitcher)', '') = REPLACE(REPLACE(player.name, ' (Batter)', ''), ' (Pitcher)', '') LIMIT 1)
      WHERE mlb_id IS NULL AND (name LIKE '% (Batter)' OR name LIKE '% (Pitcher)')`,
  ).run();
}

/** One step of matching our players to MLB person ids. The caller repeats steps until `remaining` stops shrinking. */
export async function mapStep(env: Env, step: 'players' | 'rosters' | 'search', from = 0) {
  const season = Number(leagueToday().slice(0, 4));
  const teams = await mlbTeams(env, season);
  const ours = await unmappedPlayers(env);
  let theirs: { id: number; name: string; team: string | null }[] = [];
  let next: number | null = null;

  if (step === 'players') {
    let { people } = await mlb<{ people: Person[] }>(env, `/sports/1/players?season=${season}`);
    if (!people.length) people = (await mlb<{ people: Person[] }>(env, `/sports/1/players?season=${season - 1}`)).people;
    theirs = people.map((p) => ({ id: p.id, name: p.fullName, team: p.currentTeam ? teams.get(p.currentTeam.id) ?? null : null }));
  } else if (step === 'rosters') {
    // 40-man rosters include injured players the active list leaves out.
    const ids = [...teams.keys()].sort((a, b) => a - b);
    const part = ids.slice(from, from + 10);
    for (const id of part) {
      const { roster } = await mlb<{ roster: { person: { id: number; fullName: string } }[] }>(env, `/teams/${id}/roster?rosterType=40Man&season=${season}`);
      theirs.push(...roster.map((r) => ({ id: r.person.id, name: r.person.fullName, team: teams.get(id) ?? null })));
    }
    next = from + 10 < ids.length ? from + 10 : null;
  } else {
    // Free agents and minor leaguers: ask MLB's people search, accepting only an exact, single hit.
    for (const o of ours.slice(from, from + 20)) {
      const name = o.name.replace(/\s*\((Batter|Pitcher)\)/, '').replace(/\*/g, '').replace(/\s+-\s+[A-Z]{2,3}$/, '').trim();
      try {
        const { people } = await mlb<{ people: Person[] }>(env, `/people/search?names=${encodeURIComponent(name)}`);
        const exact = people.filter((p) => normalizeName(p.fullName) === normalizeName(name));
        if (exact.length === 1) theirs.push({ id: exact[0].id, name: o.name, team: o.team });
      } catch { /* leave him for next time */ }
    }
    next = from + 20 < ours.length ? -1 : null;       // resolved below, once we know how many left the list
  }

  const { matched } = matchPlayers(ours, theirs);
  await saveMatches(env, matched);
  const remaining = (await unmappedPlayers(env)).length;
  // Matched players leave the unmatched list, so the next window starts that many places earlier.
  if (step === 'search' && next === -1) next = from + 20 - matched.size;
  return { step, matched: matched.size, remaining, next };
}

// ------------------------------------------------------------------ game ingestion

type Game = { gamePk: number; gameDate: string; officialDate?: string; status: { abstractGameState: string }; teams: { home: { team: { id: number } }; away: { team: { id: number } } } };
type BoxEntry = { person: { id: number }; position?: { abbreviation?: string }; battingOrder?: string; stats?: { batting?: BoxBatting; pitching?: BoxPitching } };
type Box = { teams: { home: { players: Record<string, BoxEntry> }; away: { players: Record<string, BoxEntry> } } };

export async function syncDate(env: Env, date: string) {
  const year = Number(date.slice(0, 4));
  const teams = await mlbTeams(env, year);
  const sched = await mlb<{ dates: { games: Game[] }[] }>(env, `/schedule?sportId=1&gameType=R&date=${date}`);
  const games = sched.dates.flatMap((d) => d.games);

  // First-pitch times for the lineup lock (a doubleheader locks at the first game).
  const starts = new Map<string, string>();
  for (const g of games) {
    const iso = g.gameDate.replace(/\.\d+Z$/, 'Z');
    for (const id of [g.teams.home.team.id, g.teams.away.team.id]) {
      const abbr = teams.get(id);
      if (abbr && (!starts.get(abbr) || iso < starts.get(abbr)!)) starts.set(abbr, iso);
    }
  }
  const known = new Set((await env.DB.prepare('SELECT abbr FROM mlb_team').all<{ abbr: string }>()).results.map((t) => t.abbr));
  const gameStmts = [...starts].filter(([abbr]) => known.has(abbr)).map(([abbr, iso]) =>
    env.DB.prepare('INSERT INTO mlb_game (date, team, start_utc) VALUES (?, ?, ?) ON CONFLICT(date, team) DO UPDATE SET start_utc = excluded.start_utc').bind(date, abbr, iso));
  for (const part of chunk(gameStmts, 50)) await env.DB.batch(part);

  const done = new Set((await env.DB.prepare('SELECT game_pk AS pk FROM stats_game WHERE date = ? AND final = 1').bind(date).all<{ pk: number }>()).results.map((r) => r.pk));
  const todo = games.filter((g) => !done.has(g.gamePk) && ['Live', 'Final'].includes(g.status.abstractGameState));

  const ours = new Map<number, { id: number; role: Role }[]>();
  for (const p of (await env.DB.prepare('SELECT id, mlb_id AS mlbId, name, pos FROM player WHERE mlb_id IS NOT NULL').all<{ id: number; mlbId: number; name: string; pos: string }>()).results) {
    ours.set(p.mlbId, [...(ours.get(p.mlbId) ?? []), { id: p.id, role: roleOf(p) }]);
  }

  let rows = 0;
  for (const g of todo) {
    const box = await mlb<Box>(env, `/game/${g.gamePk}/boxscore`);
    const stmts: D1PreparedStatement[] = [];
    for (const side of [box.teams.home, box.teams.away]) {
      for (const entry of Object.values(side.players)) {
        for (const mine of ours.get(entry.person.id) ?? []) {
          const stat = gameStat(mine.role, entry);
          if (!stat) continue;
          rows++;
          stmts.push(env.DB.prepare(
            `INSERT INTO player_game (game_pk, player_id, season, date, role, points, line_json, pos, started) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(game_pk, player_id) DO UPDATE SET points = excluded.points, line_json = excluded.line_json, pos = excluded.pos, started = excluded.started`,
          ).bind(g.gamePk, mine.id, year, date, stat.role, stat.points, JSON.stringify(stat.line), stat.pos, stat.started ? 1 : 0));
        }
      }
    }
    stmts.push(env.DB.prepare('INSERT INTO stats_game (game_pk, date, final, processed_at) VALUES (?, ?, ?, ?) ON CONFLICT(game_pk) DO UPDATE SET final = excluded.final, processed_at = excluded.processed_at')
      .bind(g.gamePk, date, g.status.abstractGameState === 'Final' ? 1 : 0, Date.now()));
    for (const part of chunk(stmts, 50)) await env.DB.batch(part);
  }

  if (todo.length) await recomputeDailyPoints(env, date);
  return { date, games: games.length, fetched: todo.length, rows };
}

/** Credits each team the points its lineup earned on `date`, to the slot each player held that day. */
export async function recomputeDailyPoints(env: Env, date: string) {
  const yr = Number(date.slice(0, 4));
  if (!(await env.DB.prepare('SELECT 1 FROM season WHERE year = ?').bind(yr).first())) return;
  const pts = new Map<number, number>();
  for (const r of (await env.DB.prepare('SELECT player_id AS id, ROUND(SUM(points), 2) AS pts FROM player_game WHERE date = ? GROUP BY player_id').bind(date).all<{ id: number; pts: number }>()).results) pts.set(r.id, r.pts);

  const teams = (await env.DB.prepare('SELECT id FROM team').all<{ id: string }>()).results;
  const stmts: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM daily_points WHERE season = ? AND date = ?').bind(yr, date)];
  for (const t of teams) {
    for (const e of await lineupAt(env, yr, t.id, date)) {
      const p = pts.get(e.playerId);
      if (p !== undefined) stmts.push(env.DB.prepare('INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (?, ?, ?, ?, ?, ?)').bind(yr, date, t.id, e.playerId, e.slot, p));
    }
  }
  for (const part of chunk(stmts, 50)) await env.DB.batch(part);
}

// ------------------------------------------------------------------ injuries and eligibility

/** Mirrors MLB injured-list status onto our players (only touching rows the feed created, never a commissioner's). */
export async function syncInjuries(env: Env) {
  const season = Number(leagueToday().slice(0, 4));
  const teams = await mlbTeams(env, season);
  const byMlb = new Map<number, number[]>();
  for (const p of (await env.DB.prepare('SELECT id, mlb_id AS mlbId FROM player WHERE mlb_id IS NOT NULL').all<{ id: number; mlbId: number }>()).results) byMlb.set(p.mlbId, [...(byMlb.get(p.mlbId) ?? []), p.id]);
  let set = 0, cleared = 0;
  for (const tid of teams.keys()) {
    const { roster } = await mlb<{ roster: { person: { id: number }; status: { code: string; description?: string }; note?: string }[] }>(env, `/teams/${tid}/roster?rosterType=40Man&season=${season}`);
    const stmts: D1PreparedStatement[] = [];
    for (const r of roster) {
      for (const id of byMlb.get(r.person.id) ?? []) {
        if (isInjuredListCode(r.status.code)) {
          set++;
          stmts.push(env.DB.prepare(
            `INSERT INTO player_status (player_id, status, note, updated_at, source) VALUES (?, 'IL', ?, ?, 'feed')
             ON CONFLICT(player_id) DO UPDATE SET status = 'IL', note = excluded.note, updated_at = excluded.updated_at WHERE player_status.source = 'feed'`,
          ).bind(id, r.note ?? r.status.description ?? null, Date.now()));
        } else if (r.status.code === 'A') {
          cleared++;
          stmts.push(env.DB.prepare("DELETE FROM player_status WHERE player_id = ? AND source = 'feed'").bind(id));
        }
      }
    }
    for (const part of chunk(stmts, 50)) await env.DB.batch(part);
  }
  await setState(env, 'injuries', { set, cleared });
  return { set, cleared };
}

/** Adds positions players have earned from games played this season and last (earned positions are never taken away). */
export async function syncEligibility(env: Env) {
  const yr = Number(leagueToday().slice(0, 4));
  const rows = (await env.DB.prepare(
    `SELECT pg.player_id AS id, pg.role, pg.pos, COUNT(*) AS apps, SUM(pg.started) AS starts, p.name
       FROM player_game pg JOIN player p ON p.id = pg.player_id WHERE pg.season IN (?1, ?2) GROUP BY pg.player_id, pg.role, pg.pos`,
  ).bind(yr, yr - 1).all<{ id: number; role: Role; pos: string; apps: number; starts: number }>()).results;

  const hit = new Map<number, Record<string, { starts: number; appearances: number }>>();
  const pit = new Map<number, { starts: number; reliefApps: number }>();
  for (const r of rows) {
    if (r.role === 'H') {
      if (!r.pos || r.pos === 'P' || r.pos === 'DH' || r.pos === 'PH' || r.pos === 'PR') continue;
      const u = hit.get(r.id) ?? {}; u[r.pos] = { starts: r.starts, appearances: r.apps }; hit.set(r.id, u);
    } else {
      const u = pit.get(r.id) ?? { starts: 0, reliefApps: 0 };
      u.starts += r.starts; u.reliefApps += r.apps - r.starts; pit.set(r.id, u);
    }
  }
  const stmts: D1PreparedStatement[] = [];
  const add = (id: number, pos: string) => stmts.push(env.DB.prepare('INSERT OR IGNORE INTO player_position (player_id, season, position) VALUES (?, ?, ?)').bind(id, yr, pos));
  for (const [id, u] of hit) for (const pos of hitterEligibility(u)) add(id, pos);
  for (const [id, u] of pit) for (const pos of pitcherEligibility(u)) add(id, pos);
  for (const part of chunk(stmts, 50)) await env.DB.batch(part);
  return { added: stmts.length };
}

// ------------------------------------------------------------------ scheduled work

/** Cron entry: `live` refreshes today's (and yesterday's late) games; `daily` also settles yesterday; `roster` does injuries + eligibility. */
export async function runFeed(env: Env, job: 'live' | 'daily' | 'roster') {
  if (job === 'roster') { await syncInjuries(env); await syncEligibility(env); return; }
  const today = leagueToday();
  for (const d of [addDays(today, -1), today]) {          // yesterday's late games, then today's
    try { await syncDate(env, d); } catch (e) { await setState(env, 'lastError', { date: d, message: e instanceof Error ? e.message : String(e) }); continue; }
  }
  await setState(env, 'lastSync', { date: today });
}

// ------------------------------------------------------------------ routes

const SEASON_SQL = 'SELECT MAX(season) AS y FROM player_game';

export function registerStats(app: App) {
  app.get('/stats/status', requireAuth, async (c) => {
    const db = c.env.DB;
    const [{ n: total }, { n: mapped }] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM player').first<{ n: number }>().then((r) => r!),
      db.prepare('SELECT COUNT(*) AS n FROM player WHERE mlb_id IS NOT NULL').first<{ n: number }>().then((r) => r!),
    ]);
    const games = await db.prepare('SELECT COUNT(*) AS n, SUM(final) AS finals, MAX(date) AS lastDate FROM stats_game').first<{ n: number; finals: number | null; lastDate: string | null }>();
    return c.json({
      total, mapped, games: games?.n ?? 0, finalGames: games?.finals ?? 0, lastGameDate: games?.lastDate ?? null,
      lastSync: await getState(c.env, 'lastSync'), lastError: await getState(c.env, 'lastError'), injuries: await getState(c.env, 'injuries'),
    });
  });

  app.get('/stats/unmapped', requireAuth, requireCommissioner, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.mlb_team AS mlbTeam, p.pos,
              EXISTS (SELECT 1 FROM draft_sale ds WHERE ds.player_id = p.id) AS drafted
         FROM player p WHERE p.mlb_id IS NULL ORDER BY drafted DESC, p.name LIMIT 300`,
    ).all();
    return c.json(results);
  });

  app.post('/stats/map-players', requireAuth, requireCommissioner, async (c) => {
    const b = await c.req.json<{ step?: string; from?: number }>().catch(() => ({} as { step?: string; from?: number }));
    const step = b.step === 'rosters' || b.step === 'search' ? b.step : 'players';
    try { return c.json(await mapStep(c.env, step, Number.isInteger(b.from) ? b.from : 0)); }
    catch (e) { return c.json({ error: e instanceof Error ? e.message : 'The MLB stats service did not answer' }, 502); }
  });

  app.put('/stats/players/:id/mlb-id', requireAuth, requireCommissioner, async (c) => {
    const id = Number(c.req.param('id'));
    const { mlbId } = await c.req.json<{ mlbId: number | null }>().catch(() => ({ mlbId: undefined as number | null | undefined }));
    if (mlbId !== null && !(Number.isInteger(mlbId) && (mlbId as number) > 0)) return c.json({ error: 'MLB id must be a positive whole number' }, 400);
    const r = await c.env.DB.prepare('UPDATE player SET mlb_id = ? WHERE id = ?').bind(mlbId, id).run();
    return r.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Player not found' }, 404);
  });

  // Pull games for one date or a range (max 7 days a call); the nightly job does this by itself.
  app.post('/stats/sync', requireAuth, requireCommissioner, async (c) => {
    const b = await c.req.json<{ date?: string; from?: string; to?: string }>().catch(() => ({} as { date?: string; from?: string; to?: string }));
    const from = b.from ?? b.date ?? leagueToday(), to = b.to ?? b.date ?? from;
    if (!validDate(from) || !validDate(to) || to < from) return c.json({ error: 'Dates must be YYYY-MM-DD, from <= to' }, 400);
    const days: string[] = [];
    for (let d = from; d <= to && days.length < 8; d = addDays(d, 1)) days.push(d);
    if (days.length > 7) return c.json({ error: 'At most 7 days per call' }, 400);
    try {
      const results = [];
      for (const d of days) results.push(await syncDate(c.env, d));
      await setState(c.env, 'lastSync', { date: to });
      return c.json({ results });
    } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'The MLB stats service did not answer' }, 502); }
  });

  app.post('/stats/refresh', requireAuth, requireCommissioner, async (c) => {
    try { return c.json({ injuries: await syncInjuries(c.env), eligibility: await syncEligibility(c.env) }); }
    catch (e) { return c.json({ error: e instanceof Error ? e.message : 'The MLB stats service did not answer' }, 502); }
  });

  app.get('/players/:id/career', requireAuth, async (c) => {
    const r = await playerCareer(c.env, Number(c.req.param('id')));
    if ('error' in r) return c.json({ error: r.error }, r.error === 'Player not found' ? 404 : 502);
    return c.json(r);
  });

  // Leaders / trending: fantasy points over a window, with who owns each player.
  app.get('/players/stats', requireAuth, async (c) => {
    const win = c.req.query('window') ?? 'season';
    const role = c.req.query('role');
    const pos = c.req.query('pos');
    const onlyFree = c.req.query('free') === '1';
    const y = (await c.env.DB.prepare(SEASON_SQL).first<{ y: number | null }>())?.y;
    if (y == null) return c.json({ season: null, window: win, players: [] });
    const last = (await c.env.DB.prepare('SELECT MAX(date) AS d FROM player_game WHERE season = ?').bind(y).first<{ d: string | null }>())?.d ?? leagueToday();
    const days = win === 'season' ? null : Math.min(60, Math.max(1, Number(win) || 7));
    const since = days ? addDays(last, -(days - 1)) : `${y}-01-01`;
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.mlb_team AS mlbTeam, p.pos, pg.role, COUNT(*) AS games, ROUND(SUM(pg.points), 1) AS points,
              (SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = p.id AND pp.season = ?1) AS positions
         FROM player_game pg JOIN player p ON p.id = pg.player_id
        WHERE pg.season = ?1 AND pg.date >= ?2 ${role === 'H' || role === 'P' ? 'AND pg.role = ?3' : "AND ?3 = ?3"}
        GROUP BY p.id, pg.role ORDER BY points DESC LIMIT 200`,
    ).bind(y, since, role === 'H' || role === 'P' ? role : '').all<{ id: number; name: string; mlbTeam: string | null; pos: string; role: string; games: number; points: number; positions: string | null }>();
    const owners = await ownerMap(c.env, y);
    const live = (await c.env.DB.prepare("SELECT year FROM season ORDER BY (status = 'live') DESC, year DESC LIMIT 1").first<{ year: number }>())?.year;
    const own = live != null && live !== y ? await ownerMap(c.env, live) : owners;
    const players = results
      .map((r) => ({ ...r, positions: (r.positions ?? r.pos).split(',').filter(Boolean), ownerId: own.get(r.id) ?? null }))
      .filter((r) => (!pos || pos === 'ALL' || r.positions.includes(pos) || (pos === 'P' && r.role === 'P')) && (!onlyFree || r.ownerId == null))
      .slice(0, 50);
    return c.json({ season: y, window: win, through: last, players });
  });
}

/** Season totals + recent games for the player card. */
export async function playerStats(env: Env, id: number) {
  const y = (await env.DB.prepare('SELECT MAX(season) AS y FROM player_game WHERE player_id = ?').bind(id).first<{ y: number | null }>())?.y;
  if (y == null) return null;
  const { results } = await env.DB.prepare('SELECT date, role, points, line_json AS line FROM player_game WHERE player_id = ? AND season = ? ORDER BY date DESC, game_pk DESC').bind(id, y).all<{ date: string; role: Role; points: number; line: string }>();
  const totals: Record<string, number> = {};
  for (const g of results) for (const [k, v] of Object.entries(JSON.parse(g.line) as Record<string, number>)) totals[k] = Math.round(((totals[k] ?? 0) + v) * 100) / 100;
  return {
    season: y, role: results[0]?.role ?? 'H', games: results.length,
    points: Math.round(results.reduce((n, g) => n + g.points, 0) * 10) / 10, totals,
    log: results.slice(0, 15).map((g) => ({ date: g.date, points: g.points, summary: summarize({ role: g.role, line: JSON.parse(g.line) }) })),
  };
}

// ------------------------------------------------------------------ career stats

const CAREER_TTL_MS = 12 * 3600_000;
type CareerSeason = { season: number; teams: string[]; stats: Record<string, number>; points: number };
export type Career = { available: boolean; reason?: string; role: Role; seasons: CareerSeason[]; totals: { stats: Record<string, number>; points: number }; fetchedAt: number; stale?: boolean };

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (next < xs.length) { const i = next++; out[i] = await fn(xs[i]); } }));
  return out;
}

/** Quality starts in each season for a pitcher: counted from the game log once, then remembered. */
async function seasonQuality(env: Env, mlbId: number, seasons: number[]): Promise<Map<number, number>> {
  const thisYear = Number(leagueToday().slice(0, 4));
  const cached = new Map((await env.DB.prepare('SELECT season, qs, final, fetched_at AS at FROM qs_cache WHERE mlb_id = ?').bind(mlbId).all<{ season: number; qs: number; final: number; at: number }>()).results.map((r) => [r.season, r]));
  const need = seasons.filter((y) => { const c = cached.get(y); return !c || (!c.final && Date.now() - c.at > CAREER_TTL_MS); });
  const fresh = await mapLimit(need, 5, async (y) => {
    const r = await mlb<{ stats: { splits: { stat: Record<string, unknown> }[] }[] }>(env, `/people/${mlbId}/stats?stats=gameLog&season=${y}&group=pitching&sportId=1`);
    return [y, countQualityStarts((r.stats[0]?.splits ?? []).map((x) => x.stat))] as const;
  });
  for (const [y, qs] of fresh) {
    await env.DB.prepare('INSERT INTO qs_cache (mlb_id, season, qs, final, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(mlb_id, season) DO UPDATE SET qs = excluded.qs, final = excluded.final, fetched_at = excluded.fetched_at')
      .bind(mlbId, y, qs, y < thisYear ? 1 : 0, Date.now()).run();
    cached.set(y, { season: y, qs, final: y < thisYear ? 1 : 0, at: Date.now() });
  }
  return new Map(seasons.map((y) => [y, cached.get(y)?.qs ?? 0]));
}

/** A player's MLB career, season by season, scored with the league's rules. */
export async function playerCareer(env: Env, playerId: number): Promise<Career | { error: string }> {
  const p = await env.DB.prepare('SELECT name, pos, mlb_id AS mlbId FROM player WHERE id = ?').bind(playerId).first<{ name: string; pos: string; mlbId: number | null }>();
  if (!p) return { error: 'Player not found' };
  const role = roleOf(p);
  const empty = (reason: string): Career => ({ available: false, reason, role, seasons: [], totals: { stats: {}, points: 0 }, fetchedAt: Date.now() });
  if (p.mlbId == null) return empty('This player has not been matched to MLB yet.');

  const hit = await env.DB.prepare('SELECT json, fetched_at AS at FROM career_cache WHERE mlb_id = ? AND role = ?').bind(p.mlbId, role).first<{ json: string; at: number }>();
  if (hit && Date.now() - hit.at < CAREER_TTL_MS) return JSON.parse(hit.json) as Career;
  try {
    const group = role === 'P' ? 'pitching' : 'hitting';
    const r = await mlb<{ stats: { splits: Split[] }[] }>(env, `/people/${p.mlbId}/stats?stats=yearByYear&group=${group}&sportId=1`);
    const rows = pickSeasons(r.stats[0]?.splits ?? []);
    if (!rows.length) return empty('No major-league stats yet.');
    const teams = await mlbTeams(env, Number(leagueToday().slice(0, 4)));
    const qs = role === 'P' ? await seasonQuality(env, p.mlbId, rows.map((x) => x.season)) : new Map<number, number>();
    const seasons: CareerSeason[] = rows.map((x) => ({
      season: x.season, teams: x.teamIds.map((id) => teams.get(id) ?? '?'),
      ...(role === 'P' ? pitchingSeason(x.stat, qs.get(x.season) ?? 0) : hittingSeason(x.stat)),
    }));
    const out: Career = { available: true, role, seasons, totals: careerTotals(seasons), fetchedAt: Date.now() };
    await env.DB.prepare('INSERT INTO career_cache (mlb_id, role, json, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(mlb_id, role) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at')
      .bind(p.mlbId, role, JSON.stringify(out), out.fetchedAt).run();
    return out;
  } catch (e) {
    if (hit) return { ...(JSON.parse(hit.json) as Career), stale: true };                // MLB is down: the last good copy beats nothing
    return { error: e instanceof Error ? e.message : 'The MLB stats service did not answer' };
  }
}
