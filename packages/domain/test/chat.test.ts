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
