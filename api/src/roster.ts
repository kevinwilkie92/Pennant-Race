import { assignSlots, slotLabelRank } from '@pennant/domain';
import type { Env } from './types';

export type RosterEntry = {
  slot: string; playerId: number; name: string; mlbTeam: string | null; pos: string; pos2: string | null;
  positions: string[]; keeperYear: number | null; price: number | null;
};

type Row = Omit<RosterEntry, 'positions'> & { positions: string | null };

/**
 * A team's roster for a season. Archived seasons have frozen roster_slot rows. A live season doesn't,
 * so its roster is the draft sales auto-slotted (position, then IF, then Util, then bench) until lineup
 * editing exists. Either way the result is ordered hitters, pitchers, bench.
 */
export async function loadRoster(env: Env, yr: number, teamId: string): Promise<RosterEntry[]> {
  const cols = `p.id AS playerId, p.name, p.mlb_team AS mlbTeam, p.pos, p.pos2,
       (SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = p.id AND pp.season = ?1) AS positions,
       k.year AS keeperYear, ds.price`;
  const joins = `JOIN player p ON p.id = x.player_id
       LEFT JOIN keeper k ON k.season = ?1 AND k.player_id = p.id
       LEFT JOIN draft_sale ds ON ds.season = ?1 AND ds.player_id = p.id`;

  const slotted = (await env.DB.prepare(
    `SELECT x.slot, ${cols} FROM roster_slot x ${joins} WHERE x.season = ?1 AND x.team_id = ?2`,
  ).bind(yr, teamId).all<Row>()).results;

  let rows: Row[] = slotted;
  if (!slotted.length) {
    const sold = (await env.DB.prepare(
      `SELECT '' AS slot, ${cols} FROM draft_sale x ${joins} WHERE x.season = ?1 AND x.team_id = ?2 ORDER BY x.seq`,
    ).bind(yr, teamId).all<Row>()).results;
    const withPos = sold.map((r) => ({ ...r, list: (r.positions ?? [r.pos, r.pos2].filter(Boolean).join(',')).split(',').filter(Boolean) }));
    const slots = assignSlots(withPos.map((r) => ({ playerId: r.playerId, positions: r.list, slot: null })));
    rows = withPos.flatMap((r) => (slots.has(r.playerId) ? [{ ...r, slot: slots.get(r.playerId)! }] : []));
  }
  return rows
    .map((r) => ({ ...r, positions: (r.positions ?? [r.pos, r.pos2].filter(Boolean).join(',')).split(',').filter(Boolean) }))
    .sort((a, b) => slotLabelRank(a.slot) - slotLabelRank(b.slot));
}

/** Player details for specific ids (used for players who aren't on a team's current roster any more). */
export async function playerEntries(env: Env, yr: number, ids: number[]): Promise<Map<number, Omit<RosterEntry, 'slot'>>> {
  if (!ids.length) return new Map();
  const ph = ids.map((_, i) => `?${i + 2}`).join(',');
  const { results } = await env.DB.prepare(
    `SELECT p.id AS playerId, p.name, p.mlb_team AS mlbTeam, p.pos, p.pos2,
            (SELECT group_concat(position) FROM player_position pp WHERE pp.player_id = p.id AND pp.season = ?1) AS positions,
            k.year AS keeperYear, ds.price
       FROM player p
       LEFT JOIN keeper k ON k.season = ?1 AND k.player_id = p.id
       LEFT JOIN draft_sale ds ON ds.season = ?1 AND ds.player_id = p.id
      WHERE p.id IN (${ph})`,
  ).bind(yr, ...ids).all<Omit<RosterEntry, 'slot' | 'positions'> & { positions: string | null }>();
  return new Map(results.map((r) => [r.playerId, {
    ...r, positions: (r.positions ?? [r.pos, r.pos2].filter(Boolean).join(',')).split(',').filter(Boolean),
  }]));
}

/** Who owns each player right now (a team whose lineup isn't stored yet owns its draft sales). */
export async function ownerMap(env: Env, yr: number): Promise<Map<number, string>> {
  const { results } = await env.DB.prepare(
    `SELECT player_id AS playerId, team_id AS teamId FROM roster_slot WHERE season = ?1
     UNION ALL
     SELECT player_id, team_id FROM draft_sale WHERE season = ?1 AND team_id NOT IN (SELECT DISTINCT team_id FROM roster_slot WHERE season = ?1)`,
  ).bind(yr).all<{ playerId: number; teamId: string }>();
  return new Map(results.map((r) => [r.playerId, r.teamId]));
}

/** Statements that freeze a team's draft-derived lineup into roster_slot (no-op if already stored). */
export async function materializeStmts(env: Env, yr: number, teamId: string): Promise<D1PreparedStatement[]> {
  const stored = await env.DB.prepare('SELECT 1 FROM roster_slot WHERE season = ? AND team_id = ? LIMIT 1').bind(yr, teamId).first();
  if (stored) return [];
  const current = await loadRoster(env, yr, teamId);
  return current.map((e) => env.DB.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(yr, teamId, e.playerId, e.slot));
}
