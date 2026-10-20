// Career stats: turning MLB's year-by-year season totals into league fantasy points and a career line. Pure functions.
import { scoreHitter, scorePitcher, type HitLine, type PitLine } from './index';
import { isQualityStart, parseInnings } from './season';

type Raw = Record<string, unknown>;
const num = (x: unknown) => { const n = typeof x === 'string' ? Number(x) : (x as number); return Number.isFinite(n) ? n : 0; };

/** A MLB season-totals "split" (one team's row, or the all-teams total for a player who changed teams). */
export type Split = { season?: string; team?: { id?: number }; numTeams?: number; stat: Raw };

/** One row per season: the all-teams total if he changed teams, else the single row. */
export function pickSeasons(splits: Split[]): { season: number; stat: Raw; teamIds: number[] }[] {
  const by = new Map<number, Split[]>();
  for (const s of splits) { const y = Number(s.season); if (Number.isInteger(y)) by.set(y, [...(by.get(y) ?? []), s]); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([season, rows]) => {
    const teamRows = rows.filter((r) => r.team?.id != null);
    const total = rows.find((r) => r.team?.id == null) ?? (teamRows.length === 1 ? teamRows[0] : null);
    // No explicit total row but several teams (shouldn't happen): fall back to the biggest single row rather than guessing sums.
    const row = total ?? [...rows].sort((a, b) => num(b.stat.gamesPlayed) - num(a.stat.gamesPlayed))[0];
    return { season, stat: row.stat, teamIds: teamRows.map((r) => r.team!.id!) };
  });
}

/** Counting stats we keep for each hitting season (plus the line scored with league rules). */
export function hittingSeason(stat: Raw): { stats: Record<string, number>; points: number } {
  const ibb = num(stat.intentionalWalks);
  const stats = {
    g: num(stat.gamesPlayed), ab: num(stat.atBats), h: num(stat.hits), d: num(stat.doubles), t: num(stat.triples), hr: num(stat.homeRuns),
    r: num(stat.runs), rbi: num(stat.rbi), sb: num(stat.stolenBases), bb: num(stat.baseOnBalls), ibb, so: num(stat.strikeOuts),
  };
  const line: HitLine = { '1B': stats.h - stats.d - stats.t - stats.hr, '2B': stats.d, '3B': stats.t, HR: stats.hr, BB: stats.bb - ibb, IBB: ibb, R: stats.r, RBI: stats.rbi, SB: stats.sb, SO: stats.so };
  return { stats, points: scoreHitter(line) };
}

/** Pitching season: `qs` is counted from the game log, because MLB's season totals don't include quality starts. */
export function pitchingSeason(stat: Raw, qs: number): { stats: Record<string, number>; points: number } {
  const outs = Math.round(parseInnings(String(stat.inningsPitched ?? '0.0')) * 3);
  const stats = {
    g: num(stat.gamesPlayed), gs: num(stat.gamesStarted), outs, w: num(stat.wins), l: num(stat.losses), sv: num(stat.saves), hld: num(stat.holds),
    k: num(stat.strikeOuts), er: num(stat.earnedRuns), h: num(stat.hits), bb: num(stat.baseOnBalls), cg: num(stat.completeGames), sho: num(stat.shutouts), qs,
  };
  const line: PitLine = { IP: outs / 3, K: stats.k, W: stats.w, QS: qs, SV: stats.sv, HLD: stats.hld, CG: stats.cg, SHO: stats.sho, ER: stats.er, H: stats.h, BB: stats.bb };
  return { stats, points: scorePitcher(line) };
}

/** Quality starts in a season's game log (6+ IP, 3 or fewer ER, as a starter). */
export function countQualityStarts(games: { gamesStarted?: unknown; inningsPitched?: unknown; earnedRuns?: unknown }[]): number {
  return games.filter((g) => isQualityStart({ gamesStarted: num(g.gamesStarted), innings: parseInnings(String(g.inningsPitched ?? '0.0')), earnedRuns: num(g.earnedRuns) })).length;
}

/** Adds up seasons into a career line. */
export function careerTotals(seasons: { stats: Record<string, number>; points: number }[]): { stats: Record<string, number>; points: number } {
  const stats: Record<string, number> = {};
  let points = 0;
  for (const s of seasons) { for (const [k, v] of Object.entries(s.stats)) stats[k] = (stats[k] ?? 0) + v; points += s.points; }
  return { stats, points: Math.round(points * 100) / 100 };
}

// ------------------------------------------------------------ display helpers
const rate = (n: number, d: number, digits: number) => (d > 0 ? (n / d).toFixed(digits) : '—');
/** ".312" style batting average. */
export const battingAvg = (h: number, ab: number) => (ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '—');
/** ERA from earned runs and outs recorded. */
export const era = (er: number, outs: number) => rate(er * 27, outs, 2);
/** Innings from outs: 172 outs -> "57.1". */
export const inningsFromOuts = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;
