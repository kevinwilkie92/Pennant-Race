import { describe, expect, it } from 'vitest';
import { BUDGET, DEFAULT_RULES, FAAB_BUDGET, HIT_SCORING, MAX_IL, MAX_KEEPERS, MIN_BID, PIT_SCORING, ROSTER_SIZE, allLabels, applyRulesPatch, describeRulesChange, ilLabels, keeperCost, maxBid, normalizeRules, scoreHitter, scorePitcher, scoringChanged, slotLabelRank, validateBid, validateKeepers } from '../src';

const ok = (p: unknown, cur = DEFAULT_RULES) => { const r = applyRulesPatch(cur, p); if (!r.ok) throw new Error(r.reason); return r.rules; };
const why = (p: unknown, cur = DEFAULT_RULES) => { const r = applyRulesPatch(cur, p); return r.ok ? null : r.reason; };

describe('rule-aware helpers keep today’s numbers by default', () => {
  it('bids', () => { expect(maxBid(0, 0)).toBe(275); expect(validateBid(276, 0, 0).ok).toBe(false); expect(validateBid(275, 0, 0).ok).toBe(true); });
  it('bids follow a changed budget and minimum bid', () => {
    expect(maxBid(0, 0, 400, 26, 1)).toBe(375);
    expect(maxBid(0, 0, 400, 26, 2)).toBe(350);
    expect(validateBid(376, 0, 0, { budget: 400, minBid: 1 }).ok).toBe(false);
    expect(validateBid(375, 0, 0, { budget: 400, minBid: 1 }).ok).toBe(true);
    expect(validateBid(1, 0, 0, { budget: 400, minBid: 2 }).ok).toBe(false);
  });
  it('keeper cost follows the increase, never below the minimum bid', () => {
    expect(keeperCost({ yearsKept: 0, lastPrice: 12, avgSalary: null })).toBe(17);
    expect(keeperCost({ yearsKept: 0, lastPrice: 12, avgSalary: null }, { keeperIncrease: 10, minBid: 1 })).toBe(22);
    expect(keeperCost({ yearsKept: 0, lastPrice: null, avgSalary: null }, { keeperIncrease: 10, minBid: 1 })).toBe(10);
    expect(keeperCost({ yearsKept: 0, lastPrice: 1, avgSalary: null }, { keeperIncrease: 0, minBid: 3 })).toBe(3);
    expect(keeperCost({ yearsKept: 1, lastPrice: 12, avgSalary: 20.6 }, { keeperIncrease: 10, minBid: 1 })).toBe(21);   // Year 2 is the ESPN average
  });
  it('keeper limits', () => { expect(validateKeepers(5).ok).toBe(true); expect(validateKeepers(6).ok).toBe(false); expect(validateKeepers(2, 2).ok).toBe(true); expect(validateKeepers(3, 2).ok).toBe(false); });
  it('injured-list labels follow the slot count', () => {
    expect(ilLabels(6)).toEqual(['IL1', 'IL2', 'IL3', 'IL4', 'IL5', 'IL6']); expect(allLabels(2).slice(-2)).toEqual(['IL1', 'IL2']);
    expect(slotLabelRank('IL5')).toBeGreaterThan(slotLabelRank('IL4')); expect(slotLabelRank('IL1')).toBeGreaterThan(slotLabelRank('B6')); expect(slotLabelRank('C')).toBe(0);
  });
  it('scoring tables can be swapped', () => {
    expect(scoreHitter({ HR: 2 })).toBe(8);
    expect(scoreHitter({ HR: 2 }, { ...DEFAULT_RULES.hit, HR: 5 })).toBe(10);
    expect(scorePitcher({ K: 10, ER: 2 }, { ...DEFAULT_RULES.pit, K: 0.5 })).toBe(5 - 4);
  });
});

describe('applyRulesPatch', () => {
  it('changes some rules and leaves the rest', () => {
    const r = ok({ budget: 400, hit: { HR: 5 } });
    expect(r.budget).toBe(400); expect(r.hit.HR).toBe(5); expect(r.hit['1B']).toBe(1); expect(r.maxKeepers).toBe(5);
    expect(DEFAULT_RULES.hit.HR).toBe(4);                                   // the defaults are never mutated
  });
  it('accepts fractional and negative scoring up to 2 decimals', () => {
    const r = ok({ hit: { SO: -0.5, BB: 0.25 }, pit: { IP: 2.5 } });
    expect(r.hit.SO).toBe(-0.5); expect(r.hit.BB).toBe(0.25); expect(r.pit.IP).toBe(2.5);
  });
  it('refuses out-of-range, fractional-dollar and unknown values', () => {
    expect(why({ budget: 99 })).toMatch(/between 100 and 1000/); expect(why({ budget: 1001 })).toBeTruthy(); expect(why({ budget: 250.5 })).toMatch(/whole number/);
    expect(why({ minBid: 0 })).toBeTruthy(); expect(why({ maxKeepers: 11 })).toBeTruthy(); expect(why({ maxKeepers: -1 })).toBeTruthy(); expect(why({ ilSlots: 0 })).toBeTruthy(); expect(why({ ilSlots: 9 })).toBeTruthy();
    expect(why({ hit: { HR: 51 } })).toMatch(/between -50 and 50/); expect(why({ hit: { HR: 0.001 } })).toMatch(/2 decimals/); expect(why({ hit: { HR: 'x' } })).toBeTruthy();
    expect(why({ hit: { PUNT: 1 } })).toMatch(/Unknown hitting stat/); expect(why({ pit: { HR: 1 } })).toMatch(/Unknown pitching stat/); expect(why({ nope: 1 })).toMatch(/Unknown rule/);
    expect(why({ hit: [1] })).toBeTruthy(); expect(why({})).toMatch(/Nothing/); expect(why(null)).toMatch(/Nothing/); expect(why([1])).toBeTruthy(); expect(why({ budget: NaN })).toBeTruthy();
  });
});

describe('a full roster has to be affordable', () => {
  it('allows exactly a full roster at the minimum bid, refuses one dollar less', () => {
    expect(why({ budget: 260, minBid: 10 })).toBeNull();
    expect(why({ budget: 259, minBid: 10 })).toMatch(/at least \$260/);
    expect(why({ budget: 100, minBid: 5 })).toMatch(/at least \$130/);
    expect(why({ minBid: 10 })).toBeNull();                                  // $260 fits in the default $300
  });
});

describe('normalizeRules + describe', () => {
  it('fills gaps and ignores junk from storage', () => {
    expect(normalizeRules({})).toEqual(DEFAULT_RULES); expect(normalizeRules(null)).toEqual(DEFAULT_RULES); expect(normalizeRules('x')).toEqual(DEFAULT_RULES);
    const r = normalizeRules({ budget: 400, minBid: 'x', hit: { HR: 5, SO: 999 }, pit: 3, extra: 1 });
    expect(r.budget).toBe(400); expect(r.minBid).toBe(1); expect(r.hit.HR).toBe(5); expect(r.hit.SO).toBe(-1); expect(r.pit).toEqual(DEFAULT_RULES.pit);
  });
  it('describes changes for the history', () => {
    const next = ok({ budget: 400, hit: { HR: 5 }, pit: { QS: 6 } });
    expect(describeRulesChange(DEFAULT_RULES, next)).toEqual(['Auction budget $300 → $400', 'Hitting: Home run 4 → 5', 'Pitching: Quality start 5 → 6']);
    expect(describeRulesChange(DEFAULT_RULES, DEFAULT_RULES)).toEqual([]);
    expect(scoringChanged(DEFAULT_RULES, next)).toBe(true); expect(scoringChanged(DEFAULT_RULES, ok({ budget: 400 }))).toBe(false);
  });
});

describe('defaults mirror the original constants', () => {
  it('agree with index.ts', () => {
    expect(DEFAULT_RULES.budget).toBe(BUDGET); expect(DEFAULT_RULES.minBid).toBe(MIN_BID); expect(DEFAULT_RULES.maxKeepers).toBe(MAX_KEEPERS);
    expect(DEFAULT_RULES.faabBudget).toBe(FAAB_BUDGET); expect(DEFAULT_RULES.ilSlots).toBe(MAX_IL);
    expect(DEFAULT_RULES.hit).toEqual(HIT_SCORING); expect(DEFAULT_RULES.pit).toEqual(PIT_SCORING);
    expect(applyRulesPatch(DEFAULT_RULES, { budget: 26 * 1 + 74 }).ok).toBe(true);
    expect(ROSTER_SIZE).toBe(26);
  });
});
