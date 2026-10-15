import type { Hono } from 'hono';
import { ALL_LABELS, canFillSlot, canUseIL, isILSlot } from '@pennant/domain';
import { requireAuth } from './auth';
import { loadRoster, materializeStmts, playerEntries, type RosterEntry } from './roster';
import { isoNow, leagueToday } from './time';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const BASELINE = '0000-00-00';

async function seasonStatus(env: Env, q: string | undefined) {
  const row = q && /^\d{4}$/.test(q)
    ? await env.DB.prepare('SELECT year, status FROM season WHERE year = ?').bind(Number(q)).first<{ year: number; status: string }>()
    : await env.DB.prepare("SELECT year, status FROM season ORDER BY (status = 'live') DESC, year DESC LIMIT 1").first<{ year: number; status: string }>();
  return row ?? null;
}

/**
 * The lineup as of `date`, including players who have since been dropped and excluding ones not yet added.
 * A player's slot is the latest history row at or before the date ('' = off the roster). With no history he
 * has been on the team all along; if his first row is in the future he hadn't been added yet.
 */
export async function lineupAt(env: Env, yr: number, teamId: string, date: string): Promise<RosterEntry[]> {
  const base = await loadRoster(env, yr, teamId);
  const hist = (await env.DB.prepare('SELECT player_id AS playerId, slot, from_date AS fromDate FROM lineup_history WHERE season = ? AND team_id = ? ORDER BY from_date')
    .bind(yr, teamId).all<{ playerId: number; slot: string; fromDate: string }>()).results;
  const rows = new Map<number, { slot: string; fromDate: string }[]>();
  for (const h of hist) rows.set(h.playerId, [...(rows.get(h.playerId) ?? []), h]);

  const baseIds = new Set(base.map((e) => e.playerId));
  const extra = [...rows.keys()].filter((id) => !baseIds.has(id));
  const info = await playerEntries(env, yr, extra);
  const everyone: (Omit<RosterEntry, 'slot'> & { slot: string })[] = [
    ...base, ...extra.flatMap((id) => (info.has(id) ? [{ ...info.get(id)!, slot: '' }] : [])),
  ];

  const out: RosterEntry[] = [];
  for (const e of everyone) {
    const r = rows.get(e.playerId);
    if (!r) { out.push(e); continue; }
    const applicable = r.filter((x) => x.fromDate <= date);
    if (!applicable.length) continue;                       // not on the team yet
    const slot = applicable[applicable.length - 1].slot;
    if (slot !== '') out.push({ ...e, slot });
  }
  return out;
}

/** A player is locked once his MLB team's game has started on that date (only meaningful for today). */
async function lockedTeams(env: Env, date: string): Promise<Set<string>> {
  if (date !== leagueToday()) return new Set();
  const { results } = await env.DB.prepare('SELECT team FROM mlb_game WHERE date = ? AND start_utc <= ?').bind(date, isoNow()).all<{ team: string }>();
  return new Set(results.map((r) => r.team));
}

export function registerLineup(app: App) {
  app.get('/teams/:id/lineup', requireAuth, async (c) => {
    const u = c.get('user');
    const teamId = c.req.param('id') as string;
    const s = await seasonStatus(c.env, c.req.query('season'));
    if (!s) return c.json({ season: null, date: null, today: leagueToday(), editable: false, slots: [], total: 0 });
    const date = isDate(c.req.query('date')) ? c.req.query('date')! : leagueToday();
    const entries = await lineupAt(c.env, s.year, teamId, date);
    const locked = await lockedTeams(c.env, date);
    const pts = (await c.env.DB.prepare('SELECT player_id AS playerId, points FROM daily_points WHERE season = ? AND team_id = ? AND date = ?')
      .bind(s.year, teamId, date).all<{ playerId: number; points: number }>()).results;
    const byPlayer = new Map(pts.map((p) => [p.playerId, p.points]));
    const slots = entries
      .map((e) => ({ ...e, locked: !!e.mlbTeam && locked.has(e.mlbTeam), points: byPlayer.get(e.playerId) ?? null }))
      .sort((a, b) => (ALL_LABELS as readonly string[]).indexOf(a.slot) - (ALL_LABELS as readonly string[]).indexOf(b.slot));
    const total = Math.round(slots.filter((e) => !e.slot.startsWith('B') && !isILSlot(e.slot)).reduce((n, e) => n + (e.points ?? 0), 0) * 100) / 100;
    return c.json({
      season: s.year, date, today: leagueToday(), total, slots,
      editable: s.status === 'live' && date >= leagueToday() && (u.isCommissioner || u.teamId === teamId),
    });
  });

  // Move a player to a slot (swapping with whoever is there). Effective from `date` (today or later).
  app.put('/teams/:id/lineup', requireAuth, async (c) => {
    const u = c.get('user');
    const teamId = c.req.param('id') as string;
    const body = await c.req.json<{ date?: string; playerId: number; toSlot: string }>();
    if (!u.isCommissioner && u.teamId !== teamId) return c.json({ error: 'You can only edit your own lineup' }, 403);
    const s = await seasonStatus(c.env, undefined);
    if (!s || s.status !== 'live') return c.json({ error: 'The season is not live; lineups are frozen' }, 409);
    const today = leagueToday();
    const date = body.date ?? today;
    if (!isDate(date)) return c.json({ error: 'Bad date' }, 400);
    if (date < today) return c.json({ error: 'Past days can’t be edited' }, 400);
    if (!(ALL_LABELS as readonly string[]).includes(body.toSlot)) return c.json({ error: 'Unknown slot' }, 400);

    const entries = await lineupAt(c.env, s.year, teamId, date);
    const p = entries.find((e) => e.playerId === body.playerId);
    if (!p) return c.json({ error: 'That player is not on this team' }, 404);
    if (p.slot === body.toSlot) return c.json({ ok: true });
    const q = entries.find((e) => e.slot === body.toSlot);

    // Only injured (IL/OUT) players may sit in an IL slot — whoever ends up there.
    for (const [who, dest] of [[p, body.toSlot], ...(q ? [[q, p.slot] as const] : [])] as const) {
      if (isILSlot(dest) && !canUseIL(who.injury)) {
        return c.json({ error: `${who.name} can only go on the injured list if he is ruled IL or OUT${who.injury ? ` (he is ${who.injury})` : ''}` }, 400);
      }
    }

    const locked = await lockedTeams(c.env, date);
    for (const x of [p, q]) {
      if (x?.mlbTeam && locked.has(x.mlbTeam)) return c.json({ error: `${x.name}’s game has started; he’s locked today` }, 409);
    }

    if (!canFillSlot(body.toSlot, p.positions)) return c.json({ error: `${p.name} isn’t eligible at ${body.toSlot}` }, 400);
    if (q && !canFillSlot(p.slot, q.positions)) return c.json({ error: `${q.name} isn’t eligible at ${p.slot}` }, 400);

    const current = await loadRoster(c.env, s.year, teamId);           // today's stored lineup (baseline)
    const was = new Map(current.map((e) => [e.playerId, e.slot]));
    const changes = [{ e: p, slot: body.toSlot }, ...(q ? [{ e: q, slot: p.slot }] : [])];
    const db = c.env.DB;
    const stmts: D1PreparedStatement[] = [];

    // First edit for this team this season: freeze the draft-derived lineup into roster_slot.
    stmts.push(...(await materializeStmts(c.env, s.year, teamId)));
    // A baseline row records where he sat before any edit — but only for players who have been here all along
    // (someone added mid-season already has an acquisition row and must not appear before it).
    const hadHistory = new Set((await db.prepare(`SELECT DISTINCT player_id AS id FROM lineup_history WHERE season = ? AND team_id = ? AND player_id IN (${changes.map(() => '?').join(',')})`)
      .bind(s.year, teamId, ...changes.map((x) => x.e.playerId)).all<{ id: number }>()).results.map((r) => r.id));
    for (const ch of changes) {
      if (!hadHistory.has(ch.e.playerId)) {
        stmts.push(db.prepare('INSERT INTO lineup_history (season, team_id, player_id, slot, from_date) VALUES (?, ?, ?, ?, ?)').bind(s.year, teamId, ch.e.playerId, was.get(ch.e.playerId)!, BASELINE));
      }
      stmts.push(
        db.prepare('INSERT INTO lineup_history (season, team_id, player_id, slot, from_date) VALUES (?, ?, ?, ?, ?) ON CONFLICT(season, team_id, player_id, from_date) DO UPDATE SET slot = excluded.slot').bind(s.year, teamId, ch.e.playerId, ch.slot, date),
      );
    }
    if (date === today) {
      // Today's edit also becomes the stored lineup. Delete then insert so the swap can't trip the (team, slot) key.
      for (const ch of changes) stmts.push(db.prepare('DELETE FROM roster_slot WHERE season = ? AND team_id = ? AND player_id = ?').bind(s.year, teamId, ch.e.playerId));
      for (const ch of changes) stmts.push(db.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(s.year, teamId, ch.e.playerId, ch.slot));
    }
    await db.batch(stmts);
    return c.json({ ok: true });
  });
}
