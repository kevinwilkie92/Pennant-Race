// The league rules a commissioner can change. Everything not listed here (roster size and slots, season length,
// playoff format) is structural and stays fixed. Pure functions; the API stores the result and the app displays it.
// NOTE: this file must not import values from './index' (index re-exports this file, and a cycle would leave these
// defaults undefined in bundled builds). The numbers below mirror index.ts; test/rules.test.ts asserts they agree.
import { DEFAULT_LAYOUT, SLOT_NAMES, SLOT_TYPES, HITTER_TYPES, PITCHER_TYPES, rosterSizeOf, type Layout, type SlotType } from './layout';
import { playoffRounds } from './season';

const HIT_DEFAULTS = { '1B': 1, '2B': 2, '3B': 3, HR: 4, BB: 1, IBB: 1, R: 1, RBI: 1, SB: 2, SO: -1 };
const PIT_DEFAULTS = { IP: 3, K: 1, W: 2, QS: 5, SV: 5, HLD: 2, CG: 3, SHO: 3, ER: -2, H: -1, BB: -1 };
export type HitKey = keyof typeof HIT_DEFAULTS;
export type PitKey = keyof typeof PIT_DEFAULTS;
export type LeagueRules = {
  budget: number;          // auction dollars per team
  minBid: number;
  maxKeepers: number;
  keeperIncrease: number;  // a Year-1 keeper costs last year's price plus this
  faabBudget: number;      // waiver dollars per team per season
  ilSlots: number;
  roster: Layout;          // how many of each kind of lineup slot
  regularWeeks: number;    // weeks of head-to-head play before the playoffs (a round robin, repeated as needed)
  playoffTeams: number;    // 0 for no playoffs, otherwise 2–8; the bracket is built from this
  hit: Record<HitKey, number>;
  pit: Record<PitKey, number>;
};

export const DEFAULT_RULES: LeagueRules = {
  budget: 300, minBid: 1, maxKeepers: 5, keeperIncrease: 5, faabBudget: 300, ilSlots: 4,
  roster: { ...DEFAULT_LAYOUT }, regularWeeks: 23, playoffTeams: 6,
  hit: { ...HIT_DEFAULTS }, pit: { ...PIT_DEFAULTS },
};

type Limit = { min: number; max: number; label: string };
export const LIMITS: Record<Exclude<keyof LeagueRules, 'hit' | 'pit' | 'roster'>, Limit> = {
  budget: { min: 100, max: 1000, label: 'Auction budget' }, minBid: { min: 1, max: 10, label: 'Minimum bid' },
  maxKeepers: { min: 0, max: 10, label: 'Keepers per team' }, keeperIncrease: { min: 0, max: 20, label: 'Keeper cost increase' },
  faabBudget: { min: 0, max: 1000, label: 'FAAB budget' }, ilSlots: { min: 1, max: 8, label: 'Injured-list slots' },
  regularWeeks: { min: 1, max: 26, label: 'Regular-season weeks' }, playoffTeams: { min: 0, max: 8, label: 'Playoff teams' },
};
/** Per-kind slot limits, and the limits on the whole roster. */
export const SLOT_MAX: Record<SlotType, number> = { C: 4, '1B': 4, '2B': 4, '3B': 4, SS: 4, IF: 6, OF: 10, UTIL: 8, SP: 12, RP: 12, BN: 20 };
export const ROSTER_MIN = 10, ROSTER_MAX = 40;
/** The season can't run longer than the baseball season: regular weeks plus one week per playoff round. */
export const MAX_SEASON_WEEKS = 26;
export const SCORE_MIN = -50, SCORE_MAX = 50;

export const HIT_LABELS: Record<HitKey, string> = { '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run', BB: 'Walk', IBB: 'Intentional walk', R: 'Run', RBI: 'RBI', SB: 'Stolen base', SO: 'Strikeout' };
export const PIT_LABELS: Record<PitKey, string> = { IP: 'Inning pitched', K: 'Strikeout', W: 'Win', QS: 'Quality start', SV: 'Save', HLD: 'Hold', CG: 'Complete game', SHO: 'Shutout', ER: 'Earned run', H: 'Hit allowed', BB: 'Walk allowed' };

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

export type RulesPatch = Partial<Omit<LeagueRules, 'hit' | 'pit' | 'roster'>> & { hit?: Partial<LeagueRules['hit']>; pit?: Partial<LeagueRules['pit']>; roster?: Partial<Layout> };

/** Fills in anything missing from stored rules with the defaults (and ignores junk), so old data never breaks. */
export function normalizeRules(raw: unknown): LeagueRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends Record<string, number>>(def: T, got: unknown): T => {
    const g = (got && typeof got === 'object' ? got : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.keys(def).map((k) => [k, isCents(g[k]) && Math.abs(g[k] as number) <= SCORE_MAX ? g[k] : def[k]])) as T;
  };
  const lay = (r.roster && typeof r.roster === 'object' ? r.roster : {}) as Record<string, unknown>;
  const roster = Object.fromEntries(SLOT_TYPES.map((t) => [t, typeof lay[t] === 'number' && Number.isInteger(lay[t]) && (lay[t] as number) >= 0 && (lay[t] as number) <= SLOT_MAX[t] ? lay[t] : DEFAULT_LAYOUT[t]])) as Layout;
  const out = { ...DEFAULT_RULES, roster: rosterSizeOf(roster) >= ROSTER_MIN && rosterSizeOf(roster) <= ROSTER_MAX ? roster : { ...DEFAULT_LAYOUT }, hit: pick(DEFAULT_RULES.hit, r.hit), pit: pick(DEFAULT_RULES.pit, r.pit) };
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const v = r[k], L = LIMITS[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= L.min && v <= L.max) out[k] = v;
  }
  return out;
}

/** Applies a change to the current rules, or says what is wrong with it. */
export function applyRulesPatch(current: LeagueRules, patch: unknown): { ok: true; rules: LeagueRules } | { ok: false; reason: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, reason: 'Nothing to change' };
  const p = patch as Record<string, unknown>;
  const known = new Set([...Object.keys(LIMITS), 'hit', 'pit', 'roster']);
  const bad = Object.keys(p).find((k) => !known.has(k));
  if (bad) return { ok: false, reason: `Unknown rule “${bad}”` };
  if (Object.keys(p).length === 0) return { ok: false, reason: 'Nothing to change' };

  const next: LeagueRules = { ...current, roster: { ...current.roster }, hit: { ...current.hit }, pit: { ...current.pit } };
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    if (p[k] === undefined) continue;
    const L = LIMITS[k], v = p[k];
    if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, reason: `${L.label} must be a whole number` };
    if (v < L.min || v > L.max) return { ok: false, reason: `${L.label} must be between ${L.min} and ${L.max}` };
    next[k] = v;
  }
  for (const group of ['hit', 'pit'] as const) {
    if (p[group] === undefined) continue;
    const g = p[group];
    if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, reason: `${group === 'hit' ? 'Hitting' : 'Pitching'} scoring must be a list of values` };
    const labels = group === 'hit' ? HIT_LABELS : PIT_LABELS;
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
      if (!(k in labels)) return { ok: false, reason: `Unknown ${group === 'hit' ? 'hitting' : 'pitching'} stat “${k}”` };
      if (!isCents(v)) return { ok: false, reason: `${labels[k as keyof typeof labels]} points must be a number (at most 2 decimals)` };
      if (v < SCORE_MIN || v > SCORE_MAX) return { ok: false, reason: `${labels[k as keyof typeof labels]} points must be between ${SCORE_MIN} and ${SCORE_MAX}` };
      (next[group] as Record<string, number>)[k] = v;
    }
  }
  if (p.roster !== undefined) {
    const g = p.roster;
    if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, reason: 'The roster layout must be a list of slot counts' };
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
      if (!(SLOT_TYPES as readonly string[]).includes(k)) return { ok: false, reason: `Unknown slot type “${k}”` };
      const t = k as SlotType;
      if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, reason: `${SLOT_NAMES[t]} slots must be a whole number` };
      if (v < 0 || v > SLOT_MAX[t]) return { ok: false, reason: `${SLOT_NAMES[t]} slots must be between 0 and ${SLOT_MAX[t]}` };
      next.roster[t] = v;
    }
  }
  const size = rosterSizeOf(next.roster);
  if (size < ROSTER_MIN || size > ROSTER_MAX) return { ok: false, reason: `A roster needs between ${ROSTER_MIN} and ${ROSTER_MAX} players in total (this one has ${size})` };
  if (HITTER_TYPES.every((t) => next.roster[t] === 0)) return { ok: false, reason: 'The roster needs at least one hitter slot' };
  if (PITCHER_TYPES.every((t) => next.roster[t] === 0)) return { ok: false, reason: 'The roster needs at least one pitcher slot (SP or RP)' };
  if (next.budget < next.minBid * size) return { ok: false, reason: `A full ${size}-player roster at the minimum bid has to fit in the budget (at least $${next.minBid * size})` };
  if (next.playoffTeams === 1) return { ok: false, reason: 'Playoffs need at least 2 teams (or 0 for none)' };
  if (next.regularWeeks + playoffRounds(next.playoffTeams) > MAX_SEASON_WEEKS) return { ok: false, reason: `The season can be at most ${MAX_SEASON_WEEKS} weeks: ${next.regularWeeks} regular weeks plus ${playoffRounds(next.playoffTeams)} playoff round${playoffRounds(next.playoffTeams) === 1 ? '' : 's'} is too long` };
  return { ok: true, rules: next };
}

/** Human-readable list of what changed, for the history ("Home run 4 → 5", "Auction budget $300 → $400"). */
export function describeRulesChange(a: LeagueRules, b: LeagueRules): string[] {
  const out: string[] = [];
  const money = new Set(['budget', 'minBid', 'keeperIncrease', 'faabBudget']);
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) if (a[k] !== b[k]) out.push(`${LIMITS[k].label} ${money.has(k) ? '$' : ''}${a[k]} → ${money.has(k) ? '$' : ''}${b[k]}`);
  for (const t of SLOT_TYPES) if (a.roster[t] !== b.roster[t]) out.push(`${SLOT_NAMES[t].replace(/ \(.*\)/, '')} slots ${a.roster[t]} → ${b.roster[t]}`);
  for (const k of Object.keys(HIT_LABELS) as HitKey[]) if (a.hit[k] !== b.hit[k]) out.push(`Hitting: ${HIT_LABELS[k]} ${a.hit[k]} → ${b.hit[k]}`);
  for (const k of Object.keys(PIT_LABELS) as PitKey[]) if (a.pit[k] !== b.pit[k]) out.push(`Pitching: ${PIT_LABELS[k]} ${a.pit[k]} → ${b.pit[k]}`);
  return out;
}

export const scoringChanged = (a: LeagueRules, b: LeagueRules) => JSON.stringify([a.hit, a.pit]) !== JSON.stringify([b.hit, b.pit]);
