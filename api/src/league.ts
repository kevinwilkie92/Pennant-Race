import type { Hono } from 'hono';
import {
  PLAYOFF_TEAMS, REGULAR_WEEKS, TOTAL_WEEKS, buildBracket, generateSchedule, standings, weekRange,
  type Result,
} from '@pennant/domain';
import { requireAuth, requireCommissioner } from './auth';
import { loadRoster } from './roster';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;

const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function resolveSeason(env: Env, q: string | undefined): Promise<number | null> {
  if (q && /^\d{4}$/.test(q)) return Number(q);
  const row = await env.DB.prepare("SELECT year FROM season ORDER BY (status = 'live') DESC, year DESC LIMIT 1").first<{ year: number }>();
  return row?.year ?? null;
}

type WeekRow = { week: number; start_date: string; end_date: string };
const weeksOf = async (env: Env, yr: number) =>
  (await env.DB.prepare('SELECT week, start_date, end_date FROM week WHERE season = ? ORDER BY week').bind(yr).all<WeekRow>()).results;

/** Team totals per week, from daily_points. Map key `${week}|${teamId}`. Points arrive from the stats feed. */
async function weekTotals(env: Env, yr: number): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    `SELECT w.week, dp.team_id AS teamId, ROUND(SUM(dp.points), 2) AS total
       FROM daily_points dp JOIN week w ON w.season = dp.season AND dp.date BETWEEN w.start_date AND w.end_date
      WHERE dp.season = ? GROUP BY w.week, dp.team_id`,
  ).bind(yr).all<{ week: number; teamId: string; total: number }>();
  return new Map(results.map((r) => [`${r.week}|${r.teamId}`, r.total]));
}

/** A week is final once its Sunday has passed. */
const isFinal = (w: WeekRow | undefined, asOf: string) => !!w && w.end_date < asOf;

export function registerLeague(app: App) {
  // Commissioner creates the season calendar and the regular-season matchups (editable later).
  app.post('/schedule', requireAuth, requireCommissioner, async (c) => {
    const { season, startDate } = await c.req.json<{ season?: number; startDate: string }>();
    const yr = season ?? (await resolveSeason(c.env, undefined));
    if (yr == null) return c.json({ error: 'No season' }, 409);
    if ((await weeksOf(c.env, yr)).length) return c.json({ error: 'Schedule already exists for this season' }, 409);
    let ranges: { week: number; start: string; end: string }[];
    try {
      ranges = Array.from({ length: TOTAL_WEEKS }, (_, i) => ({ week: i + 1, ...weekRange(startDate, i + 1) }));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Bad start date' }, 400);
    }
    const teams = (await c.env.DB.prepare('SELECT id FROM team ORDER BY id').all<{ id: string }>()).results.map((t) => t.id);
    const stmts = [
      ...ranges.map((r) => c.env.DB.prepare('INSERT INTO week (season, week, start_date, end_date) VALUES (?, ?, ?, ?)').bind(yr, r.week, r.start, r.end)),
      ...generateSchedule(teams, REGULAR_WEEKS).map((p) => c.env.DB.prepare('INSERT INTO matchup (season, week, home, away) VALUES (?, ?, ?, ?)').bind(yr, p.week, p.home, p.away)),
    ];
    await c.env.DB.batch(stmts);
    return c.json({ season: yr, weeks: ranges.length, matchups: REGULAR_WEEKS * (teams.length / 2) }, 201);
  });

  app.get('/weeks', requireAuth, async (c) => {
    const yr = await resolveSeason(c.env, c.req.query('season'));
    if (yr == null) return c.json({ season: null, weeks: [] });
    const asOf = isDate(c.req.query('asOf')) ? c.req.query('asOf')! : today();
    const weeks = await weeksOf(c.env, yr);
    const current = weeks.find((w) => w.start_date <= asOf && asOf <= w.end_date)?.week
      ?? (weeks.length && asOf < weeks[0].start_date ? 1 : weeks.length || null);
    return c.json({ season: yr, current, weeks: weeks.map((w) => ({ week: w.week, start: w.start_date, end: w.end_date, final: isFinal(w, asOf) })) });
  });

  app.get('/matchups', requireAuth, async (c) => {
    const yr = await resolveSeason(c.env, c.req.query('season'));
    const week = Number(c.req.query('week') ?? 1);
    if (yr == null) return c.json([]);
    const asOf = isDate(c.req.query('asOf')) ? c.req.query('asOf')! : today();
    const w = (await weeksOf(c.env, yr)).find((x) => x.week === week);
    const totals = await weekTotals(c.env, yr);
    const row = (home: string, away: string) => ({
      week, home, away, homeScore: totals.get(`${week}|${home}`) ?? 0, awayScore: totals.get(`${week}|${away}`) ?? 0, final: isFinal(w, asOf),
    });
    if (week > REGULAR_WEEKS) {
      // Playoff games aren't stored; they follow from the seeds and earlier rounds.
      const { matches } = await bracketFor(c.env, yr, asOf);
      return c.json(matches.filter((m) => m.week === week && m.a && m.b).map((m) => row(m.a!, m.b!)));
    }
    const { results: ms } = await c.env.DB.prepare('SELECT home, away FROM matchup WHERE season = ? AND week = ? ORDER BY home').bind(yr, week).all<{ home: string; away: string }>();
    return c.json(ms.map((m) => row(m.home, m.away)));
  });

  async function results(env: Env, yr: number, asOf: string): Promise<{ results: Result[]; weeks: WeekRow[] }> {
    const weeks = await weeksOf(env, yr);
    const done = new Set(weeks.filter((w) => isFinal(w, asOf) && w.week <= REGULAR_WEEKS).map((w) => w.week));
    const totals = await weekTotals(env, yr);
    const { results: ms } = await env.DB.prepare('SELECT week, home, away FROM matchup WHERE season = ? ORDER BY week').bind(yr).all<{ week: number; home: string; away: string }>();
    return {
      weeks,
      results: ms.filter((m) => done.has(m.week)).map((m) => ({
        week: m.week, home: m.home, away: m.away,
        homeScore: totals.get(`${m.week}|${m.home}`) ?? 0, awayScore: totals.get(`${m.week}|${m.away}`) ?? 0,
      })),
    };
  }

  app.get('/standings', requireAuth, async (c) => {
    const yr = await resolveSeason(c.env, c.req.query('season'));
    if (yr == null) return c.json({ season: null, rows: [] });
    const asOf = isDate(c.req.query('asOf')) ? c.req.query('asOf')! : today();
    const teams = await c.env.DB.prepare('SELECT id, faab FROM team ORDER BY id').all<{ id: string; faab: number }>();
    const { results: rs } = await results(c.env, yr, asOf);
    const faab = new Map(teams.results.map((t) => [t.id, t.faab]));
    const rows = standings(teams.results.map((t) => t.id), rs).map((r) => ({ ...r, faab: faab.get(r.teamId) ?? 0 }));
    return c.json({ season: yr, playoffTeams: PLAYOFF_TEAMS, rows });
  });

  /** Seeds (fixed once the regular season has finished) and the playoff matches decided so far. */
  async function bracketFor(env: Env, yr: number, asOf: string) {
    const teams = (await env.DB.prepare('SELECT id FROM team ORDER BY id').all<{ id: string }>()).results.map((t) => t.id);
    const { results: rs, weeks } = await results(env, yr, asOf);
    const regularDone = weeks.length > 0 && weeks.filter((w) => w.week <= REGULAR_WEEKS).every((w) => isFinal(w, asOf));
    const seeds = regularDone ? standings(teams, rs).slice(0, PLAYOFF_TEAMS).map((r) => r.teamId) : [];
    const totals = await weekTotals(env, yr);
    const score = (teamId: string, week: number) => {
      const w = weeks.find((x) => x.week === week);
      return isFinal(w, asOf) ? totals.get(`${week}|${teamId}`) ?? 0 : null;
    };
    return { seeds, matches: seeds.length ? buildBracket(seeds, score) : [], weeks, totals };
  }

  app.get('/bracket', requireAuth, async (c) => {
    const yr = await resolveSeason(c.env, c.req.query('season'));
    if (yr == null) return c.json({ season: null, seeds: [], matches: [] });
    const asOf = isDate(c.req.query('asOf')) ? c.req.query('asOf')! : today();
    const { seeds, matches } = await bracketFor(c.env, yr, asOf);
    return c.json({ season: yr, seeds, matches });
  });

  // One team's roster for a week with points per day (what the Matchup screen shows).
  app.get('/teams/:id/week', requireAuth, async (c) => {
    const yr = await resolveSeason(c.env, c.req.query('season'));
    const week = Number(c.req.query('week') ?? 1);
    const teamId = c.req.param('id') as string;
    if (yr == null) return c.json({ slots: [], days: [] });
    const w = (await weeksOf(c.env, yr)).find((x) => x.week === week);
    const slots = await loadRoster(c.env, yr, teamId);
    const pts = w
      ? (await c.env.DB.prepare('SELECT player_id AS playerId, date, points FROM daily_points WHERE season = ? AND team_id = ? AND date BETWEEN ? AND ?')
          .bind(yr, teamId, w.start_date, w.end_date).all<{ playerId: number; date: string; points: number }>()).results
      : [];
    const byPlayer = new Map<number, Record<string, number>>();
    for (const p of pts) byPlayer.set(p.playerId, { ...(byPlayer.get(p.playerId) ?? {}), [p.date]: p.points });
    const days = w ? Array.from({ length: 7 }, (_, i) => new Date(Date.parse(w.start_date) + i * 86_400_000).toISOString().slice(0, 10)) : [];
    const out = slots.map((s) => {
      const byDay = byPlayer.get(s.playerId) ?? {};
      return { ...s, byDay, weekTotal: Math.round(Object.values(byDay).reduce((a, b) => a + b, 0) * 100) / 100 };
    });
    return c.json({ season: yr, week, teamId, days, slots: out });
  });
}
