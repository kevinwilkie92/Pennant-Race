import { ROSTER_SIZE } from './index';

// FAAB waiver processing. Assumptions (the README only gives the $300 budget, claim priority and editable bids):
//  - highest bid wins a contested player; equal bids go to the team earlier in the rolling waiver order;
//  - a team that wins a claim moves to the back of that order;
//  - one team's claims are tried in its own priority order (1 first); a failed claim falls through to the next;
//  - a player dropped in this run can't be claimed in the same run, and a player added in this run can't be dropped in it.

export type Claim = { id: number; teamId: string; addId: number; dropId: number | null; bid: number; priority: number };
/** `exempt`: roster players who don't count toward the limit (injured, in an IL slot). */
export type WaiverTeam = { faab: number; roster: Set<number>; waiverPos: number; exempt?: Set<number> };
export type Outcome = {
  claimId: number; teamId: string; addId: number; dropId: number | null; bid: number; won: boolean; reason?: string;
};

export function resolveWaivers(
  claims: Claim[],
  teams: Record<string, WaiverTeam>,
  owned: Set<number>,
  rosterSize = ROSTER_SIZE,
): { outcomes: Outcome[]; waiverPos: Record<string, number> } {
  // Work on copies so callers keep their original state.
  const st: Record<string, WaiverTeam> = {};
  for (const [id, t] of Object.entries(teams)) st[id] = { faab: t.faab, roster: new Set(t.roster), waiverPos: t.waiverPos, exempt: new Set(t.exempt ?? []) };
  const active = (t: WaiverTeam) => [...t.roster].filter((p) => !t.exempt!.has(p)).length;
  const taken = new Set(owned);
  const justAdded = new Set<number>();
  const queue = new Map<string, Claim[]>();
  for (const c of [...claims].sort((a, b) => a.priority - b.priority || a.id - b.id)) {
    queue.set(c.teamId, [...(queue.get(c.teamId) ?? []), c]);
  }

  const out: Outcome[] = [];
  for (;;) {
    const heads = [...queue.values()].filter((q) => q.length).map((q) => q[0]);
    if (!heads.length) break;
    heads.sort((a, b) => b.bid - a.bid || (st[a.teamId]?.waiverPos ?? 0) - (st[b.teamId]?.waiverPos ?? 0) || a.id - b.id);
    const c = heads[0];
    queue.get(c.teamId)!.shift();
    const t = st[c.teamId];
    const fail = (reason: string) => out.push({ claimId: c.id, teamId: c.teamId, addId: c.addId, dropId: c.dropId, bid: c.bid, won: false, reason });

    if (!t) { fail('Unknown team'); continue; }
    if (taken.has(c.addId)) { fail('Player is no longer available'); continue; }
    if (c.bid > t.faab) { fail('Not enough FAAB'); continue; }
    if (c.dropId != null && justAdded.has(c.dropId)) { fail('You can’t drop a player you just added'); continue; }
    if (c.dropId != null && !t.roster.has(c.dropId)) { fail('The player you chose to drop is no longer on your roster'); continue; }
    // Dropping an injured (exempt) player doesn't free an active spot.
    const frees = c.dropId != null && !t.exempt!.has(c.dropId) ? 1 : 0;
    if (active(t) - frees + 1 > rosterSize) { fail('Roster full — choose a player to drop'); continue; }

    t.faab -= c.bid;
    if (c.dropId != null) t.roster.delete(c.dropId); // stays in `taken`: not claimable again this run
    t.roster.add(c.addId);
    taken.add(c.addId);
    justAdded.add(c.addId);
    // Rolling order: the winner goes to the back.
    const pos = t.waiverPos, n = Object.keys(st).length;
    for (const o of Object.values(st)) if (o.waiverPos > pos) o.waiverPos -= 1;
    t.waiverPos = n;
    out.push({ claimId: c.id, teamId: c.teamId, addId: c.addId, dropId: c.dropId, bid: c.bid, won: true });
  }
  return { outcomes: out, waiverPos: Object.fromEntries(Object.entries(st).map(([id, t]) => [id, t.waiverPos])) };
}
