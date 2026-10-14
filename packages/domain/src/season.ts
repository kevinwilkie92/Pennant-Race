// Schedule, standings and playoffs (README "Playoffs" + league rules). Pure functions, no I/O.

export const REGULAR_WEEKS = 23;
export const PLAYOFF_START_WEEK = 24;
export const TOTAL_WEEKS = 26;
export const PLAYOFF_TEAMS = 6;

// ------------------------------------------------------------ stat helpers (feed-independent)

/** Baseball innings notation "6.1" means 6 and 1/3. Returns innings as a decimal (6.333…). */
export function parseInnings(ip: string | number): number {
  const [whole, outs = '0'] = String(ip).split('.');
  const o = Number(outs);
  if (!Number.isInteger(Number(whole)) || o < 0 || o > 2) throw new Error(`Bad innings value: ${ip}`);
  return Number(whole) + o / 3;
}

/** Standard quality start: a start of 6+ innings allowing 3 or fewer earned runs. */
export function isQualityStart(p: { gamesStarted: number; innings: number; earnedRuns: number }): boolean {
  return p.gamesStarted > 0 && p.innings >= 6 && p.earnedRuns <= 3;
}

/** Singles aren't reported directly; they are hits minus extra-base hits. */
export function singles(h: { hits: number; doubles: number; triples: number; homeRuns: number }): number {
  return h.hits - h.doubles - h.triples - h.homeRuns;
}

// ------------------------------------------------------------ calendar

const DAY = 86_400_000;
const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Weeks run Monday–Sunday. `start` must be a Monday. */
export function weekRange(start: string, week: number): { start: string; end: string } {
  if (new Date(parse(start)).getUTCDay() !== 1) throw new Error('Season must start on a Monday');
  const s = parse(start) + (week - 1) * 7 * DAY;
  return { start: fmt(s), end: fmt(s + 6 * DAY) };
}

// ------------------------------------------------------------ schedule

export type Pairing = { week: number; home: string; away: string };

/**
 * Round-robin by the circle method. With 12 teams that is 11 rounds; weeks 1–23 repeat the cycle
 * (second pass swaps home/away), so every team plays every other team at least twice.
 */
export function generateSchedule(teamIds: string[], weeks = REGULAR_WEEKS): Pairing[] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) throw new Error('Need an even number of teams');
  const n = ids.length;
  const rounds: [string, string][][] = [];
  let ring = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const row = [ids[0], ...ring];
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = row[i], b = row[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]); // alternate who is "home" so it isn't always the same team
    }
    rounds.push(pairs);
    ring = [ring[ring.length - 1], ...ring.slice(0, -1)];
  }
  const out: Pairing[] = [];
  for (let w = 1; w <= weeks; w++) {
    const cycle = Math.floor((w - 1) / rounds.length);
    for (const [a, b] of rounds[(w - 1) % rounds.length]) {
      out.push(cycle % 2 === 0 ? { week: w, home: a, away: b } : { week: w, home: b, away: a });
    }
  }
  return out;
}

// ------------------------------------------------------------ standings

export type Result = { week: number; home: string; away: string; homeScore: number; awayScore: number };

export type Row = {
  teamId: string; rank: number; w: number; l: number; t: number; pct: number; gb: number;
  pf: number; pa: number; streak: string; played: number; remaining: number;
  status: 'clinched' | 'eliminated' | 'alive';
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function standings(teamIds: string[], results: Result[], regularWeeks = REGULAR_WEEKS): Row[] {
  const rows = new Map<string, { w: number; l: number; t: number; pf: number; pa: number; seq: string[] }>();
  for (const id of teamIds) rows.set(id, { w: 0, l: 0, t: 0, pf: 0, pa: 0, seq: [] });

  const ordered = [...results].filter((r) => r.week <= regularWeeks).sort((a, b) => a.week - b.week);
  for (const r of ordered) {
    const h = rows.get(r.home), a = rows.get(r.away);
    if (!h || !a) continue;
    h.pf += r.homeScore; h.pa += r.awayScore; a.pf += r.awayScore; a.pa += r.homeScore;
    if (r.homeScore > r.awayScore) { h.w++; a.l++; h.seq.push('W'); a.seq.push('L'); }
    else if (r.homeScore < r.awayScore) { a.w++; h.l++; a.seq.push('W'); h.seq.push('L'); }
    else { h.t++; a.t++; h.seq.push('T'); a.seq.push('T'); }
  }

  const pctOf = (x: { w: number; l: number; t: number }) => {
    const g = x.w + x.l + x.t;
    return g === 0 ? 0 : (x.w + x.t / 2) / g;
  };
  const sorted = teamIds
    .map((id) => ({ id, ...rows.get(id)! }))
    .sort((a, b) => pctOf(b) - pctOf(a) || b.pf - a.pf || a.id.localeCompare(b.id));

  const lead = sorted[0];
  // Games played per team (same for everyone when whole weeks are counted).
  const base = sorted.map((x, i) => {
    const played = x.w + x.l + x.t;
    const last = x.seq[x.seq.length - 1];
    let run = 0;
    for (let k = x.seq.length - 1; k >= 0 && x.seq[k] === last; k--) run++;
    return {
      teamId: x.id, rank: i + 1, w: x.w, l: x.l, t: x.t, pct: r2(pctOf(x) * 1000) / 1000,
      gb: lead ? ((lead.w - x.w) + (x.l - lead.l)) / 2 : 0, pf: r2(x.pf), pa: r2(x.pa),
      streak: last ? `${last}${run}` : '–', played, remaining: Math.max(0, regularWeeks - played),
    };
  });

  // Clinch / elimination, ignoring tiebreaks conservatively (a tie on wins counts against you).
  const maxWins = (x: (typeof base)[number]) => x.w + x.t / 2 + x.remaining;
  const curWins = (x: (typeof base)[number]) => x.w + x.t / 2;
  return base.map((x) => {
    const couldCatch = base.filter((y) => y !== x && maxWins(y) >= curWins(x)).length;
    const alreadyAhead = base.filter((y) => y !== x && curWins(y) > maxWins(x)).length;
    const status = couldCatch < PLAYOFF_TEAMS ? 'clinched' : alreadyAhead >= PLAYOFF_TEAMS ? 'eliminated' : 'alive';
    return { ...x, status } as Row;
  });
}

// ------------------------------------------------------------ playoffs

export type Match = {
  id: 'QF1' | 'QF2' | 'SF1' | 'SF2' | 'FINAL' | 'THIRD';
  round: 'Quarterfinal' | 'Semifinal' | 'Championship' | '3rd Place';
  week: number;
  a: string | null; b: string | null;            // team ids (null until decided)
  aScore: number | null; bScore: number | null;
  winner: string | null; loser: string | null;
};

/**
 * 6-team bracket: seeds 1–2 get byes. QF (wk24): 3v6, 4v5. SF (wk25): 1 vs winner(4v5), 2 vs winner(3v6).
 * Week 26: Championship (SF winners) + 3rd place (SF losers). Ties go to the higher seed.
 * `score(teamId, week)` returns that team's week total or null if the week hasn't finished.
 */
export function buildBracket(seeds: string[], score: (teamId: string, week: number) => number | null): Match[] {
  const seedOf = (id: string) => seeds.indexOf(id);
  const play = (id: Match['id'], round: Match['round'], week: number, a: string | null, b: string | null): Match => {
    let aS: number | null = null, bS: number | null = null, winner: string | null = null, loser: string | null = null;
    if (a && b) {
      aS = score(a, week); bS = score(b, week);
      if (aS != null && bS != null) {
        const aWins = aS > bS || (aS === bS && seedOf(a) < seedOf(b));
        winner = aWins ? a : b; loser = aWins ? b : a;
      }
    }
    return { id, round, week, a, b, aScore: aS, bScore: bS, winner, loser };
  };
  const [s1, s2, s3, s4, s5, s6] = seeds.length >= PLAYOFF_TEAMS ? seeds : [...seeds, ...Array(PLAYOFF_TEAMS).fill(null)].slice(0, PLAYOFF_TEAMS);
  const qf1 = play('QF1', 'Quarterfinal', 24, s3 ?? null, s6 ?? null);
  const qf2 = play('QF2', 'Quarterfinal', 24, s4 ?? null, s5 ?? null);
  const sf1 = play('SF1', 'Semifinal', 25, s1 ?? null, qf2.winner);
  const sf2 = play('SF2', 'Semifinal', 25, s2 ?? null, qf1.winner);
  return [
    qf1, qf2, sf1, sf2,
    play('FINAL', 'Championship', 26, sf1.winner, sf2.winner),
    play('THIRD', '3rd Place', 26, sf1.loser, sf2.loser),
  ];
}
