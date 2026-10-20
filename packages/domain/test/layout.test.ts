import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_RULES, ROSTER_LABELS, ROSTER_SIZE, applyRulesPatch, assignSlots, buildBracket, canFillSlot, describeRulesChange, labelsOfType, normalizeRules, placePlayer, playoffRounds, rosterLabels, rosterSizeOf, sectionLabels, slotLabelRank, slotTypeOf, standings, totalWeeks, validateBid, type Layout } from '../src';

const lay = (o: Partial<Layout>): Layout => ({ ...DEFAULT_LAYOUT, ...o });

describe('layout labels', () => {
  it('the default layout is exactly the original 26 labels', () => {
    expect(rosterLabels()).toEqual(['C', '1B', '2B', '3B', 'SS', 'IF', 'OF1', 'OF2', 'OF3', 'OF4', 'Util1', 'Util2', 'SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2', 'RP3', 'RP4', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
    expect(rosterLabels()).toEqual([...ROSTER_LABELS]); expect(rosterSizeOf()).toBe(26); expect(ROSTER_SIZE).toBe(26);
  });
  it('keeps old labels stable when counts change', () => {
    expect(labelsOfType('C', 1)).toEqual(['C']); expect(labelsOfType('C', 2)).toEqual(['C', 'C2']);       // the first catcher keeps "C"
    expect(labelsOfType('OF', 5)).toEqual(['OF1', 'OF2', 'OF3', 'OF4', 'OF5']);
    expect(labelsOfType('OF', 3)).toEqual(['OF1', 'OF2', 'OF3']);                                          // shrinking removes the highest numbers
    expect(rosterLabels(lay({ BN: 8 })).slice(-2)).toEqual(['B7', 'B8']); expect(rosterLabels(lay({ SS: 0 }))).not.toContain('SS');
    expect(rosterSizeOf(lay({ OF: 5, BN: 4 }))).toBe(25);
  });
  it('splits into hitter, pitcher and bench sections', () => {
    const s = sectionLabels(lay({ OF: 5, SP: 5, BN: 3 }));
    expect(s.hit.length).toBe(13); expect(s.pit.length).toBe(9); expect(s.bench).toEqual(['B1', 'B2', 'B3']);
    expect(s.hit.slice(0, 6)).toEqual(['C', '1B', '2B', '3B', 'SS', 'IF']);
  });
  it('recognises the kind of a stored label', () => {
    expect(slotTypeOf('OF3')).toBe('OF'); expect(slotTypeOf('Util2')).toBe('UTIL'); expect(slotTypeOf('B6')).toBe('BN'); expect(slotTypeOf('C2')).toBe('C');
    expect(slotTypeOf('1B')).toBe('1B'); expect(slotTypeOf('2B2')).toBe('2B'); expect(slotTypeOf('IL1')).toBeNull(); expect(slotTypeOf('INF')).toBe('IF');
  });
  it('every generated label works with canFillSlot', () => {
    expect(canFillSlot('C2', ['C'])).toBe(true); expect(canFillSlot('C2', ['SS'])).toBe(false); expect(canFillSlot('OF5', ['OF'])).toBe(true);
    expect(canFillSlot('SP6', ['SP'])).toBe(true); expect(canFillSlot('B9', ['RP'])).toBe(true); expect(canFillSlot('Util3', ['C'])).toBe(true); expect(canFillSlot('Util3', ['SP'])).toBe(false);
  });
  it('orders by the layout, with old labels kept near their own kind', () => {
    const small = lay({ OF: 2 });
    expect(slotLabelRank('OF2', small)).toBeLessThan(slotLabelRank('Util1', small));
    expect(slotLabelRank('OF4', small)).toBeGreaterThan(slotLabelRank('OF2', small)); expect(slotLabelRank('OF4', small)).toBeLessThan(slotLabelRank('Util1', small));   // OF4 no longer exists but sorts with the outfielders
    expect(slotLabelRank('IL1', small)).toBeGreaterThan(slotLabelRank('B6', small));
  });
});

describe('seating players in other layouts', () => {
  it('assignSlots fills the extra slots and respects removed ones', () => {
    const outfielders = Array.from({ length: 6 }, (_, i) => ({ playerId: i + 1, positions: ['OF'] }));
    const five = assignSlots(outfielders, lay({ OF: 5 }));
    expect([...five.values()].filter((l) => l.startsWith('OF'))).toEqual(['OF1', 'OF2', 'OF3', 'OF4', 'OF5']);     // the sixth goes to Util/bench
    const two = assignSlots(outfielders, lay({ OF: 2, UTIL: 0, BN: 1 }));
    expect([...two.values()].sort()).toEqual(['B1', 'OF1', 'OF2']);                                                    // only 3 fit; the rest are left out
  });
  it('assignSlots defaults to the original layout', () => {
    expect(assignSlots([{ playerId: 1, positions: ['C'] }, { playerId: 2, positions: ['C'] }]).get(2)).toBe('Util1');
    expect(assignSlots([{ playerId: 1, positions: ['C'] }, { playerId: 2, positions: ['C'] }], lay({ C: 2 })).get(2)).toBe('C2');
  });
  it('placePlayer finds seats using the layout’s slots', () => {
    const current = [{ playerId: 1, positions: ['OF'], slot: 'OF1' }];
    expect(placePlayer(current, { playerId: 2, positions: ['OF'] }, lay({ OF: 1, UTIL: 0, BN: 0, IF: 0 }))).toBeNull();         // nowhere to sit
    expect(placePlayer(current, { playerId: 2, positions: ['OF'] }, lay({ OF: 2 }))?.get(2)).toBe('OF2');
  });
  it('bids know the roster size', () => {
    expect(validateBid(1, 0, 30, { budget: 300, minBid: 1, rosterSize: 30 }).ok).toBe(false);
    expect(validateBid(1, 0, 29, { budget: 300, minBid: 1, rosterSize: 30 }).ok).toBe(true);
    expect(validateBid(1, 0, 25, { budget: 300, minBid: 1 }).ok).toBe(true);
  });
});

describe('playoff brackets of any size', () => {
  const seeds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
  // lower seed number always scores more, so the higher seed always wins
  const chalk = (t: string) => 100 - Number(t.slice(1));
  const score = (t: string) => chalk(t);
  const names = (n: number, reg = 20) => buildBracket(seeds.slice(0, n), score, { playoffTeams: n, regularWeeks: reg }).map((m) => `${m.id}:${m.a ?? '-'}v${m.b ?? '-'}@${m.week}`);

  it('rounds and weeks', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(playoffRounds)).toEqual([0, 0, 1, 2, 2, 3, 3, 3, 3]);
    expect(totalWeeks(23, 6)).toBe(26); expect(totalWeeks(20, 4)).toBe(22); expect(totalWeeks(24, 0)).toBe(24); expect(totalWeeks(25, 2)).toBe(26);
  });
  it('no playoffs, no bracket', () => { expect(buildBracket([], score, { playoffTeams: 0 })).toEqual([]); });
  it('2 teams: just a final', () => { expect(names(2)).toEqual(['FINAL:S1vS2@21']); });
  it('4 teams: 1v4 and 2v3, final, third place', () => {
    expect(names(4)).toEqual(['SF1:S1vS4@21', 'SF2:S2vS3@21', 'FINAL:S1vS2@22', 'THIRD:S4vS3@22']);
  });
  it('3 teams: seed 1 has a bye', () => { expect(names(3)).toEqual(['SF1:S2vS3@21', 'FINAL:S1vS2@22']); });
  it('5 teams: seeds 1–3 have byes and 4v5 plays in', () => {
    const m = names(5);
    expect(m[0]).toBe('R1:S4vS5@21'.replace('R1', m[0].split(':')[0])); expect(m[0].endsWith('S4vS5@21')).toBe(true);
    expect(m.find((x) => x.startsWith('FINAL'))).toBe('FINAL:S1vS2@23');
    expect(m).toHaveLength(1 + 2 + 1 + 1);                                  // one play-in, two semis, final, third place
  });
  it('6 teams matches the original bracket exactly (default format)', () => {
    expect(buildBracket(seeds.slice(0, 6), score).map((m) => `${m.id}:${m.a}v${m.b}@${m.week}`)).toEqual(['QF1:S3vS6@24', 'QF2:S4vS5@24', 'SF1:S1vS4@25', 'SF2:S2vS3@25', 'FINAL:S1vS2@26', 'THIRD:S4vS3@26']);
  });
  it('8 teams: the standard bracket, and names the rounds', () => {
    const b = buildBracket(seeds, score, { playoffTeams: 8, regularWeeks: 23 });
    expect(b.map((m) => m.id)).toEqual(['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'FINAL', 'THIRD']);
    expect(b.slice(0, 4).map((m) => `${m.a}v${m.b}`)).toEqual(['S1vS8', 'S2vS7', 'S3vS6', 'S4vS5']);
    expect(b.find((m) => m.id === 'SF1')).toMatchObject({ a: 'S1', b: 'S4', week: 25, round: 'Semifinal' });      // 1 meets the 4/5 winner, 2 meets the 3/6 winner
    expect(b.find((m) => m.id === 'SF2')).toMatchObject({ a: 'S2', b: 'S3' });
    expect(b.find((m) => m.id === 'FINAL')).toMatchObject({ a: 'S1', b: 'S2', week: 26, round: 'Championship' });
  });
  it('undecided rounds stay open, and ties go to the higher seed', () => {
    const early = buildBracket(seeds.slice(0, 4), (t, w) => (w === 21 ? 50 : null), { playoffTeams: 4, regularWeeks: 20 });
    expect(early.find((m) => m.id === 'SF1')).toMatchObject({ winner: 'S1' }); expect(early.find((m) => m.id === 'FINAL')).toMatchObject({ a: 'S1', b: 'S2', winner: null });
    const missing = buildBracket([], score, { playoffTeams: 4, regularWeeks: 20 });
    expect(missing.find((m) => m.id === 'SF1')).toMatchObject({ a: null, b: null });
  });
  it('standings can use another playoff size', () => {
    const teams = ['A', 'B', 'C', 'D'];
    const results = [{ week: 1, home: 'A', away: 'B', homeScore: 10, awayScore: 5 }, { week: 1, home: 'C', away: 'D', homeScore: 10, awayScore: 5 }];
    expect(standings(teams, results, 1, 2).find((r) => r.teamId === 'A')?.status).toBe('clinched');
    expect(standings(teams, results, 1, 0).every((r) => r.status === 'alive')).toBe(true);
  });
});

describe('rules: layout and season format', () => {
  const ok = (p: unknown, c = DEFAULT_RULES) => { const r = applyRulesPatch(c, p); if (!r.ok) throw new Error(r.reason); return r.rules; };
  const why = (p: unknown, c = DEFAULT_RULES) => { const r = applyRulesPatch(c, p); return r.ok ? null : r.reason; };
  it('changes slot counts', () => {
    const r = ok({ roster: { OF: 5, BN: 4 } });
    expect(r.roster.OF).toBe(5); expect(r.roster.BN).toBe(4); expect(r.roster.SP).toBe(4); expect(rosterSizeOf(r.roster)).toBe(25); expect(DEFAULT_RULES.roster.OF).toBe(4);
  });
  it('refuses nonsense layouts', () => {
    expect(why({ roster: { OF: 11 } })).toMatch(/between 0 and 10/); expect(why({ roster: { OF: -1 } })).toBeTruthy(); expect(why({ roster: { OF: 1.5 } })).toMatch(/whole/);
    expect(why({ roster: { GOALIE: 1 } })).toMatch(/Unknown slot/); expect(why({ roster: [1] })).toBeTruthy();
    expect(why({ roster: { BN: 0, OF: 0, UTIL: 0, IF: 0, C: 1, '1B': 0, '2B': 0, '3B': 0, SS: 0, SP: 0, RP: 0 } })).toMatch(/between 10 and 40/);
    expect(why({ roster: { SP: 0, RP: 0 } })).toMatch(/pitcher slot/);
    expect(why({ roster: { C: 0, '1B': 0, '2B': 0, '3B': 0, SS: 0, IF: 0, OF: 0, UTIL: 0, BN: 12 } })).toMatch(/hitter slot/);
    expect(why({ roster: { BN: 20, OF: 10, UTIL: 8 } })).toMatch(/between 10 and 40/);
  });
  it('a bigger roster has to still fit the budget at the minimum bid', () => {
    expect(why({ roster: { BN: 20 }, minBid: 10 })).toMatch(/has to fit in the budget/);
  });
  it('season format limits', () => {
    expect(ok({ regularWeeks: 20, playoffTeams: 4 }).playoffTeams).toBe(4);
    expect(why({ playoffTeams: 1 })).toMatch(/at least 2/); expect(why({ playoffTeams: 9 })).toBeTruthy(); expect(why({ regularWeeks: 0 })).toBeTruthy(); expect(why({ regularWeeks: 27 })).toBeTruthy();
    expect(why({ regularWeeks: 24, playoffTeams: 6 })).toMatch(/at most 26 weeks/);
    expect(ok({ regularWeeks: 26, playoffTeams: 0 }).regularWeeks).toBe(26);
    expect(ok({ regularWeeks: 24, playoffTeams: 4 }).regularWeeks).toBe(24);
  });
  it('describes the changes', () => {
    const next = ok({ roster: { OF: 5 }, regularWeeks: 20, playoffTeams: 4 });
    expect(describeRulesChange(DEFAULT_RULES, next)).toEqual(['Regular-season weeks 23 → 20', 'Playoff teams 6 → 4', 'Outfield slots 4 → 5']);
  });
  it('stored rules are normalised, including a layout that no longer validates', () => {
    expect(normalizeRules({}).roster).toEqual(DEFAULT_LAYOUT); expect(normalizeRules({ roster: { OF: 5 } }).roster.OF).toBe(5); expect(normalizeRules({ roster: { OF: 99 } }).roster.OF).toBe(4);
    expect(normalizeRules({ roster: Object.fromEntries(Object.keys(DEFAULT_LAYOUT).map((k) => [k, 0])) }).roster).toEqual(DEFAULT_LAYOUT);
    expect(normalizeRules({ regularWeeks: 20, playoffTeams: 4 })).toMatchObject({ regularWeeks: 20, playoffTeams: 4 });
    expect(normalizeRules({ playoffTeams: 1 }).playoffTeams).toBe(1);
  });
});
