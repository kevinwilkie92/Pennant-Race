import type { Context, Hono } from 'hono';
import { canFillSlot, countsAgainstRoster, isILSlot, placePlayer, rosterSizeOf, type Layout } from '@pennant/domain';
import { loadRules } from './league-settings';
import { requireAuth } from './auth';
import { dropStmts, historyStmts } from './players';
import { later, notifyTeams } from './push';
import { activeCount, loadRoster, materializeStmts, type RosterEntry } from './roster';
import { isoNow, leagueToday } from './time';
import type { AppVars, Env } from './types';

const teamNames = async (env: Env) => new Map((await env.DB.prepare('SELECT id, name FROM team').all<{ id: string; name: string }>()).results.map((t) => [t.id, t.name]));
type App = Hono<{ Bindings: Env; Variables: AppVars }>;
const MAX_PER_SIDE = 5;

async function liveSeason(env: Env): Promise<number | null> {
  return (await env.DB.prepare("SELECT year FROM season WHERE status = 'live' ORDER BY year DESC LIMIT 1").first<{ year: number }>())?.year ?? null;
}
async function anySeason(env: Env): Promise<number | null> {
  return (await env.DB.prepare("SELECT year FROM season ORDER BY (status = 'live') DESC, year DESC LIMIT 1").first<{ year: number }>())?.year ?? null;
}

type Offer = { id: number; season: number; fromTeam: string; toTeam: string; give: number[]; get: number[]; status: string; reason: string | null; createdAt: number; resolvedAt: number | null };
const OFFER_COLS = `id, season, from_team AS fromTeam, to_team AS toTeam, give_json AS give, get_json AS get, status, reason, created_at AS createdAt, resolved_at AS resolvedAt`;
const parseOffer = (r: Omit<Offer, 'give' | 'get'> & { give: string; get: string }): Offer => ({ ...r, give: JSON.parse(r.give), get: JSON.parse(r.get) });

/** Players whose MLB team has already started today's game can't change teams today (same rule as drops). */
async function lockedNames(env: Env, entries: RosterEntry[]): Promise<string[]> {
  const today = leagueToday();
  const { results } = await env.DB.prepare('SELECT team FROM mlb_game WHERE date = ? AND start_utc <= ?').bind(today, isoNow()).all<{ team: string }>();
  const started = new Set(results.map((r) => r.team));
  return entries.filter((e) => e.mlbTeam && started.has(e.mlbTeam)).map((e) => e.name);
}

/** Why a trade can't go through right now, or null. Used when proposing, accepting, and annotating the pending list. */
async function checkTrade(env: Env, yr: number, from: string, to: string, give: number[], get: number[]): Promise<string | null> {
  if (from === to) return 'You can’t trade with yourself';
  if (!give.length || !get.length) return 'Both sides of a trade need at least one player';
  if (give.length > MAX_PER_SIDE || get.length > MAX_PER_SIDE) return `A trade can include at most ${MAX_PER_SIDE} players per side`;
  if (new Set(give).size !== give.length || new Set(get).size !== get.length) return 'A player is listed twice';
  const team = await env.DB.prepare('SELECT 1 FROM team WHERE id = ?').bind(to).first();
  if (!team) return 'Unknown team';
  const layout = (await loadRules(env)).roster, ROSTER_SIZE = rosterSizeOf(layout);
  const a = await loadRoster(env, yr, from), b = await loadRoster(env, yr, to);
  const mine = give.map((id) => a.find((e) => e.playerId === id)), theirs = get.map((id) => b.find((e) => e.playerId === id));
  if (mine.some((x) => !x)) return 'One of the players you’re offering is no longer on your roster';
  if (theirs.some((x) => !x)) return 'One of the players you’re asking for is no longer on their roster';
  // Injured players parked in IL slots don't count toward the limit; incoming players are seated in active slots.
  const activeOut = (xs: (RosterEntry | undefined)[]) => xs.filter((e) => e && countsAgainstRoster(e.slot, e.injury)).length;
  if (activeCount(a) - activeOut(mine) + get.length > ROSTER_SIZE) return `That would put ${from} over the ${ROSTER_SIZE}-player roster limit`;
  if (activeCount(b) - activeOut(theirs) + give.length > ROSTER_SIZE) return `That would put ${to} over the ${ROSTER_SIZE}-player roster limit`;
  const locked = await lockedNames(env, [...(mine as RosterEntry[]), ...(theirs as RosterEntry[])]);
  if (locked.length) return `${locked.join(', ')}: game has started, so he can’t be traded today`;
  return null;
}

/** Seats incoming players: into a vacated slot he fits if possible, otherwise by the smallest set of shifts. */
function reseat(rest: RosterEntry[], vacated: string[], incoming: RosterEntry[], layout: Layout) {
  const seated = rest.map((e) => ({ playerId: e.playerId, positions: e.positions, slot: e.slot }));
  const orig = new Map(rest.map((e) => [e.playerId, e.slot]));
  const free = [...vacated];
  const placed = new Map<number, string>();
  for (const inc of incoming) {
    const i = free.findIndex((s) => !isILSlot(s) && canFillSlot(s, inc.positions) && !seated.some((p) => p.slot === s));
    if (i >= 0) { const slot = free.splice(i, 1)[0]; placed.set(inc.playerId, slot); seated.push({ playerId: inc.playerId, positions: inc.positions, slot }); continue; }
    const mv = placePlayer(seated, { playerId: inc.playerId, positions: inc.positions }, layout);
    if (!mv) return null;
    for (const [pid, slot] of mv) {
      if (pid === inc.playerId) continue;
      seated.find((p) => p.playerId === pid)!.slot = slot;
    }
    placed.set(inc.playerId, mv.get(inc.playerId)!);
    seated.push({ playerId: inc.playerId, positions: inc.positions, slot: mv.get(inc.playerId)! });
  }
  const shifted = new Map<number, { from: string; to: string }>();
  for (const p of seated) if (orig.has(p.playerId) && orig.get(p.playerId) !== p.slot) shifted.set(p.playerId, { from: orig.get(p.playerId)!, to: p.slot });
  return { placed, shifted };
}

/** Applies an accepted trade: both rosters, lineup history, activity log, and clean-up of anything it made stale. */
async function executeTrade(env: Env, o: Offer): Promise<string | null> {
  const yr = o.season, today = leagueToday(), now = Date.now(), db = env.DB;
  const layout = (await loadRules(env)).roster;
  const a = await loadRoster(env, yr, o.fromTeam), b = await loadRoster(env, yr, o.toTeam);
  const aOut = a.filter((e) => o.give.includes(e.playerId)), bOut = b.filter((e) => o.get.includes(e.playerId));
  const aSeat = reseat(a.filter((e) => !o.give.includes(e.playerId)), aOut.map((e) => e.slot), bOut, layout);
  const bSeat = reseat(b.filter((e) => !o.get.includes(e.playerId)), bOut.map((e) => e.slot), aOut, layout);
  if (!aSeat || !bSeat) return 'No legal lineup exists after that trade';

  // A player can be on only one roster at a time (UNIQUE season+player), so every removal for BOTH teams runs
  // before any addition.
  const stmts: D1PreparedStatement[] = [...(await materializeStmts(env, yr, o.fromTeam)), ...(await materializeStmts(env, yr, o.toTeam))];
  const adds: D1PreparedStatement[] = [];
  const side = async (teamId: string, out: RosterEntry[], incoming: RosterEntry[], seat: NonNullable<ReturnType<typeof reseat>>) => {
    for (const p of out) stmts.push(...(await dropStmts(env, yr, teamId, p, today)));
    for (const [pid, m] of seat.shifted) {
      stmts.push(...(await historyStmts(env, yr, teamId, pid, m.from, m.to, today, new Set())));
      stmts.push(db.prepare('DELETE FROM roster_slot WHERE season = ? AND team_id = ? AND player_id = ?').bind(yr, teamId, pid));
      adds.push(db.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(yr, teamId, pid, m.to));
    }
    for (const p of incoming) {
      const slot = seat.placed.get(p.playerId)!;
      adds.push(
        db.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(yr, teamId, p.playerId, slot),
        db.prepare('INSERT INTO lineup_history (season, team_id, player_id, slot, from_date) VALUES (?, ?, ?, ?, ?) ON CONFLICT(season, team_id, player_id, from_date) DO UPDATE SET slot = excluded.slot').bind(yr, teamId, p.playerId, slot, today),
      );
    }
  };
  await side(o.fromTeam, aOut, bOut, aSeat);
  await side(o.toTeam, bOut, aOut, bSeat);
  stmts.push(...adds);

  const moving = [...o.give, ...o.get];
  const ph = moving.map(() => '?').join(',');
  stmts.push(
    db.prepare("UPDATE trade_offer SET status = 'accepted', resolved_at = ? WHERE id = ?").bind(now, o.id),
    // Any other pending offer that includes one of these players can no longer be honoured.
    db.prepare(`UPDATE trade_offer SET status = 'cancelled', reason = 'A player in this offer was traded elsewhere', resolved_at = ?
                 WHERE season = ? AND status = 'pending' AND id != ?
                   AND (EXISTS (SELECT 1 FROM json_each(give_json) WHERE value IN (${ph})) OR EXISTS (SELECT 1 FROM json_each(get_json) WHERE value IN (${ph})))`)
      .bind(now, yr, o.id, ...moving, ...moving),
    // A waiver claim that planned to drop a traded-away player no longer has that drop.
    db.prepare(`UPDATE waiver_claim SET drop_player_id = NULL WHERE season = ? AND status = 'pending' AND ((team_id = ? AND drop_player_id IN (${o.give.map(() => '?').join(',')})) OR (team_id = ? AND drop_player_id IN (${o.get.map(() => '?').join(',')})))`)
      .bind(yr, o.fromTeam, ...o.give, o.toTeam, ...o.get),
    db.prepare("INSERT INTO \"transaction\" (season, type, team_id, status, detail, created_at) VALUES (?, 'trade', ?, 'done', ?, ?)")
      .bind(yr, o.fromTeam, JSON.stringify({ to: o.toTeam, give: aOut.map((e) => e.name), get: bOut.map((e) => e.name) }), now),
  );
  await db.batch(stmts);
  return null;
}

export function registerTrades(app: App) {
  async function view(env: Env, yr: number, offers: Offer[]) {
    const ids = [...new Set(offers.flatMap((o) => [...o.give, ...o.get]))];
    const names = new Map<number, { id: number; name: string; mlbTeam: string | null; positions: string[] }>();
    if (ids.length) {
      const ph = ids.map((_, i) => `?${i + 2}`).join(',');
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.name, p.mlb_team AS mlbTeam, p.pos, p.pos2, (SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = p.id AND pp.season = ?1) AS positions FROM player p WHERE p.id IN (${ph})`,
      ).bind(yr, ...ids).all<{ id: number; name: string; mlbTeam: string | null; pos: string; pos2: string | null; positions: string | null }>();
      for (const r of results) names.set(r.id, { id: r.id, name: r.name, mlbTeam: r.mlbTeam, positions: (r.positions ?? [r.pos, r.pos2].filter(Boolean).join(',')).split(',').filter(Boolean) });
    }
    return Promise.all(offers.map(async (o) => ({
      ...o,
      give: o.give.map((id) => names.get(id) ?? { id, name: `#${id}`, mlbTeam: null, positions: [] }),
      get: o.get.map((id) => names.get(id) ?? { id, name: `#${id}`, mlbTeam: null, positions: [] }),
      problem: o.status === 'pending' ? await checkTrade(env, yr, o.fromTeam, o.toTeam, o.give, o.get) : null,
    })));
  }

  app.get('/trades', requireAuth, async (c) => {
    const yr = await anySeason(c.env);
    const teamId = c.req.query('teamId') ?? c.get('user').teamId;
    if (yr == null || !teamId) return c.json({ season: yr, sent: [], received: [], history: [] });
    const rows = (await c.env.DB.prepare(`SELECT ${OFFER_COLS} FROM trade_offer WHERE season = ? AND (from_team = ? OR to_team = ?) ORDER BY id DESC LIMIT 60`)
      .bind(yr, teamId, teamId).all<Omit<Offer, 'give' | 'get'> & { give: string; get: string }>()).results.map(parseOffer);
    const v = await view(c.env, yr, rows);
    return c.json({
      season: yr,
      sent: v.filter((o) => o.status === 'pending' && o.fromTeam === teamId),
      received: v.filter((o) => o.status === 'pending' && o.toTeam === teamId),
      history: v.filter((o) => o.status !== 'pending').slice(0, 20),
    });
  });

  app.post('/trades', requireAuth, async (c) => {
    const u = c.get('user');
    const b = await c.req.json<{ toTeam: string; give: number[]; get: number[] }>();
    if (!u.teamId) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    const yr = await liveSeason(c.env);
    if (yr == null) return c.json({ error: 'The season is not live' }, 409);
    const err = await checkTrade(c.env, yr, u.teamId, b.toTeam, b.give ?? [], b.get ?? []);
    if (err) return c.json({ error: err }, err.includes('game has started') ? 409 : 400);
    const r = await c.env.DB.prepare('INSERT INTO trade_offer (season, from_team, to_team, give_json, get_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(yr, u.teamId, b.toTeam, JSON.stringify(b.give), JSON.stringify(b.get), 'pending', Date.now()).run();
    later(c, teamNames(c.env).then((n) => notifyTeams(c.env, [b.toTeam], { kind: 'trade', title: `Trade offer from ${n.get(u.teamId!) ?? u.teamId}`, body: `They give ${b.give.length} player${b.give.length === 1 ? '' : 's'} and want ${b.get.length}`, url: '/team', tag: 'trade' })));
    return c.json({ id: r.meta.last_row_id }, 201);
  });

  const load = async (env: Env, id: number) => {
    const r = await env.DB.prepare(`SELECT ${OFFER_COLS} FROM trade_offer WHERE id = ?`).bind(id).first<Omit<Offer, 'give' | 'get'> & { give: string; get: string }>();
    return r ? parseOffer(r) : null;
  };

  app.post('/trades/:id/accept', requireAuth, async (c) => {
    const u = c.get('user');
    const o = await load(c.env, Number(c.req.param('id')));
    if (!o) return c.json({ error: 'Trade not found' }, 404);
    if (u.teamId !== o.toTeam) return c.json({ error: 'Only the team receiving the offer can accept it' }, 403);
    if (o.status !== 'pending') return c.json({ error: `That offer was already ${o.status}` }, 409);
    const live = await liveSeason(c.env);
    if (live !== o.season) return c.json({ error: 'The season is not live' }, 409);
    const err = await checkTrade(c.env, o.season, o.fromTeam, o.toTeam, o.give, o.get);
    if (err) return c.json({ error: err }, err.includes('game has started') ? 409 : 400);
    const bad = await executeTrade(c.env, o);
    if (!bad) later(c, teamNames(c.env).then((n) => notifyTeams(c.env, [o.fromTeam], { kind: 'trade', title: `${n.get(o.toTeam) ?? o.toTeam} accepted your trade`, body: 'The players have moved.', url: '/team', tag: 'trade' })));
    return bad ? c.json({ error: bad }, 400) : c.json({ ok: true });
  });

  const resolve = (status: 'rejected' | 'cancelled', who: (u: AppVars['user'], o: Offer) => boolean, denied: string) =>
    async (c: Context<{ Bindings: Env; Variables: AppVars }>) => {
      const u = c.get('user');
      const o = await load(c.env, Number(c.req.param('id')));
      if (!o) return c.json({ error: 'Trade not found' }, 404);
      if (!who(u, o)) return c.json({ error: denied }, 403);
      if (o.status !== 'pending') return c.json({ error: `That offer was already ${o.status}` }, 409);
      await c.env.DB.prepare('UPDATE trade_offer SET status = ?, resolved_at = ? WHERE id = ?').bind(status, Date.now(), o.id).run();
      // Tell the other side: the proposer hears about a rejection; the recipient hears about a withdrawal (and both about a veto).
      const targets = status === 'rejected' ? [o.fromTeam] : u.teamId === o.fromTeam ? [o.toTeam] : [o.fromTeam, o.toTeam].filter((t) => t !== u.teamId);
      later(c, teamNames(c.env).then((n) => notifyTeams(c.env, targets, {
        kind: 'trade', url: '/team', tag: 'trade',
        title: status === 'rejected' ? `${n.get(o.toTeam) ?? o.toTeam} declined your trade` : u.teamId === o.fromTeam ? `${n.get(o.fromTeam) ?? o.fromTeam} withdrew a trade offer` : 'A trade offer was cancelled by the commissioner',
        body: status === 'rejected' ? 'Tap to see your offers.' : 'It is no longer pending.',
      })));
      return c.json({ ok: true });
    };
  app.post('/trades/:id/reject', requireAuth, resolve('rejected', (u, o) => u.teamId === o.toTeam, 'Only the team receiving the offer can reject it'));
  // The proposer withdraws; the commissioner can also cancel (a veto).
  app.post('/trades/:id/cancel', requireAuth, resolve('cancelled', (u, o) => u.teamId === o.fromTeam || u.isCommissioner, 'Only the proposer or the commissioner can cancel an offer'));
}
