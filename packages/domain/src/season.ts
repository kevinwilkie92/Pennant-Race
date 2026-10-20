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

export function standings(teamIds: string[], results: Result[], regularWeeks = REGULAR_WEEKS, playoffTeams = PLAYOFF_TEAMS): Row[] {
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
    const status = playoffTeams <= 0 ? 'alive' : couldCatch < playoffTeams ? 'clinched' : alreadyAhead >= playoffTeams ? 'eliminated' : 'alive';
    return { ...x, status } as Row;
  });
}

// ------------------------------------------------------------ playoffs

export type Match = {
  /** FINAL, THIRD, or a round prefix with a number: SF1, QF2, R16-3. */
  id: string;
  round: string;
  week: number;
  a: string | null; b: string | null;            // team ids (null until decided)
  aScore: number | null; bScore: number | null;
  winner: string | null; loser: string | null;
};

/** Rounds needed for `teams` playoff teams (6 teams: 3 rounds, with byes for the top 2). */
export const playoffRounds = (teams: number) => (teams < 2 ? 0 : Math.ceil(Math.log2(teams)));
/** Weeks in a whole season: the regular season plus one week per playoff round. */
export const totalWeeks = (regularWeeks: number, playoffTeams: number) => regularWeeks + playoffRounds(playoffTeams);

/** Standard bracket order for a field of `size` (a power of two): [1,8,4,5,2,7,3,6] for 8. Seed 1 meets 2 only in the final. */
function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) order = order.flatMap((s) => [s, order.length * 2 + 1 - s]);
  return order;
}
const ROUND_NAMES = ['Championship', 'Semifinal', 'Quarterfinal', 'Round of 16'];
const ROUND_IDS = ['FINAL', 'SF', 'QF', 'R16-'];

/**
 * Single-elimination bracket for any field of 2 or more teams, seeded in the usual way. Seeds that don't fill the bracket get
 * byes (6 teams: seeds 1–2). Round r is played in week `regularWeeks + r`; the last week also has a 3rd-place game between the
 * semifinal losers. Ties go to the higher seed. `score(teamId, week)` returns that team's week total, or null if the week hasn't finished.
 * With the defaults (6 teams, 23 regular weeks) this is the league's original bracket: QF 3v6 and 4v5, SF 1 vs 4/5 and 2 vs 3/6, final in week 26.
 */
export function buildBracket(seeds: string[], score: (teamId: string, week: number) => number | null, opts: { playoffTeams?: number; regularWeeks?: number } = {}): Match[] {
  const n = opts.playoffTeams ?? PLAYOFF_TEAMS, reg = opts.regularWeeks ?? REGULAR_WEEKS;
  const rounds = playoffRounds(n);
  if (rounds === 0) return [];
  const seedOf = (id: string) => seeds.indexOf(id);
  const play = (id: string, round: string, week: number, a: string | null, b: string | null): Match => {
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

  // A node is a team entering the bracket (a seed) or the game that produces its winner. `best` is the best (lowest) seed in its
  // part of the bracket; games in a round are numbered by it (QF1 holds seed 3's game when seeds 1–2 have byes).
  type Node = { team: string | null; best: number; present: boolean; match?: Match };
  const size = 2 ** rounds;
  let nodes: Node[] = bracketOrder(size).map((seed) => ({ team: seed <= n ? seeds[seed - 1] ?? null : null, best: seed, present: seed <= n }));
  const out: Match[] = [];
  let semis: Match[] = [];
  for (let r = 1; r <= rounds; r++) {
    const fromEnd = rounds - r;                         // 0 = the final
    const roundName = ROUND_NAMES[fromEnd] ?? `Round of ${size >> (r - 1)}`;
    const next: Node[] = [];
    const games: { match: Match; best: number }[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const x = nodes[i], y = nodes[i + 1];
      if (!x.present || !y.present) { next.push(x.present ? x : y); continue; }                 // a bye: whoever is there moves straight on
      const match = play('', roundName, reg + r, x.match ? x.match.winner : x.team, y.match ? y.match.winner : y.team);
      games.push({ match, best: Math.min(x.best, y.best) });
      next.push({ team: null, best: Math.min(x.best, y.best), present: true, match });
    }
    games.sort((p, q) => p.best - q.best);
    games.forEach((g, k) => { g.match.id = fromEnd === 0 ? 'FINAL' : `${ROUND_IDS[fromEnd] ?? `R${size >> (r - 1)}-`}${k + 1}`; });
    out.push(...games.map((g) => g.match));
    if (fromEnd === 1) semis = games.map((g) => g.match);
    nodes = next;
  }
  if (rounds >= 2 && semis.length === 2) out.push(play('THIRD', '3rd Place', reg + rounds, semis[0].loser, semis[1].loser));
  return out;
}
