import { describe, expect, it } from 'vitest';
import { gameStat, hitterLine, isInjuredListCode, matchPlayers, normalizeName, pitcherLine, roleOf, summarize } from '../src';

describe('normalizeName', () => {
  it('strips accents, punctuation, suffixes, markers and role tags', () => {
    expect(normalizeName('Yandy Díaz')).toBe('yandy diaz');
    expect(normalizeName('Enrique Bradfield Jr.')).toBe('enrique bradfield');
    expect(normalizeName('J.T. Ginn*')).toBe('j t ginn');
    expect(normalizeName('Shohei Ohtani (Pitcher)')).toBe('shohei ohtani');
    expect(normalizeName('Max Muncy - LAD')).toBe('max muncy');
    expect(normalizeName("Tre' Morgan")).toBe('tre morgan');
    expect(normalizeName('Robert Hassell III')).toBe('robert hassell');
  });
});

describe('matchPlayers', () => {
  const theirs = [
    { id: 1, name: 'Luis García', team: 'WSH' }, { id: 2, name: 'Luis Garcia', team: 'CLE' },
    { id: 3, name: 'Aaron Civale', team: 'ATH' }, { id: 4, name: 'Jordan Westburg', team: 'BAL' },
    { id: 5, name: 'Shohei Ohtani', team: 'LAD' },
  ];
  it('matches by name + team, then by a name that is unique', () => {
    const r = matchPlayers([
      { id: 10, name: 'Luis Garcia', team: 'CLE' }, { id: 11, name: 'Aaron Civale*', team: 'MIL' }, { id: 12, name: 'Jordan Westburg', team: null },
    ], theirs);
    expect(r.matched.get(10)).toBe(2);
    expect(r.matched.get(11)).toBe(3);            // moved teams, unique name
    expect(r.matched.get(12)).toBe(4);
  });
  it('uses a " - TEAM" suffix to pick between namesakes', () => {
    const two = [{ id: 1, name: 'Max Muncy', team: 'LAD' }, { id: 2, name: 'Max Muncy', team: 'ATH' }];
    expect(matchPlayers([{ id: 9, name: 'Max Muncy - LAD', team: null }], two).matched.get(9)).toBe(1);
  });
  it('leaves ambiguous and unknown names unmatched', () => {
    const r = matchPlayers([{ id: 20, name: 'Luis Garcia', team: 'NYY' }, { id: 21, name: 'Nobody Real', team: 'NYY' }], theirs);
    expect(r.matched.size).toBe(0);
    expect(r.unmatched.map((u) => u.id)).toEqual([20, 21]);
  });
  it('maps both Ohtani rows to the one person', () => {
    const r = matchPlayers([{ id: 30, name: 'Shohei Ohtani (Batter)', team: 'LAD' }, { id: 31, name: 'Shohei Ohtani (Pitcher)', team: 'LAD' }], theirs);
    expect(r.matched.get(30)).toBe(5); expect(r.matched.get(31)).toBe(5);
  });
});

describe('roleOf', () => {
  it('uses position, and the Ohtani tags', () => {
    expect(roleOf({ name: 'A', pos: 'SP' })).toBe('P'); expect(roleOf({ name: 'A', pos: 'RP' })).toBe('P');
    expect(roleOf({ name: 'A', pos: 'OF' })).toBe('H'); expect(roleOf({ name: 'Shohei Ohtani (Pitcher)', pos: 'Util' })).toBe('P');
    expect(roleOf({ name: 'Shohei Ohtani (Batter)', pos: 'Util' })).toBe('H');
  });
});

describe('scoring box lines', () => {
  it('scores a hitter line (3-5, 2 RBI, R) as the league rules say', () => {
    const l = hitterLine({ gamesPlayed: 1, hits: 3, doubles: 0, triples: 0, homeRuns: 0, runs: 1, rbi: 2, baseOnBalls: 0, strikeOuts: 0, stolenBases: 0 })!;
    expect(l['1B']).toBe(3);
    expect(gameStat('H', { stats: { batting: { gamesPlayed: 1, hits: 3, runs: 1, rbi: 2 } }, battingOrder: '100', position: { abbreviation: 'DH' } })!.points).toBe(3 + 1 + 2);
  });
  it('counts an intentional walk once', () => {
    const s = gameStat('H', { stats: { batting: { gamesPlayed: 1, baseOnBalls: 2, intentionalWalks: 1 } } })!;
    expect(s.points).toBe(2);
  });
  it('scores a hitter with every stat', () => {
    // 1B 2, 2B 1, 3B 0, HR 1 (hits 4) + BB 1 + R 2 + RBI 3 + SB 1 + SO 2
    const s = gameStat('H', { stats: { batting: { gamesPlayed: 1, hits: 4, doubles: 1, homeRuns: 1, baseOnBalls: 1, runs: 2, rbi: 3, stolenBases: 1, strikeOuts: 2 } } })!;
    expect(s.points).toBe(2 * 1 + 2 + 4 + 1 + 2 + 3 + 2 - 2);
  });
  it('scores a quality start with a win', () => {
    // 7 IP, 0 ER, 13 K, 2 H, 1 BB, W, QS: 21 + 13 + 2 + 5 - 0 - 2 - 1
    const s = gameStat('P', { stats: { pitching: { gamesPlayed: 1, gamesStarted: 1, inningsPitched: '7.0', strikeOuts: 13, wins: 1, earnedRuns: 0, hits: 2, baseOnBalls: 1 } } })!;
    expect(s.points).toBe(38); expect(s.started).toBe(true);
  });
  it('handles thirds of an inning and relievers (save, hold)', () => {
    expect(pitcherLine({ gamesPlayed: 1, inningsPitched: '1.1', strikeOuts: 2, saves: 1 })!.IP).toBeCloseTo(4 / 3, 5);
    expect(gameStat('P', { stats: { pitching: { gamesPlayed: 1, inningsPitched: '1.0', strikeOuts: 1, holds: 1 } } })!.points).toBe(3 + 1 + 2);
  });
  it('a 6.0 IP, 4 ER start is not a quality start', () => {
    expect(pitcherLine({ gamesPlayed: 1, gamesStarted: 1, inningsPitched: '6.0', earnedRuns: 4 })!.QS).toBe(0);
    expect(pitcherLine({ gamesPlayed: 1, gamesStarted: 1, inningsPitched: '5.2', earnedRuns: 1 })!.QS).toBe(0);
  });
  it('a bench player with no stats did not play; a pitcher batting row is ignored for a hitter role', () => {
    expect(gameStat('H', { stats: { batting: {}, pitching: {} } })).toBeNull();
    expect(gameStat('P', { stats: { batting: { gamesPlayed: 1, hits: 2 }, pitching: {} } })).toBeNull();
  });
  it('tracks starts and eligibility positions', () => {
    const s = gameStat('H', { stats: { batting: { gamesPlayed: 1, hits: 1 } }, battingOrder: '300', position: { abbreviation: 'LF' } })!;
    expect(s.started).toBe(true); expect(s.pos).toBe('OF');
    expect(gameStat('H', { stats: { batting: { gamesPlayed: 1 } }, battingOrder: '301', position: { abbreviation: 'PH' } })!.started).toBe(false);
  });
});

describe('summarize + injury codes', () => {
  it('writes readable lines', () => {
    expect(summarize({ role: 'H', line: { '1B': 1, HR: 1, R: 1, RBI: 2, SO: 1 } })).toBe('2 H, HR, 1 R, 2 RBI, 1 K');
    expect(summarize({ role: 'P', line: { IP: 6 + 1 / 3, ER: 2, K: 7, W: 1, QS: 1 } })).toBe('6.1 IP, 2 ER, 7 K, W, QS');
  });
  it('recognises injured-list status codes', () => {
    expect(isInjuredListCode('D15')).toBe(true); expect(isInjuredListCode('D60')).toBe(true);
    expect(isInjuredListCode('A')).toBe(false); expect(isInjuredListCode(undefined)).toBe(false);
  });
});
