// League rules shared by the API (authoritative) and the app (display/validation).
// Source of truth: README "League rules" section.

export const BUDGET = 300;
export const MIN_BID = 1;
export const MAX_KEEPERS = 5;
export const DEFAULT_MAX_STARTS = 12;
export const FAAB_BUDGET = 300;

export type Slot =
  | 'C' | '1B' | '2B' | '3B' | 'SS' | 'INF' | 'OF' | 'UTIL'
  | 'SP' | 'RP' | 'BN';

export const HIT_SLOTS: Slot[] = ['C', '1B', '2B', '3B', 'SS', 'INF', 'OF', 'OF', 'OF', 'OF', 'UTIL', 'UTIL'];
export const PIT_SLOTS: Slot[] = ['SP', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'RP'];
export const BENCH_SLOTS: Slot[] = ['BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
export const ROSTER: Slot[] = [...HIT_SLOTS, ...PIT_SLOTS, ...BENCH_SLOTS];
export const ROSTER_SIZE = ROSTER.length; // 26

/** Display labels in roster order (seed data uses these as slot ids, e.g. "OF1", "Util2", "B3"). */
export const ROSTER_LABELS = [
  'C', '1B', '2B', '3B', 'SS', 'IF', 'OF1', 'OF2', 'OF3', 'OF4', 'Util1', 'Util2',
  'SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2', 'RP3', 'RP4',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
] as const;

/** Injured-list slots sit outside the 26-player roster: they hold injured players and don't count toward the limit. */
export const MAX_IL = 4;
export const IL_LABELS = ['IL1', 'IL2', 'IL3', 'IL4'] as const;
export const ALL_LABELS = [...ROSTER_LABELS, ...IL_LABELS] as const;

export type InjuryStatus = 'DTD' | 'IL' | 'OUT';
export const INJURY_STATUSES: InjuryStatus[] = ['DTD', 'IL', 'OUT'];
/** Only players ruled IL or OUT may sit in an IL slot (day-to-day players may not). */
export const canUseIL = (status: string | null | undefined) => status === 'IL' || status === 'OUT';
export const isILSlot = (slot: string) => slot.startsWith('IL');
/** A player in an IL slot stops counting toward the roster limit only while he is actually injured. */
export const countsAgainstRoster = (slot: string, status: string | null | undefined) => !(isILSlot(slot) && canUseIL(status));

/** Display order: hitters (INF after SS), pitchers (SP then RP), bench, then the injured list. */
export function slotLabelRank(label: string): number {
  const i = (ALL_LABELS as readonly string[]).indexOf(label);
  return i === -1 ? ALL_LABELS.length : i;
}

/** Max bid = remaining budget minus $1 held back for every other open spot. */
export function maxBid(spent: number, filled: number, budget = BUDGET, rosterSize = ROSTER_SIZE): number {
  const spots = rosterSize - filled;
  if (spots <= 0) return 0;
  return budget - spent - (spots - 1) * MIN_BID;
}

export type BidCheck = { ok: true } | { ok: false; reason: string };

export function validateBid(price: number, spent: number, filled: number): BidCheck {
  if (!Number.isInteger(price) || price < MIN_BID) return { ok: false, reason: `Bid must be a whole number of at least $${MIN_BID}` };
  if (filled >= ROSTER_SIZE) return { ok: false, reason: 'Roster is full' };
  const max = maxBid(spent, filled);
  if (price > max) return { ok: false, reason: `Bid exceeds max bid of $${max}` };
  return { ok: true };
}

// ---------------------------------------------------------------- keepers

export type KeeperHistory = {
  /** Consecutive years kept going into the new season: 0, 1 or 2. */
  yearsKept: 0 | 1 | 2;
  /** Last year's draft price, null if undrafted. */
  lastPrice: number | null;
  /** ESPN average salary (used for Year 2 cost). */
  avgSalary: number | null;
};

/** 1 = Year-1 eligible, 2 = Year-2 eligible, 0 = not eligible (kept two years running). */
export function keeperTier(h: KeeperHistory): 0 | 1 | 2 {
  return h.yearsKept === 0 ? 1 : h.yearsKept === 1 ? 2 : 0;
}

/** Year 1: last price + $5 (flat $5 if undrafted). Year 2: ESPN avg salary, rounded. Null if not eligible. */
export function keeperCost(h: KeeperHistory): number | null {
  const tier = keeperTier(h);
  if (tier === 1) return h.lastPrice != null ? h.lastPrice + 5 : 5;
  if (tier === 2) return h.avgSalary != null ? Math.round(h.avgSalary) : null;
  return null;
}

/** Season rollover: where a rostered player lands in next season's keeper buckets. */
export function rolloverBucket(currentKeeperYear: 0 | 1 | 2): 'year1' | 'year2' | 'ineligible' {
  return currentKeeperYear === 2 ? 'ineligible' : currentKeeperYear === 1 ? 'year2' : 'year1';
}

export function validateKeepers(count: number): BidCheck {
  return count > MAX_KEEPERS ? { ok: false, reason: `At most ${MAX_KEEPERS} keepers per team` } : { ok: true };
}

// ----------------------------------------------------------- scoring

export type HitLine = Partial<Record<'1B' | '2B' | '3B' | 'HR' | 'BB' | 'IBB' | 'R' | 'RBI' | 'SB' | 'SO', number>>;
export type PitLine = Partial<Record<'IP' | 'K' | 'W' | 'QS' | 'SV' | 'HLD' | 'CG' | 'SHO' | 'ER' | 'H' | 'BB', number>>;

export const HIT_SCORING: Required<HitLine> = { '1B': 1, '2B': 2, '3B': 3, HR: 4, BB: 1, IBB: 1, R: 1, RBI: 1, SB: 2, SO: -1 };
export const PIT_SCORING: Required<PitLine> = { IP: 3, K: 1, W: 2, QS: 5, SV: 5, HLD: 2, CG: 3, SHO: 3, ER: -2, H: -1, BB: -1 };

function score(line: Record<string, number | undefined>, table: Record<string, number>): number {
  let t = 0;
  for (const k of Object.keys(table)) t += (line[k] ?? 0) * table[k];
  return Math.round(t * 100) / 100;
}
export const scoreHitter = (l: HitLine, table: Record<string, number> = HIT_SCORING) => score(l, table);
export const scorePitcher = (l: PitLine, table: Record<string, number> = PIT_SCORING) => score(l, table);

// ------------------------------------------------ position eligibility

export type HitterUsage = Record<string, { starts: number; appearances: number }>;
export type PitcherUsage = { starts: number; reliefApps: number };

/**
 * Yahoo-style eligibility, computed over previous + current season combined (and sticky once earned
 * — callers persist earned positions). Hitters: 5 starts or 10 appearances at a position.
 * Pitchers: SP after 3 starts, RP after 5 relief appearances.
 */
export function hitterEligibility(usage: HitterUsage): string[] {
  return Object.entries(usage)
    .filter(([, u]) => u.starts >= 5 || u.appearances >= 10)
    .map(([pos]) => pos);
}
export function pitcherEligibility(u: PitcherUsage): ('SP' | 'RP')[] {
  const out: ('SP' | 'RP')[] = [];
  if (u.starts >= 3) out.push('SP');
  if (u.reliefApps >= 5) out.push('RP');
  return out;
}

/** Subline under a player's name: `MLB TEAM · POS1,POS2`. */
export function playerSubline(mlbTeam: string | null, positions: string[]): string {
  return `${mlbTeam ?? 'FA'} · ${positions.join(',')}`;
}

/** Slots a given eligible-position set may legally fill. */
export function canFillSlot(slot: string, positions: string[]): boolean {
  const s = slot.replace(/\d+$/, '').toUpperCase();
  const hitter = positions.some((p) => !['SP', 'RP', 'P'].includes(p));
  switch (s) {
    case 'BN': case 'B': return true;
    case 'IL': return true; // whether he is injured enough is checked where the status is known
    case 'UTIL': return hitter;
    case 'IF': case 'INF': return positions.some((p) => ['1B', '2B', '3B', 'SS'].includes(p));
    case 'OF': return positions.includes('OF');
    default: return positions.includes(s);
  }
}

// ------------------------------------------------------------ draft roster auto-fill

export type SlotInput = { playerId: number; positions: string[]; slot?: string | null };

const BENCH_LABELS = ROSTER_LABELS.filter((l) => l.startsWith('B'));
const PIT_LABELS = (prefix: 'SP' | 'RP') => ROSTER_LABELS.filter((l) => l.startsWith(prefix));

/**
 * Assigns each player to a roster label. Players that already carry a slot keep it (archived seasons);
 * the rest are filled in draft order: exact position slot, then IF (infielders), then Util (any hitter),
 * then bench. Players who don't fit anywhere (full roster) are omitted.
 */
export function assignSlots(players: SlotInput[]): Map<number, string> {
  const out = new Map<number, string>();
  const used = new Set<string>();
  for (const p of players) if (p.slot) { out.set(p.playerId, p.slot); used.add(p.slot); }

  const free = (labels: readonly string[]) => labels.find((l) => !used.has(l));
  for (const p of players) {
    if (p.slot) continue;
    const pos = p.positions;
    const isP = pos.some((x) => x === 'SP' || x === 'RP' || x === 'P');
    const candidates: (string | undefined)[] = [];
    if (isP) {
      const order = pos.includes('SP') ? ['SP', 'RP'] : ['RP', 'SP'];
      for (const g of order) if (pos.includes(g) || g === order[0]) candidates.push(free(PIT_LABELS(g as 'SP' | 'RP')));
    } else {
      for (const x of pos) {
        if (x === 'OF') candidates.push(free(['OF1', 'OF2', 'OF3', 'OF4']));
        else if (['C', '1B', '2B', '3B', 'SS'].includes(x)) candidates.push(free([x]));
      }
      if (pos.some((x) => ['1B', '2B', '3B', 'SS'].includes(x))) candidates.push(free(['IF']));
      candidates.push(free(['Util1', 'Util2']));
    }
    candidates.push(free(BENCH_LABELS));
    const label = candidates.find(Boolean);
    if (label) { out.set(p.playerId, label); used.add(label); }
  }
  return out;
}

export * from './season';
export * from './waivers';
export * from './chat';

// ------------------------------------------------------------ placing one more player

export type SeatedPlayer = { playerId: number; positions: string[]; slot: string };

/**
 * Finds a legal slot for a new player, moving as few existing players as possible: a breadth-first search for the
 * shortest chain "newcomer takes a slot, its occupant takes another slot, ... the last one takes an open slot".
 * Returns the new slot for him and for every existing player who has to move, or null if no legal lineup exists.
 */
export function placePlayer(
  current: SeatedPlayer[],
  add: { playerId: number; positions: string[] },
): Map<number, string> | null {
  const positions = new Map<number, string[]>(current.map((p) => [p.playerId, p.positions]));
  positions.set(add.playerId, add.positions);
  const slotOf = new Map<number, string>(current.map((p) => [p.playerId, p.slot]));
  const occupant = new Map<string, number>(current.map((p) => [p.slot, p.playerId]));

  // Prefer exact-position slots, then IF, then Util, then bench, so a hitter doesn't take the bench needlessly.
  const rank = (label: string) => (label.startsWith('B') ? 3 : label.startsWith('Util') ? 2 : label === 'IF' ? 1 : 0);
  const options = (pid: number) =>
    ROSTER_LABELS.filter((l) => canFillSlot(l, positions.get(pid)!)).sort((a, b) => rank(a) - rank(b));

  const wantsSlotOf = new Map<number, number>();      // occupant -> the player who would take his slot
  const seen = new Set<number>([add.playerId]);
  const queue: number[] = [add.playerId];
  for (let i = 0; i < queue.length; i++) {
    const pid = queue[i];
    const opts = options(pid);
    const open = opts.find((l) => !occupant.has(l));
    if (open) {
      // Walk the chain back: pid takes `open`; whoever wanted pid's old slot takes it; and so on.
      const moves = new Map<number, string>([[pid, open]]);
      let cur = pid;
      while (wantsSlotOf.has(cur)) {
        const q = wantsSlotOf.get(cur)!;
        moves.set(q, slotOf.get(cur)!);
        cur = q;
      }
      return moves;
    }
    for (const label of opts) {
      const o = occupant.get(label)!;
      if (!seen.has(o)) { seen.add(o); wantsSlotOf.set(o, pid); queue.push(o); }
    }
  }
  return null;
}
export * from './oidc';
export * from './feed';
export * from './webpush';
export * from './league';
