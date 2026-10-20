// The roster layout: how many of each kind of slot a lineup has. Pure and self-contained (nothing here imports index.ts,
// which re-exports this file). The default is the league's original 26-player layout.

export const SLOT_TYPES = ['C', '1B', '2B', '3B', 'SS', 'IF', 'OF', 'UTIL', 'SP', 'RP', 'BN'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];
export type Layout = Record<SlotType, number>;

export const DEFAULT_LAYOUT: Layout = { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, IF: 1, OF: 4, UTIL: 2, SP: 4, RP: 4, BN: 6 };

export const SLOT_NAMES: Record<SlotType, string> = {
  C: 'Catcher', '1B': 'First base', '2B': 'Second base', '3B': 'Third base', SS: 'Shortstop', IF: 'Infield (1B/2B/3B/SS)',
  OF: 'Outfield', UTIL: 'Utility (any hitter)', SP: 'Starting pitcher', RP: 'Relief pitcher', BN: 'Bench',
};
export const HITTER_TYPES: SlotType[] = ['C', '1B', '2B', '3B', 'SS', 'IF', 'OF', 'UTIL'];
export const PITCHER_TYPES: SlotType[] = ['SP', 'RP'];

// A slot's label is what is stored on a roster row. The labels the league started with are kept for the first slot of each
// one-of-a-kind type ("C", "SS", "IF"); every extra slot, and every multi-slot type, is numbered ("C2", "OF3", "SP4", "B6").
const BASE: Record<SlotType, string> = { C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', IF: 'IF', OF: 'OF', UTIL: 'Util', SP: 'SP', RP: 'RP', BN: 'B' };
const BARE_FIRST = new Set<SlotType>(['C', '1B', '2B', '3B', 'SS', 'IF']);

export function labelsOfType(type: SlotType, count: number): string[] {
  return Array.from({ length: count }, (_, i) => (BARE_FIRST.has(type) && i === 0 ? BASE[type] : `${BASE[type]}${i + 1}`));
}

/** Every roster label in display order: hitters, pitchers, then the bench. */
export function rosterLabels(layout: Layout = DEFAULT_LAYOUT): string[] {
  return SLOT_TYPES.flatMap((t) => labelsOfType(t, layout[t]));
}
export const rosterSizeOf = (layout: Layout = DEFAULT_LAYOUT) => SLOT_TYPES.reduce((n, t) => n + layout[t], 0);

export function sectionLabels(layout: Layout = DEFAULT_LAYOUT): { hit: string[]; pit: string[]; bench: string[] } {
  const of = (types: readonly SlotType[]) => types.flatMap((t) => labelsOfType(t, layout[t]));
  return { hit: of(HITTER_TYPES), pit: of(PITCHER_TYPES), bench: of(['BN']) };
}

/** Which kind of slot a stored label is ("OF3" -> OF, "Util2" -> UTIL, "B6" -> BN), or null for something else (IL slots). */
export function slotTypeOf(label: string): SlotType | null {
  const s = label.replace(/\d+$/, '').toUpperCase();
  if (s === 'B' || s === 'BN') return 'BN';
  if (s === 'INF') return 'IF';
  return (SLOT_TYPES as readonly string[]).includes(s) ? (s as SlotType) : null;
}

/** Plain-English summary, e.g. "12 hitters, 8 pitchers, 6 bench". */
export function describeLayout(layout: Layout): string {
  const n = (types: readonly SlotType[]) => types.reduce((a, t) => a + layout[t], 0);
  return `${n(HITTER_TYPES)} hitter, ${n(PITCHER_TYPES)} pitcher and ${layout.BN} bench slot${layout.BN === 1 ? '' : 's'}`;
}
