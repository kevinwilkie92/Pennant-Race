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
