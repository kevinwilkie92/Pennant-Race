// Pure helpers for the MLB stats feed: matching our players to MLB ids, and turning boxscore stats into scored lines.
import { scoreHitter, scorePitcher, type HitLine, type PitLine } from './index';
import { isQualityStart, parseInnings } from './season';

// ------------------------------------------------------------ name matching

/** Lower-case, accent-free, punctuation-free name without suffixes, role tags or seed markers (`*`, `(Batter)`, ` - LAD`). */
export function normalizeName(raw: string): string {
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/\((batter|pitcher)\)/g, '').replace(/\s+-\s+[a-z]{2,3}$/, '').replace(/\*/g, '');
  s = s.replace(/[.'’`,-]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, '');
  return s.split(/\s+/).filter(Boolean).join(' ');
}

export type Ours = { id: number; name: string; team: string | null };
export type Theirs = { id: number; name: string; team: string | null };

/**
 * Pairs each of our players with an MLB person: the same name on the same team, or failing that a name that is
 * unique across MLB (he may have moved or be unsigned). Ambiguous names stay unmatched for a human to resolve.
 */
export function matchPlayers(ours: Ours[], theirs: Theirs[]): { matched: Map<number, number>; unmatched: Ours[] } {
  const byName = new Map<string, Theirs[]>();
  for (const t of theirs) {
    const k = normalizeName(t.name);
    byName.set(k, [...(byName.get(k) ?? []), t]);
  }
  const matched = new Map<number, number>();
  const unmatched: Ours[] = [];
  for (const o of ours) {
    const cands = byName.get(normalizeName(o.name)) ?? [];
    const team = o.team ?? o.name.match(/\s-\s([A-Za-z]{2,3})$/)?.[1].toUpperCase() ?? null;   // "Max Muncy - LAD" says which Max Muncy
    const sameTeam = cands.filter((c) => c.team != null && c.team === team);
    const pick = sameTeam.length === 1 ? sameTeam[0] : cands.length === 1 ? cands[0] : null;
    if (pick) matched.set(o.id, pick.id); else unmatched.push(o);
  }
  return { matched, unmatched };
}

// ------------------------------------------------------------ roles

export type Role = 'H' | 'P';
/** Ohtani is two rows in our data; every other player is a pitcher if his position says so. */
export function roleOf(p: { name: string; pos: string }): Role {
  if (/\(pitcher\)/i.test(p.name)) return 'P';
  if (/\(batter\)/i.test(p.name)) return 'H';
  return p.pos === 'SP' || p.pos === 'RP' || p.pos === 'P' ? 'P' : 'H';
}

// ------------------------------------------------------------ boxscore -> scored lines

type Num = number | undefined;
export type BoxBatting = { gamesPlayed?: Num; hits?: Num; doubles?: Num; triples?: Num; homeRuns?: Num; baseOnBalls?: Num; intentionalWalks?: Num; runs?: Num; rbi?: Num; stolenBases?: Num; strikeOuts?: Num; atBats?: Num };
export type BoxPitching = { gamesPlayed?: Num; gamesStarted?: Num; inningsPitched?: string; strikeOuts?: Num; wins?: Num; saves?: Num; holds?: Num; completeGames?: Num; shutouts?: Num; earnedRuns?: Num; hits?: Num; baseOnBalls?: Num };

const n = (x: Num) => x ?? 0;
/** Empty stat objects (bench players who never appeared) mean "did not play". */
const played = (b: { gamesPlayed?: Num } | undefined) => !!b && n(b.gamesPlayed) > 0;

export function hitterLine(b: BoxBatting | undefined): HitLine | null {
  if (!b || !played(b)) return null;
  const ibb = n(b.intentionalWalks);
  return {
    '1B': n(b.hits) - n(b.doubles) - n(b.triples) - n(b.homeRuns), '2B': n(b.doubles), '3B': n(b.triples), HR: n(b.homeRuns),
    BB: n(b.baseOnBalls) - ibb, IBB: ibb,                 // MLB's walk total includes intentional walks; each walk scores once
    R: n(b.runs), RBI: n(b.rbi), SB: n(b.stolenBases), SO: n(b.strikeOuts),
  };
}

export function pitcherLine(p: BoxPitching | undefined): PitLine | null {
  if (!p || !played(p)) return null;
  const ip = parseInnings(p.inningsPitched ?? '0.0');
  return {
    IP: ip, K: n(p.strikeOuts), W: n(p.wins), SV: n(p.saves), HLD: n(p.holds), CG: n(p.completeGames), SHO: n(p.shutouts),
    ER: n(p.earnedRuns), H: n(p.hits), BB: n(p.baseOnBalls),
    QS: isQualityStart({ gamesStarted: n(p.gamesStarted), innings: ip, earnedRuns: n(p.earnedRuns) }) ? 1 : 0,
  };
}

export type GameStat = { role: Role; points: number; line: HitLine | PitLine; started: boolean; pos: string };

/** The box position abbreviations that earn hitting-position eligibility (DH, PH, PR do not). */
export function eligibilityPosition(abbr: string | undefined): string | null {
  switch (abbr) {
    case 'C': case '1B': case '2B': case '3B': case 'SS': return abbr;
    case 'LF': case 'CF': case 'RF': case 'OF': return 'OF';
    default: return null;
  }
}

/** One player's scored game from his boxscore entry. `null` if he didn't play in his role. */
export type Scoring = { hit?: Record<string, number>; pit?: Record<string, number> };
export function gameStat(role: Role, entry: { stats?: { batting?: BoxBatting; pitching?: BoxPitching }; position?: { abbreviation?: string }; battingOrder?: string | number }, scoring: Scoring = {}): GameStat | null {
  if (role === 'H') {
    const line = hitterLine(entry.stats?.batting);
    if (!line) return null;
    const order = entry.battingOrder != null ? Number(entry.battingOrder) : NaN;
    return { role, line, points: scoreHitter(line, scoring.hit), started: Number.isFinite(order) && order % 100 === 0, pos: eligibilityPosition(entry.position?.abbreviation) ?? entry.position?.abbreviation ?? '' };
  }
  const p = entry.stats?.pitching;
  const line = pitcherLine(p);
  if (!line) return null;
  return { role, line, points: scorePitcher(line, scoring.pit), started: n(p?.gamesStarted) > 0, pos: 'P' };
}

/** Short human summary for game logs: "2-4, HR, 2 RBI" or "6.1 IP, 2 ER, 7 K, W". */
export function summarize(stat: { role: Role; line: HitLine | PitLine }): string {
  const parts: string[] = [];
  if (stat.role === 'H') {
    const l = stat.line as HitLine;
    const hits = (l['1B'] ?? 0) + (l['2B'] ?? 0) + (l['3B'] ?? 0) + (l.HR ?? 0);
    parts.push(`${hits} H`);
    if (l.HR) parts.push(l.HR > 1 ? `${l.HR} HR` : 'HR');
    if (l['2B']) parts.push(`${l['2B']} 2B`);
    if (l['3B']) parts.push(`${l['3B']} 3B`);
    if (l.R) parts.push(`${l.R} R`);
    if (l.RBI) parts.push(`${l.RBI} RBI`);
    if (l.SB) parts.push(`${l.SB} SB`);
    const bb = (l.BB ?? 0) + (l.IBB ?? 0);
    if (bb) parts.push(`${bb} BB`);
    if (l.SO) parts.push(`${l.SO} K`);
  } else {
    const l = stat.line as PitLine;
    const outs = Math.round((l.IP ?? 0) * 3);
    parts.push(`${Math.floor(outs / 3)}.${outs % 3} IP`);
    parts.push(`${l.ER ?? 0} ER`, `${l.K ?? 0} K`);
    if (l.W) parts.push('W'); if (l.SV) parts.push('SV'); if (l.HLD) parts.push('HLD'); if (l.QS) parts.push('QS');
    if (l.CG) parts.push('CG'); if (l.SHO) parts.push('SHO');
  }
  return parts.join(', ');
}

/** MLB's roster status codes that mean "on the injured list". */
export const isInjuredListCode = (code: string | undefined) => !!code && /^D\d+$/.test(code);
