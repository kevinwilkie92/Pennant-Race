import { describe, it, expect } from 'vitest';
import {
  maxBid, validateBid, keeperCost, keeperTier, rolloverBucket, ROSTER_SIZE, ROSTER_LABELS,
  scoreHitter, scorePitcher, assignSlots, placePlayer, hitterEligibility, pitcherEligibility, canFillSlot, playerSubline,
} from '../src';

describe('draft budget', () => {
  it('roster has 26 slots matching labels', () => {
    expect(ROSTER_SIZE).toBe(26);
    expect(ROSTER_LABELS.length).toBe(26);
  });
  it('max bid holds back $1 per other open spot', () => {
    expect(maxBid(0, 0)).toBe(300 - 25);
    expect(maxBid(100, 10)).toBe(200 - 15);
    expect(maxBid(299, 25)).toBe(1);
    expect(maxBid(10, 26)).toBe(0);
  });
  it('validates bids', () => {
    expect(validateBid(0, 0, 0).ok).toBe(false);
    expect(validateBid(1.5, 0, 0).ok).toBe(false);
    expect(validateBid(275, 0, 0).ok).toBe(true);
    expect(validateBid(276, 0, 0).ok).toBe(false);
    expect(validateBid(1, 0, 26).ok).toBe(false);
  });
});

describe('keepers', () => {
  it('year 1 = last price + 5, flat 5 if undrafted', () => {
    expect(keeperCost({ yearsKept: 0, lastPrice: 12, avgSalary: 20 })).toBe(17);
    expect(keeperCost({ yearsKept: 0, lastPrice: null, avgSalary: 20 })).toBe(5);
  });
  it('year 2 = rounded ESPN average', () => {
    expect(keeperCost({ yearsKept: 1, lastPrice: 12, avgSalary: 20.6 })).toBe(21);
  });
  it('two years kept is ineligible', () => {
    expect(keeperTier({ yearsKept: 2, lastPrice: 1, avgSalary: 1 })).toBe(0);
    expect(keeperCost({ yearsKept: 2, lastPrice: 1, avgSalary: 1 })).toBeNull();
  });
  it('rollover buckets', () => {
    expect(rolloverBucket(2)).toBe('ineligible');
    expect(rolloverBucket(1)).toBe('year2');
    expect(rolloverBucket(0)).toBe('year1');
  });
});

describe('scoring', () => {
  it('scores a hitter line', () => {
    expect(scoreHitter({ '1B': 1, HR: 1, R: 1, RBI: 2, SO: 1 })).toBe(1 + 4 + 1 + 2 - 1);
  });
  it('scores a pitcher line', () => {
    expect(scorePitcher({ IP: 7, K: 8, W: 1, QS: 1, ER: 2, H: 5, BB: 1 })).toBe(21 + 8 + 2 + 5 - 4 - 5 - 1);
  });
});

describe('eligibility', () => {
  it('hitters: 5 starts or 10 appearances', () => {
    expect(hitterEligibility({ SS: { starts: 5, appearances: 5 }, '2B': { starts: 4, appearances: 9 }, '3B': { starts: 0, appearances: 10 } }).sort()).toEqual(['3B', 'SS']);
  });
  it('pitchers: SP after 3 starts, RP after 5 relief apps', () => {
    expect(pitcherEligibility({ starts: 3, reliefApps: 4 })).toEqual(['SP']);
    expect(pitcherEligibility({ starts: 2, reliefApps: 5 })).toEqual(['RP']);
  });
  it('subline and slot fit', () => {
    expect(playerSubline('NYY', ['2B', 'SS'])).toBe('NYY · 2B,SS');
    expect(canFillSlot('SS', ['2B', 'SS'])).toBe(true);
    expect(canFillSlot('INF', ['SS'])).toBe(true);
    expect(canFillSlot('UTIL', ['SP'])).toBe(false);
  });
});

describe('canFillSlot with roster labels', () => {
  it('accepts the label forms used in the lineup (OF1, Util2, IF, B3, SP4)', () => {
    expect(canFillSlot('OF3', ['OF'])).toBe(true);
    expect(canFillSlot('OF3', ['SS'])).toBe(false);
    expect(canFillSlot('Util2', ['1B'])).toBe(true);
    expect(canFillSlot('Util1', ['Util'])).toBe(true);
    expect(canFillSlot('Util1', ['SP'])).toBe(false);
    expect(canFillSlot('IF', ['3B'])).toBe(true);
    expect(canFillSlot('IF', ['OF'])).toBe(false);
    expect(canFillSlot('IF', ['C'])).toBe(false);
    expect(canFillSlot('C', ['C', '1B'])).toBe(true);
    expect(canFillSlot('SP4', ['SP', 'RP'])).toBe(true);
    expect(canFillSlot('RP2', ['SP'])).toBe(false);
    expect(canFillSlot('B3', ['SP'])).toBe(true);
    expect(canFillSlot('OF1', ['Util'])).toBe(false);
  });
});

describe('assignSlots', () => {
  it('keeps given slots and fills the rest by position, then IF, Util, bench', () => {
    const m = assignSlots([
      { playerId: 1, positions: ['SS'], slot: 'SS' },
      { playerId: 2, positions: ['SS'] },          // SS taken -> IF
      { playerId: 3, positions: ['SS'] },          // -> Util1
      { playerId: 4, positions: ['OF'] },
      { playerId: 5, positions: ['OF'] },
      { playerId: 6, positions: ['SP'] },
      { playerId: 7, positions: ['RP'] },
      { playerId: 8, positions: ['SP', 'RP'] },
    ]);
    expect(m.get(1)).toBe('SS');
    expect(m.get(2)).toBe('IF');
    expect(m.get(3)).toBe('Util1');
    expect([m.get(4), m.get(5)]).toEqual(['OF1', 'OF2']);
    expect(m.get(6)).toBe('SP1');
    expect(m.get(7)).toBe('RP1');
    expect(m.get(8)).toBe('SP2');
  });
  it('overflows to bench, never double-books, and drops extras past 26', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ playerId: i + 1, positions: ['OF'] }));
    const m = assignSlots(many);
    expect(m.size).toBe(12); // OF1-4, Util1-2, B1-6 (IF needs an infielder)
    expect(new Set(m.values()).size).toBe(m.size);
  });
});

describe('placePlayer', () => {
  const seat = (playerId: number, slot: string, positions: string[]) => ({ playerId, slot, positions });
  it('uses an open slot he fits without moving anyone', () => {
    const m = placePlayer([seat(1, 'SP1', ['SP'])], { playerId: 9, positions: ['SP'] })!;
    expect([...m]).toEqual([[9, 'SP2']]);
  });
  it('takes an open bench slot rather than bumping anyone when no position slot is free', () => {
    const full = ['SP1', 'SP2', 'SP3', 'SP4'].map((l, i) => seat(i + 1, l, ['SP']));
    const m = placePlayer(full, { playerId: 9, positions: ['SP'] })!;
    expect(m.get(9)).toBe('B1');
    expect(m.size).toBe(1);
  });
  it('re-seats an existing player when the only open slot is one the newcomer cannot take', () => {
    // Every slot is full except RP1; the newcomer is SP-only; a benched RP can take RP1 and free his bench seat.
    const lineup = ROSTER_LABELS.filter((l) => l !== 'RP1').map((l, i) => {
      const pos = l.startsWith('SP') ? ['SP'] : l.startsWith('RP') ? ['RP'] : l.startsWith('OF') ? ['OF'] : l.startsWith('B') ? ['RP'] : l === 'C' ? ['C'] : l === '1B' ? ['1B'] : l === '2B' ? ['2B'] : l === '3B' ? ['3B'] : l === 'SS' ? ['SS'] : l === 'IF' ? ['2B'] : ['1B'];
      return seat(i + 1, l, pos);
    });
    const m = placePlayer(lineup, { playerId: 99, positions: ['SP'] })!;
    expect(m).not.toBeNull();
    expect(m.get(99)?.startsWith('B')).toBe(true);
    const moved = [...m].filter(([id]) => id !== 99);
    expect(moved.length).toBe(1);
    expect(moved[0][1]).toBe('RP1');
    // The resulting lineup is legal and has no double-booked slots.
    const after = new Map(lineup.map((p) => [p.playerId, p.slot]));
    for (const [id, slot] of m) after.set(id, slot);
    expect(new Set(after.values()).size).toBe(after.size);
  });
  it('returns null when no legal lineup exists', () => {
    const full = ROSTER_LABELS.map((l, i) => seat(i + 1, l, ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'Util']));
    expect(placePlayer(full, { playerId: 99, positions: ['SP'] })).toBeNull();
  });
});
