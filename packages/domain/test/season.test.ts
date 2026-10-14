import { describe, it, expect } from 'vitest';
import {
  parseInnings, isQualityStart, singles, weekRange, generateSchedule, standings, buildBracket, type Result,
} from '../src';

const TEAMS = Array.from({ length: 12 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);

describe('stat helpers', () => {
  it('parses innings notation as thirds', () => {
    expect(parseInnings('6.1')).toBeCloseTo(6.3333, 3);
    expect(parseInnings('7')).toBe(7);
    expect(parseInnings('0.2')).toBeCloseTo(0.6667, 3);
    expect(() => parseInnings('6.3')).toThrow();
  });
  it('quality start needs a start, 6+ IP and <=3 ER', () => {
    expect(isQualityStart({ gamesStarted: 1, innings: 6, earnedRuns: 3 })).toBe(true);
    expect(isQualityStart({ gamesStarted: 1, innings: 5 + 2 / 3, earnedRuns: 0 })).toBe(false);
    expect(isQualityStart({ gamesStarted: 1, innings: 7, earnedRuns: 4 })).toBe(false);
    expect(isQualityStart({ gamesStarted: 0, innings: 7, earnedRuns: 0 })).toBe(false);
  });
  it('derives singles from hits', () => {
    expect(singles({ hits: 4, doubles: 1, triples: 0, homeRuns: 1 })).toBe(2);
  });
});

describe('calendar', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekRange('2027-03-29', 1)).toEqual({ start: '2027-03-29', end: '2027-04-04' });
    expect(weekRange('2027-03-29', 2).start).toBe('2027-04-05');
    expect(() => weekRange('2027-03-30', 1)).toThrow();
  });
});

describe('schedule', () => {
  const sched = generateSchedule(TEAMS);
  it('every team plays exactly once each week, for 23 weeks', () => {
    for (let w = 1; w <= 23; w++) {
      const wk = sched.filter((p) => p.week === w);
      expect(wk.length).toBe(6);
      expect(new Set(wk.flatMap((p) => [p.home, p.away])).size).toBe(12);
    }
    expect(sched.length).toBe(23 * 6);
  });
  it('each opponent appears once per 11-week cycle', () => {
    for (const t of TEAMS) {
      const opp = sched.filter((p) => p.week <= 11 && (p.home === t || p.away === t)).map((p) => (p.home === t ? p.away : p.home));
      expect(new Set(opp).size).toBe(11);
    }
  });
  it('rejects an odd number of teams', () => {
    expect(() => generateSchedule(['A', 'B', 'C'])).toThrow();
  });
});

describe('standings', () => {
  const r = (week: number, home: string, away: string, h: number, a: number): Result => ({ week, home, away, homeScore: h, awayScore: a });
  it('computes record, PCT, GB, PF/PA and streak, ranking by PCT then PF', () => {
    const rows = standings(['A', 'B', 'C', 'D'], [
      r(1, 'A', 'B', 100, 90), r(1, 'C', 'D', 80, 85),
      r(2, 'A', 'C', 70, 95), r(2, 'B', 'D', 110, 60),
      r(3, 'A', 'D', 120, 100), r(3, 'B', 'C', 100, 100),
    ], 3);
    const by = Object.fromEntries(rows.map((x) => [x.teamId, x]));
    expect(by.A).toMatchObject({ w: 2, l: 1, t: 0, pf: 290, pa: 285, streak: 'W1' });
    expect(by.B).toMatchObject({ w: 1, l: 1, t: 1 });
    expect(by.C).toMatchObject({ w: 1, l: 1, t: 1, streak: 'T1' });
    expect(by.A.rank).toBe(1);
    expect(by.A.pct).toBeCloseTo(0.667, 3);
    expect(by.B.pct).toBe(0.5);
    expect(by.B.gb).toBe(0.5);            // (2-1)+(1-1) over 2
    expect(by.B.rank).toBeLessThan(by.C.rank); // equal PCT, B has more PF (310 vs 280)
  });
  it('ignores playoff weeks', () => {
    const rows = standings(['A', 'B'], [{ week: 24, home: 'A', away: 'B', homeScore: 9, awayScore: 1 }]);
    expect(rows.every((x) => x.played === 0)).toBe(true);
  });
  it('marks clinched and eliminated teams using remaining games', () => {
    const teams = TEAMS;
    // Seven weeks into a 23-week schedule, T01..T06 have won every game; T07..T12 lost every game.
    const sched = generateSchedule(teams).filter((p) => p.week <= 22);
    const strong = new Set(teams.slice(0, 6));
    const results = sched.map((p) => ({
      week: p.week, home: p.home, away: p.away,
      homeScore: strong.has(p.home) && !strong.has(p.away) ? 100 : strong.has(p.away) && !strong.has(p.home) ? 50 : 75,
      awayScore: strong.has(p.away) && !strong.has(p.home) ? 100 : strong.has(p.home) && !strong.has(p.away) ? 50 : 75,
    }));
    const rows = standings(teams, results);
    expect(rows.find((x) => x.teamId === 'T12')!.remaining).toBe(1);
    // Strong teams: at most the 5 other strong teams can catch them -> clinched.
    expect(rows.filter((x) => strong.has(x.teamId)).every((x) => x.status === 'clinched')).toBe(true);
    // Weak teams: six teams already have more wins than they can reach -> eliminated.
    expect(rows.filter((x) => !strong.has(x.teamId)).every((x) => x.status === 'eliminated')).toBe(true);
  });
  it('stays alive while the race is still open', () => {
    // After 3 weeks nobody is out of it: 20 games remain and wins are close.
    const sched = generateSchedule(TEAMS).filter((p) => p.week <= 3);
    const rows = standings(TEAMS, sched.map((p, i) => ({ ...p, homeScore: 100 + i, awayScore: 90 })));
    expect(rows.every((x) => x.status === 'alive')).toBe(true);
  });
  it('a team cannot be eliminated or clinched on day one', () => {
    expect(standings(TEAMS, []).every((x) => x.status === 'alive')).toBe(true);
  });
});

describe('bracket', () => {
  const seeds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
  const scores: Record<string, number> = {
    'S3-24': 90, 'S6-24': 80,   // S3 beats S6
    'S4-24': 70, 'S5-24': 70,   // tie -> higher seed S4
    'S1-25': 100, 'S4-25': 60,  // S1 beats S4
    'S2-25': 50, 'S3-25': 55,   // S3 upsets S2
    'S1-26': 10, 'S3-26': 20,   // S3 wins title
    'S4-26': 5, 'S2-26': 9,     // S2 takes 3rd
  };
  const score = (t: string, w: number) => scores[`${t}-${w}`] ?? null;
  const m = Object.fromEntries(buildBracket(seeds, score).map((x) => [x.id, x]));
  it('plays seeds 3-6 in the quarterfinals and breaks ties by seed', () => {
    expect(m.QF1).toMatchObject({ a: 'S3', b: 'S6', winner: 'S3' });
    expect(m.QF2).toMatchObject({ a: 'S4', b: 'S5', winner: 'S4' });
  });
  it('byes enter at the semifinals against the quarterfinal winners', () => {
    expect(m.SF1).toMatchObject({ a: 'S1', b: 'S4', winner: 'S1' });
    expect(m.SF2).toMatchObject({ a: 'S2', b: 'S3', winner: 'S3' });
  });
  it('week 26 has a championship and a 3rd-place game', () => {
    expect(m.FINAL).toMatchObject({ a: 'S1', b: 'S3', winner: 'S3' });
    expect(m.THIRD).toMatchObject({ a: 'S4', b: 'S2', winner: 'S2' });
  });
  it('leaves later rounds undecided until earlier weeks finish', () => {
    const early = Object.fromEntries(buildBracket(seeds, (t, w) => (w === 24 ? score(t, w) : null)).map((x) => [x.id, x]));
    expect(early.SF1.b).toBe('S4');
    expect(early.SF1.winner).toBeNull();
    expect(early.FINAL.a).toBeNull();
  });
});
