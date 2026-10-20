import { describe, expect, it } from 'vitest';
import { battingAvg, careerTotals, countQualityStarts, era, hittingSeason, inningsFromOuts, pickSeasons, pitchingSeason } from '../src';

describe('pickSeasons', () => {
  it('uses the all-teams total for a traded player and lists his teams', () => {
    const rows = pickSeasons([
      { season: '2021', team: { id: 158 }, stat: { gamesPlayed: 15 } }, { season: '2021', team: { id: 139 }, stat: { gamesPlayed: 20 } },
      { season: '2021', numTeams: 2, stat: { gamesPlayed: 35 } }, { season: '2022', team: { id: 139 }, stat: { gamesPlayed: 12 } },
    ]);
    expect(rows.map((r) => r.season)).toEqual([2021, 2022]);
    expect(rows[0].stat.gamesPlayed).toBe(35); expect(rows[0].teamIds).toEqual([158, 139]);
    expect(rows[1].stat.gamesPlayed).toBe(12); expect(rows[1].teamIds).toEqual([139]);
  });
  it('sorts by season, ignores junk rows, and copes with a missing total', () => {
    const rows = pickSeasons([{ season: '2024', team: { id: 1 }, stat: { gamesPlayed: 10 } }, { season: '2020', team: { id: 1 }, stat: { gamesPlayed: 5 } }, { season: 'x', stat: {} }, { season: '2024', team: { id: 2 }, stat: { gamesPlayed: 30 } }]);
    expect(rows.map((r) => r.season)).toEqual([2020, 2024]);
    expect(rows[1].stat.gamesPlayed).toBe(30);                    // no total row: the biggest single row, not a guess
    expect(pickSeasons([])).toEqual([]);
  });
});

describe('season points use the league rules', () => {
  it('hitting: Aaron Judge-like line', () => {
    // 150 H (30 2B, 1 3B, 50 HR => 69 singles), 110 R, 120 RBI, 8 SB, 130 BB (10 IBB => 120 plain), 170 K
    const { stats, points } = hittingSeason({ gamesPlayed: 150, atBats: 520, hits: 150, doubles: 30, triples: 1, homeRuns: 50, runs: 110, rbi: 120, stolenBases: 8, baseOnBalls: 130, intentionalWalks: 10, strikeOuts: 170 });
    expect(stats.g).toBe(150);
    expect(points).toBe(69 + 60 + 3 + 200 + 120 + 10 + 110 + 120 + 16 - 170);        // 1B + 2B + 3B + HR + BB + IBB + R + RBI + SB - SO
  });
  it('pitching: 172 IP with quality starts counted separately', () => {
    const { stats, points } = pitchingSeason({ gamesPlayed: 30, gamesStarted: 30, inningsPitched: '172.0', wins: 14, strikeOuts: 180, earnedRuns: 60, hits: 140, baseOnBalls: 40, completeGames: 1, shutouts: 1, saves: 0, holds: 0 }, 18);
    expect(stats.outs).toBe(516); expect(stats.qs).toBe(18);
    expect(points).toBe(172 * 3 + 180 + 14 * 2 + 18 * 5 + 3 + 3 - 60 * 2 - 140 - 40);
  });
  it('thirds of an inning survive', () => {
    expect(pitchingSeason({ inningsPitched: '44.2' }, 0).stats.outs).toBe(134);
    expect(inningsFromOuts(134)).toBe('44.2'); expect(inningsFromOuts(0)).toBe('0.0');
  });
  it('missing stats are zeros, not NaN', () => {
    expect(hittingSeason({}).points).toBe(0); expect(pitchingSeason({}, 0).points).toBe(0);
  });
});

describe('quality starts from a game log', () => {
  it('counts starts of 6+ IP with 3 or fewer ER, and ignores relief outings', () => {
    expect(countQualityStarts([
      { gamesStarted: 1, inningsPitched: '7.0', earnedRuns: 2 }, { gamesStarted: 1, inningsPitched: '6.0', earnedRuns: 3 }, { gamesStarted: 1, inningsPitched: '6.0', earnedRuns: 4 },
      { gamesStarted: 1, inningsPitched: '5.2', earnedRuns: 0 }, { gamesStarted: 0, inningsPitched: '7.0', earnedRuns: 0 }, { gamesStarted: '1', inningsPitched: '8.1', earnedRuns: '1' },
    ])).toBe(3);
    expect(countQualityStarts([])).toBe(0);
  });
});

describe('career totals and rates', () => {
  it('adds seasons up', () => {
    const t = careerTotals([{ stats: { g: 100, hr: 20 }, points: 300.5 }, { stats: { g: 50, hr: 5, sb: 2 }, points: 100.25 }]);
    expect(t).toEqual({ stats: { g: 150, hr: 25, sb: 2 }, points: 400.75 });
    expect(careerTotals([])).toEqual({ stats: {}, points: 0 });
  });
  it('formats batting average and ERA', () => {
    expect(battingAvg(150, 500)).toBe('.300'); expect(battingAvg(1, 1)).toBe('1.000'); expect(battingAvg(0, 0)).toBe('—');
    expect(era(60, 516)).toBe('3.14'); expect(era(5, 0)).toBe('—');
  });
});
