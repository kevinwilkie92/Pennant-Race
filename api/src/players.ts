import type { Hono } from 'hono';
import { INJURY_STATUSES, ROSTER_SIZE, canFillSlot, countsAgainstRoster, isILSlot, placePlayer, resolveWaivers, type Claim } from '@pennant/domain';
import { requireAuth, requireCommissioner } from './auth';
import { lineupAt } from './lineup';
import { activeCount, loadRoster, materializeStmts, ownerMap, playerEntries, type RosterEntry } from './roster';
import { isoNow, leagueToday } from './time';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function liveSeason(env: Env): Promise<number | null> {
  return (await env.DB.prepare("SELECT year FROM season WHERE status = 'live' ORDER BY year DESC LIMIT 1").first<{ year: number }>())?.year ?? null;
}
async function anySeason(env: Env): Promise<number | null> {
  return (await env.DB.prepare("SELECT year FROM season ORDER BY (status = 'live') DESC, year DESC LIMIT 1").first<{ year: number }>())?.year ?? null;
}

type ClaimRow = { id: number; teamId: string; addId: number; dropId: number | null; bid: number; priority: number; status: string; reason: string | null; createdAt: number; processedAt: number | null };
const CLAIM_COLS = `id, team_id AS teamId, add_player_id AS addId, drop_player_id AS dropId, bid, priority, status, reason, created_at AS createdAt, processed_at AS processedAt`;

const pendingFor = async (env: Env, yr: number, teamId: string) =>
  (await env.DB.prepare(`SELECT ${CLAIM_COLS} FROM waiver_claim WHERE season = ? AND team_id = ? AND status = 'pending' ORDER BY priority, id`).bind(yr, teamId).all<ClaimRow>()).results;

/** Keep a team's pending priorities contiguous (1..n) in their current order. */
const resequence = (env: Env, ids: number[]) =>
  ids.map((id, i) => env.DB.prepare('UPDATE waiver_claim SET priority = ? WHERE id = ?').bind(i + 1, id));

const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

/** Days a dropped player stays on waivers before he can be won. Commissioner-editable; defaults to 2 (Yahoo's default). */
export async function waiverDays(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT settings_json AS s FROM league WHERE id = 1').first<{ s: string }>();
  try { const n = Number(JSON.parse(row?.s ?? '{}').waiverDays); return Number.isInteger(n) && n >= 0 && n <= 14 ? n : 2; } catch { return 2; }
}

/** Puts a dropped player on waivers (no-op when the period is 0 days). */
export function waiverClearStmt(env: Env, yr: number, playerId: number, teamId: string, today: string, days: number): D1PreparedStatement[] {
  return days > 0
    ? [env.DB.prepare('INSERT OR REPLACE INTO waiver_clear (season, player_id, clears_on, dropped_by) VALUES (?, ?, ?, ?)').bind(yr, playerId, addDays(today, days), teamId)]
    : [env.DB.prepare('DELETE FROM waiver_clear WHERE season = ? AND player_id = ?').bind(yr, playerId)];
}

export type ProcessResult = { season: number; won: number; failed: number; deferred: number };

/** Resolves every pending claim for the live season and applies the results. Safe to run repeatedly. */
export async function processWaivers(env: Env, asOf?: string): Promise<ProcessResult | null> {
  const yr = await liveSeason(env);
  if (yr == null) return null;
  const runDate = asOf ?? leagueToday();     // `asOf` lets tests ask "what clears on this date?"
  const all = (await env.DB.prepare(`SELECT ${CLAIM_COLS} FROM waiver_claim WHERE season = ? AND status = 'pending'`).bind(yr).all<ClaimRow>()).results;
  // A player dropped recently is on waivers: claims for him wait (stay pending) until his period clears.
  const onWaivers = new Set((await env.DB.prepare('SELECT player_id AS id FROM waiver_clear WHERE season = ? AND clears_on > ?').bind(yr, runDate).all<{ id: number }>()).results.map((r) => r.id));
  const claims = all.filter((c) => !onWaivers.has(c.addId));
  const deferred = all.length - claims.length;
  if (!claims.length) return { season: yr, won: 0, failed: 0, deferred };
  const days = await waiverDays(env);

  const teamRows = (await env.DB.prepare('SELECT id, faab, waiver_pos AS waiverPos FROM team').all<{ id: string; faab: number; waiverPos: number }>()).results;
  const lineups = new Map<string, RosterEntry[]>();
  for (const t of teamRows) lineups.set(t.id, await loadRoster(env, yr, t.id));
  const teams = Object.fromEntries(teamRows.map((t) => [t.id, { faab: t.faab, waiverPos: t.waiverPos, roster: new Set(lineups.get(t.id)!.map((e) => e.playerId)), exempt: new Set(lineups.get(t.id)!.filter((e) => !countsAgainstRoster(e.slot, e.injury)).map((e) => e.playerId)) }]));
  const owned = new Set([...(await ownerMap(env, yr)).keys()]);

  const input: Claim[] = claims.map((c) => ({ id: c.id, teamId: c.teamId, addId: c.addId, dropId: c.dropId, bid: c.bid, priority: c.priority }));
  const { outcomes, waiverPos } = resolveWaivers(input, teams, owned);

  const today = leagueToday();
  const now = Date.now();
  const info = await playerEntries(env, yr, [...new Set(outcomes.flatMap((o) => [o.addId, o.dropId].filter((x): x is number => x != null)))]);
  const stmts: D1PreparedStatement[] = [];
  const stored = new Set<string>();
  const addedNow = new Set<number>();                 // added earlier in this run: no baseline row for them
  const db = env.DB;

  for (const o of outcomes) {
    if (!o.won) {
      stmts.push(db.prepare("UPDATE waiver_claim SET status = 'failed', reason = ?, processed_at = ? WHERE id = ?").bind(o.reason ?? 'Failed', now, o.claimId));
      continue;
    }
    const lineup = lineups.get(o.teamId)!;
    const add = info.get(o.addId)!;
    const drop = o.dropId != null ? lineup.find((e) => e.playerId === o.dropId) : undefined;

    // Which slot the new player takes: the dropped player's if he fits; otherwise the shortest chain of moves
    // that leaves a legal lineup (someone may have to shift, e.g. a bench RP into the vacated RP slot).
    const rest = lineup.filter((e) => e.playerId !== o.dropId);
    const moves = drop && !isILSlot(drop.slot) && canFillSlot(drop.slot, add.positions)
      ? new Map<number, string>([[o.addId, drop.slot]])
      : placePlayer(rest.map((e) => ({ playerId: e.playerId, positions: e.positions, slot: e.slot })), { playerId: o.addId, positions: add.positions });
    if (!moves) { // can't happen while the roster limit equals the slot count, but never lose a claim silently
      stmts.push(db.prepare("UPDATE waiver_claim SET status = 'failed', reason = ?, processed_at = ? WHERE id = ?").bind('No legal lineup slot', now, o.claimId));
      continue;
    }
    const slot = moves.get(o.addId)!;
    const moved = rest.filter((e) => moves.has(e.playerId));
    lineups.set(o.teamId, [...rest.map((e) => (moves.has(e.playerId) ? { ...e, slot: moves.get(e.playerId)! } : e)), { ...add, slot }]);

    if (!stored.has(o.teamId)) { stmts.push(...(await materializeStmts(env, yr, o.teamId))); stored.add(o.teamId); }
    if (drop) {
      stmts.push(...(await dropStmts(env, yr, o.teamId, drop, today)));
      stmts.push(...waiverClearStmt(env, yr, drop.playerId, o.teamId, today, days));
      stmts.push(db.prepare("INSERT INTO \"transaction\" (season, type, team_id, player_id, status, created_at) VALUES (?, 'drop', ?, ?, 'done', ?)").bind(yr, o.teamId, drop.playerId, now));
    }
    // Everyone who shifts keeps a history row, so past days still show where they were.
    for (const m of moved) {
      stmts.push(...(await historyStmts(env, yr, o.teamId, m.playerId, m.slot, moves.get(m.playerId)!, today, addedNow)));
      stmts.push(db.prepare('DELETE FROM roster_slot WHERE season = ? AND team_id = ? AND player_id = ?').bind(yr, o.teamId, m.playerId));
    }
    for (const m of moved) stmts.push(db.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(yr, o.teamId, m.playerId, moves.get(m.playerId)!));
    addedNow.add(o.addId);
    stmts.push(
      db.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(yr, o.teamId, o.addId, slot),
      db.prepare('INSERT INTO lineup_history (season, team_id, player_id, slot, from_date) VALUES (?, ?, ?, ?, ?) ON CONFLICT(season, team_id, player_id, from_date) DO UPDATE SET slot = excluded.slot').bind(yr, o.teamId, o.addId, slot, today),
      db.prepare('DELETE FROM waiver_clear WHERE season = ? AND player_id = ?').bind(yr, o.addId),
      db.prepare('UPDATE team SET faab = faab - ? WHERE id = ?').bind(o.bid, o.teamId),
      db.prepare("INSERT INTO \"transaction\" (season, type, team_id, player_id, faab, status, created_at) VALUES (?, 'waiver', ?, ?, ?, 'done', ?)").bind(yr, o.teamId, o.addId, o.bid, now),
      db.prepare("UPDATE waiver_claim SET status = 'won', processed_at = ? WHERE id = ?").bind(now, o.claimId),
    );
  }
  for (const [id, pos] of Object.entries(waiverPos)) stmts.push(db.prepare('UPDATE team SET waiver_pos = ? WHERE id = ?').bind(pos, id));
  await db.batch(stmts);
  return { season: yr, won: outcomes.filter((o) => o.won).length, failed: outcomes.filter((o) => !o.won).length, deferred };
}

/**
 * History rows for a slot change effective `date`. A baseline row (the slot before any edit) is added only for
 * players who have been on the team all along — never for someone added mid-season or earlier in this same run.
 */
export async function historyStmts(env: Env, yr: number, teamId: string, playerId: number, oldSlot: string, newSlot: string, date: string, addedNow: Set<number>): Promise<D1PreparedStatement[]> {
  const had = addedNow.has(playerId) || await env.DB.prepare('SELECT 1 FROM lineup_history WHERE season = ? AND team_id = ? AND player_id = ? LIMIT 1').bind(yr, teamId, playerId).first();
  return [
    ...(had ? [] : [env.DB.prepare('INSERT OR IGNORE INTO lineup_history (season, team_id, player_id, slot, from_date) VALUES (?, ?, ?, ?, ?)').bind(yr, teamId, playerId, oldSlot, '0000-00-00')]),
    env.DB.prepare('INSERT INTO lineup_history (season, team_id, player_id, slot, from_date) VALUES (?, ?, ?, ?, ?) ON CONFLICT(season, team_id, player_id, from_date) DO UPDATE SET slot = excluded.slot').bind(yr, teamId, playerId, newSlot, date),
  ];
}

/** Removes a player from a team's stored roster and records it in the lineup history. */
export async function dropStmts(env: Env, yr: number, teamId: string, p: RosterEntry, date: string): Promise<D1PreparedStatement[]> {
  return [
    ...(await historyStmts(env, yr, teamId, p.playerId, p.slot, '', date, new Set())),
    env.DB.prepare('DELETE FROM roster_slot WHERE season = ? AND team_id = ? AND player_id = ?').bind(yr, teamId, p.playerId),
  ];
}

export function registerPlayers(app: App) {
  const canAct = (u: AppVars['user'], teamId: string) => u.isCommissioner || u.teamId === teamId;
  const teamOf = (c: { get: (k: 'user') => AppVars['user']; req: { query: (k: string) => string | undefined } }, body?: { teamId?: string }) =>
    body?.teamId ?? c.req.query('teamId') ?? c.get('user').teamId;

  // ------------------------------------------------------------ pool + watchlist
  app.get('/players/pool', requireAuth, async (c) => {
    const yr = await anySeason(c.env);
    if (yr == null) return c.json({ season: null, total: 0, players: [] });
    const q = norm(c.req.query('q') ?? '');
    const pos = c.req.query('pos');
    const free = c.req.query('owned') !== 'all';
    const sort = c.req.query('sort') ?? 'name';
    const dir = c.req.query('dir') === 'desc' ? -1 : 1;
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 300);
    const offset = Number(c.req.query('offset') ?? 0);

    const owners = await ownerMap(c.env, yr);
    const watched = new Set((await c.env.DB.prepare('SELECT player_id AS id FROM watchlist WHERE user_id = ?').bind(c.get('user').id).all<{ id: number }>()).results.map((r) => r.id));
    const watchOnly = c.req.query('watch') === '1';
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.mlb_team AS mlbTeam, p.pos, p.pos2,
              (SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = p.id AND pp.season = ?1) AS positions,
              ps.status AS injury, wc.clears_on AS waiversUntil
         FROM player p LEFT JOIN player_status ps ON ps.player_id = p.id
         LEFT JOIN waiver_clear wc ON wc.player_id = p.id AND wc.season = ?1 AND wc.clears_on > ?2`,
    ).bind(yr, leagueToday()).all<{ id: number; name: string; mlbTeam: string | null; pos: string; pos2: string | null; positions: string | null; injury: string | null; waiversUntil: string | null }>();
    let rows = results.map((r) => ({
      id: r.id, name: r.name, mlbTeam: r.mlbTeam, pos: r.pos,
      positions: (r.positions ?? [r.pos, r.pos2].filter(Boolean).join(',')).split(',').filter(Boolean),
      ownerId: owners.get(r.id) ?? null, watched: watched.has(r.id), injury: r.injury, waiversUntil: r.waiversUntil,
    }));
    rows = rows.filter((r) => (free ? !r.ownerId : true) && (!watchOnly || r.watched) && (!q || norm(r.name).includes(q)) && (!pos || pos === 'ALL' || r.positions.includes(pos)));
    const key = (r: (typeof rows)[number]) => (sort === 'team' ? r.mlbTeam ?? '' : sort === 'pos' ? r.positions[0] ?? '' : r.name);
    rows.sort((a, b) => dir * key(a).localeCompare(key(b)) || a.name.localeCompare(b.name));
    return c.json({ season: yr, total: rows.length, players: rows.slice(offset, offset + limit) });
  });

  app.put('/watchlist', requireAuth, async (c) => {
    const { playerId, watched } = await c.req.json<{ playerId: number; watched: boolean }>();
    const u = c.get('user');
    await (watched
      ? c.env.DB.prepare('INSERT OR IGNORE INTO watchlist (user_id, player_id) VALUES (?, ?)').bind(u.id, playerId)
      : c.env.DB.prepare('DELETE FROM watchlist WHERE user_id = ? AND player_id = ?').bind(u.id, playerId)).run();
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ claims
  app.get('/claims', requireAuth, async (c) => {
    const teamId = teamOf(c);
    const yr = await anySeason(c.env);
    if (!teamId || yr == null) return c.json({ season: yr, faab: 0, pending: [], recent: [] });
    const rows = (await c.env.DB.prepare(`SELECT ${CLAIM_COLS} FROM waiver_claim WHERE season = ? AND team_id = ? ORDER BY (status = 'pending') DESC, priority, id DESC LIMIT 60`).bind(yr, teamId).all<ClaimRow>()).results;
    const ids = [...new Set(rows.flatMap((r) => [r.addId, r.dropId].filter((x): x is number => x != null)))];
    const names = await playerEntries(c.env, yr, ids);
    const wv = new Map((await c.env.DB.prepare('SELECT player_id AS id, clears_on AS clearsOn FROM waiver_clear WHERE season = ? AND clears_on > ?').bind(yr, leagueToday()).all<{ id: number; clearsOn: string }>()).results.map((r) => [r.id, r.clearsOn]));
    const view = rows.map((r) => ({ ...r, addName: names.get(r.addId)?.name, dropName: r.dropId != null ? names.get(r.dropId)?.name : null, waiversUntil: wv.get(r.addId) ?? null }));
    const faab = (await c.env.DB.prepare('SELECT faab FROM team WHERE id = ?').bind(teamId).first<{ faab: number }>())?.faab ?? 0;
    return c.json({ season: yr, faab, pending: view.filter((r) => r.status === 'pending'), recent: view.filter((r) => r.status !== 'pending').slice(0, 20) });
  });

  async function validate(env: Env, yr: number, teamId: string, add: number, drop: number | null, bid: number, ignoreClaimId?: number) {
    if (!Number.isInteger(bid) || bid < 0) return 'Bid must be a whole number of dollars (0 or more)';
    const faab = (await env.DB.prepare('SELECT faab FROM team WHERE id = ?').bind(teamId).first<{ faab: number }>())?.faab ?? 0;
    if (bid > faab) return `You only have $${faab} FAAB left`;
    const owners = await ownerMap(env, yr);
    if (owners.has(add)) return 'That player is already on a roster';
    const roster = await loadRoster(env, yr, teamId);
    if (drop != null && !roster.some((e) => e.playerId === drop)) return 'The player you chose to drop is not on your roster';
    const dropped = drop != null ? roster.find((e) => e.playerId === drop) : undefined;
    const frees = dropped && countsAgainstRoster(dropped.slot, dropped.injury) ? 1 : 0;
    if (activeCount(roster) - frees + 1 > ROSTER_SIZE) {
      return dropped && !frees ? 'Dropping an injured-list player doesn’t free a roster spot — choose someone else to drop' : 'Your roster is full — choose a player to drop';
    }
    const dup = await env.DB.prepare("SELECT id FROM waiver_claim WHERE season = ? AND team_id = ? AND add_player_id = ? AND status = 'pending'").bind(yr, teamId, add).first<{ id: number }>();
    if (dup && dup.id !== ignoreClaimId) return 'You already have a pending claim for that player';
    return null;
  }

  app.post('/claims', requireAuth, async (c) => {
    const u = c.get('user');
    const b = await c.req.json<{ teamId?: string; addPlayerId: number; dropPlayerId?: number | null; bid?: number }>();
    const teamId = teamOf(c, b);
    if (!teamId || !canAct(u, teamId)) return c.json({ error: 'You can only make claims for your own team' }, 403);
    const yr = await liveSeason(c.env);
    if (yr == null) return c.json({ error: 'The season is not live' }, 409);
    const bid = b.bid ?? 0;
    const err = await validate(c.env, yr, teamId, b.addPlayerId, b.dropPlayerId ?? null, bid);
    if (err) return c.json({ error: err }, 400);
    const priority = (await pendingFor(c.env, yr, teamId)).length + 1;
    const r = await c.env.DB.prepare('INSERT INTO waiver_claim (season, team_id, add_player_id, drop_player_id, bid, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(yr, teamId, b.addPlayerId, b.dropPlayerId ?? null, bid, priority, 'pending', Date.now()).run();
    return c.json({ id: r.meta.last_row_id, priority }, 201);
  });

  app.patch('/claims/:id', requireAuth, async (c) => {
    const u = c.get('user');
    const id = Number(c.req.param('id'));
    const claim = await c.env.DB.prepare(`SELECT ${CLAIM_COLS}, season FROM waiver_claim WHERE id = ?`).bind(id).first<ClaimRow & { season: number }>();
    if (!claim) return c.json({ error: 'Claim not found' }, 404);
    if (!canAct(u, claim.teamId)) return c.json({ error: 'Not your claim' }, 403);
    if (claim.status !== 'pending') return c.json({ error: 'That claim has already been processed' }, 409);
    const b = await c.req.json<{ bid?: number; dropPlayerId?: number | null; move?: 'up' | 'down' }>();

    if (b.move) {
      const list = (await pendingFor(c.env, claim.season, claim.teamId)).map((r) => r.id);
      const i = list.indexOf(id), j = b.move === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) { [list[i], list[j]] = [list[j], list[i]]; await c.env.DB.batch(resequence(c.env, list)); }
      return c.json({ ok: true });
    }
    const bid = b.bid ?? claim.bid;
    const drop = 'dropPlayerId' in b ? b.dropPlayerId ?? null : claim.dropId;
    const err = await validate(c.env, claim.season, claim.teamId, claim.addId, drop, bid, id);
    if (err) return c.json({ error: err }, 400);
    await c.env.DB.prepare('UPDATE waiver_claim SET bid = ?, drop_player_id = ? WHERE id = ?').bind(bid, drop, id).run();
    return c.json({ ok: true });
  });

  app.delete('/claims/:id', requireAuth, async (c) => {
    const u = c.get('user');
    const id = Number(c.req.param('id'));
    const claim = await c.env.DB.prepare('SELECT team_id AS teamId, season, status FROM waiver_claim WHERE id = ?').bind(id).first<{ teamId: string; season: number; status: string }>();
    if (!claim) return c.json({ error: 'Claim not found' }, 404);
    if (!canAct(u, claim.teamId)) return c.json({ error: 'Not your claim' }, 403);
    if (claim.status !== 'pending') return c.json({ error: 'That claim has already been processed' }, 409);
    await c.env.DB.prepare("UPDATE waiver_claim SET status = 'cancelled', processed_at = ? WHERE id = ?").bind(Date.now(), id).run();
    const rest = (await pendingFor(c.env, claim.season, claim.teamId)).map((r) => r.id);
    if (rest.length) await c.env.DB.batch(resequence(c.env, rest));
    return c.json({ ok: true });
  });

  app.post('/waivers/process', requireAuth, requireCommissioner, async (c) => {
    const body = await c.req.json<{ asOf?: string }>().catch(() => ({} as { asOf?: string }));
    const r = await processWaivers(c.env, /^\d{4}-\d{2}-\d{2}$/.test(body.asOf ?? '') ? body.asOf : undefined);
    return r ? c.json(r) : c.json({ error: 'The season is not live' }, 409);
  });

  // ------------------------------------------------------------ immediate drop
  app.post('/roster/drop', requireAuth, async (c) => {
    const u = c.get('user');
    const b = await c.req.json<{ teamId?: string; playerId: number }>();
    const teamId = teamOf(c, b);
    if (!teamId || !canAct(u, teamId)) return c.json({ error: 'You can only drop players from your own team' }, 403);
    const yr = await liveSeason(c.env);
    if (yr == null) return c.json({ error: 'The season is not live' }, 409);
    const today = leagueToday();
    const entries = await lineupAt(c.env, yr, teamId, today);
    const p = entries.find((e) => e.playerId === b.playerId);
    if (!p) return c.json({ error: 'That player is not on your roster' }, 404);
    if (p.mlbTeam) {
      const started = await c.env.DB.prepare('SELECT 1 FROM mlb_game WHERE date = ? AND team = ? AND start_utc <= ?').bind(today, p.mlbTeam, isoNow()).first();
      if (started) return c.json({ error: `${p.name}’s game has started; he’s locked today` }, 409);
    }
    const stmts = [
      ...(await materializeStmts(c.env, yr, teamId)),
      ...(await dropStmts(c.env, yr, teamId, p, today)),
      ...waiverClearStmt(c.env, yr, p.playerId, teamId, today, await waiverDays(c.env)),
      c.env.DB.prepare("INSERT INTO \"transaction\" (season, type, team_id, player_id, status, created_at) VALUES (?, 'drop', ?, ?, 'done', ?)").bind(yr, teamId, p.playerId, Date.now()),
      // Any pending claim that was going to drop him no longer has a drop.
      c.env.DB.prepare("UPDATE waiver_claim SET drop_player_id = NULL WHERE season = ? AND team_id = ? AND status = 'pending' AND drop_player_id = ?").bind(yr, teamId, p.playerId),
    ];
    await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ injuries, settings, player card
  // Injury status feeds the injured list. The stats feed will maintain it; until then the commissioner sets it.
  app.put('/players/:id/status', requireAuth, requireCommissioner, async (c) => {
    const id = Number(c.req.param('id'));
    const b = await c.req.json<{ status: string | null; note?: string }>();
    if (b.status !== null && !(INJURY_STATUSES as string[]).includes(b.status)) return c.json({ error: `Status must be one of ${INJURY_STATUSES.join(', ')} or null` }, 400);
    if (!(await c.env.DB.prepare('SELECT 1 FROM player WHERE id = ?').bind(id).first())) return c.json({ error: 'Player not found' }, 404);
    await (b.status === null
      ? c.env.DB.prepare('DELETE FROM player_status WHERE player_id = ?').bind(id)
      : c.env.DB.prepare('INSERT INTO player_status (player_id, status, note, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at')
          .bind(id, b.status, b.note ?? null, Date.now())).run();
    return c.json({ ok: true });
  });

  app.get('/league/settings', requireAuth, async (c) => c.json({ waiverDays: await waiverDays(c.env) }));
  app.put('/league/settings', requireAuth, requireCommissioner, async (c) => {
    const b = await c.req.json<{ waiverDays?: number }>();
    if (b.waiverDays !== undefined && !(Number.isInteger(b.waiverDays) && b.waiverDays >= 0 && b.waiverDays <= 14)) return c.json({ error: 'Waiver period must be 0–14 days' }, 400);
    const row = await c.env.DB.prepare('SELECT settings_json AS s FROM league WHERE id = 1').first<{ s: string }>();
    const cur = (() => { try { return JSON.parse(row?.s ?? '{}'); } catch { return {}; } })();
    await c.env.DB.prepare('UPDATE league SET settings_json = ? WHERE id = 1').bind(JSON.stringify({ ...cur, ...(b.waiverDays !== undefined ? { waiverDays: b.waiverDays } : {}) })).run();
    return c.json({ waiverDays: await waiverDays(c.env) });
  });

  // Everything we know about a player from our own data. Season / game-log / career stats need the stats feed.
  app.get('/players/:id/card', requireAuth, async (c) => {
    const id = Number(c.req.param('id'));
    const yr = (await anySeason(c.env)) ?? 0;
    const p = await playerEntries(c.env, yr, [id]).then((m) => m.get(id));
    if (!p) return c.json({ error: 'Player not found' }, 404);
    const owner = (await ownerMap(c.env, yr)).get(id) ?? null;
    const status = await c.env.DB.prepare('SELECT status, note FROM player_status WHERE player_id = ?').bind(id).first<{ status: string; note: string | null }>();
    const wv = await c.env.DB.prepare('SELECT clears_on AS clearsOn FROM waiver_clear WHERE season = ? AND player_id = ? AND clears_on > ?').bind(yr, id, leagueToday()).first<{ clearsOn: string }>();
    const draft = (await c.env.DB.prepare('SELECT ds.season, ds.team_id AS teamId, ds.price, ds.is_keeper AS isKeeper, k.year AS keeperYear FROM draft_sale ds LEFT JOIN keeper k ON k.season = ds.season AND k.player_id = ds.player_id WHERE ds.player_id = ? ORDER BY ds.season DESC').bind(id).all()).results;
    const moves = (await c.env.DB.prepare(`SELECT type, team_id AS teamId, faab, created_at AS at FROM "transaction" WHERE player_id = ? ORDER BY id DESC LIMIT 50`).bind(id).all()).results;
    const trades = (await c.env.DB.prepare(`SELECT from_team AS fromTeam, to_team AS toTeam, give_json AS give, resolved_at AS at FROM trade_offer WHERE status = 'accepted' AND (EXISTS (SELECT 1 FROM json_each(give_json) WHERE value = ?1) OR EXISTS (SELECT 1 FROM json_each(get_json) WHERE value = ?1)) ORDER BY id DESC LIMIT 20`).bind(id).all<{ fromTeam: string; toTeam: string; give: string; at: number }>()).results
      .map((t) => ({ type: 'trade', teamId: (JSON.parse(t.give) as number[]).includes(id) ? t.toTeam : t.fromTeam, from: (JSON.parse(t.give) as number[]).includes(id) ? t.fromTeam : t.toTeam, faab: null, at: t.at }));
    const points = (await c.env.DB.prepare('SELECT date, team_id AS teamId, slot, points FROM daily_points WHERE season = ? AND player_id = ? ORDER BY date DESC LIMIT 30').bind(yr, id).all<{ date: string; points: number }>()).results;
    return c.json({
      player: { id, name: p.name, mlbTeam: p.mlbTeam, positions: p.positions },
      ownerId: owner, injury: status ?? null, waiversUntil: wv?.clearsOn ?? null, draft,
      history: [...moves, ...trades].sort((a, b) => (b.at as number) - (a.at as number)),
      points, seasonPoints: Math.round(points.reduce((n, x) => n + x.points, 0) * 100) / 100,
    });
  });

  // ------------------------------------------------------------ league activity
  app.get('/transactions', requireAuth, async (c) => {
    const yr = await anySeason(c.env);
    if (yr == null) return c.json([]);
    const teamId = c.req.query('teamId');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.type, t.team_id AS teamId, t.faab, t.created_at AS at, t.detail, p.name AS player
         FROM "transaction" t LEFT JOIN player p ON p.id = t.player_id
        WHERE t.season = ?1 AND (?2 IS NULL OR t.team_id = ?2) ORDER BY t.id DESC LIMIT ?3`,
    ).bind(yr, teamId ?? null, limit).all();
    return c.json(results);
  });
}
