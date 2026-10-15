import { describe, it, expect } from 'vitest';
import { parseMentions, splitMentions, activeMention, completeMention, cropRect, clampOffset, cropScale, zoomAround } from '../src';

const TEAMS = ['AM', 'RC', 'MJ', 'KS'];

describe('mentions', () => {
  it('finds each mentioned team once, ignoring case', () => {
    expect(parseMentions('hey @RC and @rc, also @MJ!', TEAMS)).toEqual(['RC', 'MJ']);
  });
  it('skips yourself, unknown teams and email-like text', () => {
    expect(parseMentions('@AM @ZZ me@RC.com @KS', TEAMS, 'AM')).toEqual(['KS']);
  });
  it('needs a word boundary on both sides', () => {
    expect(parseMentions('@RCs @RC1 x@RC (@RC)', TEAMS)).toEqual(['RC']);
  });
  it('splits a message into text and mentions', () => {
    expect(splitMentions('hi @RC, meet @mj', TEAMS)).toEqual([{ text: 'hi ' }, { mention: 'RC' }, { text: ', meet ' }, { mention: 'MJ' }]);
    expect(splitMentions('no mentions', TEAMS)).toEqual([{ text: 'no mentions' }]);
    expect(splitMentions('@ZZ stays text', TEAMS)).toEqual([{ text: '@ZZ stays text' }]);
    expect(splitMentions('@RC', TEAMS)).toEqual([{ mention: 'RC' }]);
  });
  it('detects and completes the @word being typed', () => {
    expect(activeMention('hello @R')).toBe('R');
    expect(activeMention('hello @')).toBe('');
    expect(activeMention('hello @RC and')).toBeNull();
    expect(activeMention('mail me@x')).toBeNull();
    expect(completeMention('hello @R', 'RC')).toBe('hello @RC ');
  });
});

describe('crop maths', () => {
  const base = { width: 300, height: 180, view: 200, zoom: 1, x: 0, y: 0 };
  it('at zoom 1 the shorter side fills the window', () => {
    expect(cropScale(base)).toBeCloseTo(200 / 180);
    const r = cropRect(base);
    expect(r.size).toBe(180);
    expect(r.originX).toBe(0);
  });
  it('dragging the image left reveals the right part of the photo, never past the edge', () => {
    expect(cropRect({ ...base, x: -100 }).originX).toBeGreaterThan(0);
    const far = cropRect({ ...base, x: -9999 });
    expect(far.originX + far.size).toBe(300);
    expect(cropRect({ ...base, x: 500 }).originX).toBe(0);          // can't drag past the left edge either
  });
  it('clamps so the image always covers the window', () => {
    const c = clampOffset({ ...base, x: 40, y: -300 });
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);                                             // zoom 1 fits the height exactly
  });
  it('zooming in shrinks the region', () => {
    expect(cropRect({ ...base, zoom: 2 }).size).toBe(90);
    expect(cropRect({ ...base, zoom: 4 }).size).toBe(45);
  });
  it('the region never leaves the picture', () => {
    for (const zoom of [1, 1.5, 3]) for (const x of [-1000, -50, 0, 50]) for (const y of [-1000, -20, 0, 30]) {
      const r = cropRect({ ...base, zoom, x, y });
      expect(r.originX).toBeGreaterThanOrEqual(0);
      expect(r.originY).toBeGreaterThanOrEqual(0);
      expect(r.originX + r.size).toBeLessThanOrEqual(300);
      expect(r.originY + r.size).toBeLessThanOrEqual(180);
    }
  });
  it('zooming keeps the centre of the window in place', () => {
    const start = { ...base, x: -60 };                               // looking at the middle-right
    const before = cropRect(start);
    const centre = before.originX + before.size / 2;
    const z = zoomAround(start, 2);
    const after = cropRect({ ...start, ...z });
    expect(after.originX + after.size / 2).toBeCloseTo(centre, -1);
    expect(after.size).toBeLessThan(before.size);
  });
  it('zoom is limited to 1–8', () => {
    expect(zoomAround(base, 0.2).zoom).toBe(1);
    expect(zoomAround(base, 50).zoom).toBe(8);
  });
  it('handles a portrait photo', () => {
    const r = cropRect({ width: 180, height: 300, view: 200, zoom: 1, x: 0, y: -100 });
    expect(r.size).toBe(180);
    expect(r.originY).toBeGreaterThan(0);
  });
});

import { MAX_GROUP, cleanGroupName, groupTitle, memberKey, validateGroup } from '../src';

describe('group conversations', () => {
  const all = ['AM', 'RC', 'MJ', 'KS', 'DB', 'WW', 'OZ', 'AD', 'MV'];
  it('needs 3 to 8 known, distinct teams including the creator', () => {
    expect(validateGroup('AM', ['RC', 'MJ'], all)).toEqual({ ok: true, members: ['AM', 'RC', 'MJ'] });
    expect(validateGroup('AM', ['RC', 'RC', 'AM', 'MJ'], all)).toEqual({ ok: true, members: ['AM', 'RC', 'MJ'] });
    expect(validateGroup('AM', ['RC'], all).ok).toBe(false);
    expect(validateGroup('AM', ['RC', 'NOPE'], all).ok).toBe(false);
    expect(validateGroup('AM', 'RC', all).ok).toBe(false);
    expect(validateGroup('AM', [1, 2], all).ok).toBe(false);
    expect(validateGroup('AM', all.slice(1, MAX_GROUP), all).ok).toBe(true);       // exactly MAX_GROUP with the creator
    expect(validateGroup('AM', all.slice(1, MAX_GROUP + 1), all).ok).toBe(false);  // one too many
  });
  it('memberKey ignores order and repeats', () => {
    expect(memberKey(['RC', 'AM', 'MJ'])).toBe(memberKey(['MJ', 'AM', 'RC', 'RC']));
    expect(memberKey(['RC', 'AM', 'MJ'])).not.toBe(memberKey(['RC', 'AM', 'KS']));
  });
  it('titles groups by name or by the other teams', () => {
    expect(groupTitle('Trade talk', ['A', 'B'])).toBe('Trade talk');
    expect(groupTitle('  ', ['Rally Cats', 'Heroes'])).toBe('Rally Cats, Heroes');
    expect(groupTitle(null, ['A', 'B', 'C', 'D'])).toBe('A, B +2');
  });
  it('cleans group names', () => {
    expect(cleanGroupName('  Trade   talk ')).toEqual({ ok: true, name: 'Trade talk' });
    expect(cleanGroupName('   ')).toEqual({ ok: true, name: null });
    expect(cleanGroupName(null)).toEqual({ ok: true, name: null });
    expect(cleanGroupName('x'.repeat(41)).ok).toBe(false);
    expect(cleanGroupName(5).ok).toBe(false);
  });
});

import { lastSentBy, seenBy, seenLabel } from '../src';
describe('read receipts', () => {
  it('finds the newest message a team sent', () => {
    const msgs = [{ id: 1, teamId: 'A' }, { id: 2, teamId: 'B' }, { id: 3, teamId: 'A' }, { id: 4, teamId: 'B' }];
    expect(lastSentBy(msgs, 'A')).toBe(3); expect(lastSentBy(msgs, 'C')).toBeNull(); expect(lastSentBy([], 'A')).toBeNull(); expect(lastSentBy(msgs, null)).toBeNull();
  });
  it('counts a reader as having seen everything up to their marker', () => {
    const r = [{ teamId: 'B', lastId: 5, at: 100 }, { teamId: 'C', lastId: 3, at: 200 }, { teamId: 'D', lastId: 0, at: null }];
    expect(seenBy(4, r, 3)).toEqual({ teams: ['B'], at: 100, all: false });
    expect(seenBy(3, r, 3).teams).toEqual(['B', 'C']);
    expect(seenBy(3, r, 3).at).toBe(200);
    expect(seenBy(9, r, 3).teams).toEqual([]);
    expect(seenBy(1, [{ teamId: 'B', lastId: 1, at: 5 }], 1).all).toBe(true);
    expect(seenBy(1, [], 0).all).toBe(false);
  });
  it('words the label', () => {
    const name = (t: string) => `Team ${t}`;
    expect(seenLabel({ teams: [], all: false }, name, true)).toBeNull();
    expect(seenLabel({ teams: ['B'], all: true }, name, false)).toBe('Seen');
    expect(seenLabel({ teams: ['B', 'C'], all: false }, name, true)).toBe('Seen by Team B, Team C');
    expect(seenLabel({ teams: ['B', 'C'], all: true }, name, true)).toBe('Seen by everyone');
  });
});
