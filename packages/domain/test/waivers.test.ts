import { describe, it, expect } from 'vitest';
import { resolveWaivers, type Claim, type WaiverTeam } from '../src';

const team = (waiverPos: number, faab = 100, roster: number[] = []): WaiverTeam => ({ faab, roster: new Set(roster), waiverPos });
const claim = (id: number, teamId: string, addId: number, bid: number, priority = 1, dropId: number | null = null): Claim =>
  ({ id, teamId, addId, dropId, bid, priority });
const by = (r: ReturnType<typeof resolveWaivers>) => Object.fromEntries(r.outcomes.map((o) => [o.claimId, o]));
const list = (r: ReturnType<typeof resolveWaivers>) => r.outcomes;

describe('resolveWaivers', () => {
  it('the highest bid wins a contested player', () => {
    const o = by(resolveWaivers([claim(1, 'A', 10, 5), claim(2, 'B', 10, 20)], { A: team(1), B: team(2) }, new Set()));
    expect(o[2].won).toBe(true);
    expect(o[1]).toMatchObject({ won: false, reason: 'Player is no longer available' });
  });
  it('equal bids go to the team earlier in the waiver order', () => {
    const o = by(resolveWaivers([claim(1, 'A', 10, 7), claim(2, 'B', 10, 7)], { A: team(2), B: team(1) }, new Set()));
    expect(o[2].won).toBe(true);
    expect(o[1].won).toBe(false);
  });
  it('a winner moves to the back of the order, changing later ties', () => {
    // B wins player 10 and drops to the back, so on the $1 tie for player 20 A (now ahead) wins.
    const o = by(resolveWaivers(
      [claim(1, 'B', 10, 9), claim(2, 'A', 20, 1, 1), claim(3, 'B', 20, 1, 2)],
      { A: team(2), B: team(1) }, new Set(),
    ));
    expect(o[1].won).toBe(true);
    expect(o[2].won).toBe(true);
    expect(o[3].won).toBe(false);
  });
  it('rejects a claim that exceeds the team’s FAAB', () => {
    const o = list(resolveWaivers([claim(1, 'A', 10, 60)], { A: team(1, 50) }, new Set()));
    expect(o[0]).toMatchObject({ won: false, reason: 'Not enough FAAB' });
  });
  it('deducts FAAB, so a later claim can fail for lack of funds', () => {
    const o = by(resolveWaivers([claim(1, 'A', 10, 40, 1), claim(2, 'A', 20, 30, 2)], { A: team(1, 50) }, new Set()));
    expect(o[1].won).toBe(true);
    expect(o[2]).toMatchObject({ won: false, reason: 'Not enough FAAB' });
  });
  it('a failed claim falls through to the team’s next priority', () => {
    const o = by(resolveWaivers([claim(1, 'A', 10, 5, 1), claim(2, 'A', 20, 5, 2), claim(3, 'B', 10, 50)], { A: team(1), B: team(2) }, new Set()));
    expect(o[3].won).toBe(true);
    expect(o[1].won).toBe(false);
    expect(o[2].won).toBe(true);
  });
  it('processes one team’s claims in its own priority order', () => {
    const o = list(resolveWaivers([claim(1, 'A', 10, 1, 2), claim(2, 'A', 20, 99, 1)], { A: team(1, 100) }, new Set()));
    expect(o.map((x) => x.claimId)).toEqual([2, 1]);
  });
  it('refuses players already owned', () => {
    const o = list(resolveWaivers([claim(1, 'A', 10, 0)], { A: team(1) }, new Set([10])));
    expect(o[0].won).toBe(false);
  });
  it('requires a drop when the roster is full, and allows it with one', () => {
    const full = Array.from({ length: 26 }, (_, i) => 100 + i);
    const noDrop = list(resolveWaivers([claim(1, 'A', 10, 0)], { A: team(1, 100, full) }, new Set()));
    expect(noDrop[0]).toMatchObject({ won: false, reason: 'Roster full — choose a player to drop' });
    const withDrop = list(resolveWaivers([claim(1, 'A', 10, 0, 1, 100)], { A: team(1, 100, full) }, new Set(full)));
    expect(withDrop[0].won).toBe(true);
  });
  it('rejects a drop that is no longer on the roster', () => {
    const o = list(resolveWaivers([claim(1, 'A', 10, 0, 1, 999)], { A: team(1, 100, [1]) }, new Set()));
    expect(o[0].won).toBe(false);
  });
  it('a player dropped in this run cannot be claimed in the same run', () => {
    // A drops 50 and claims 10; B tries to claim 50 right after.
    const o = by(resolveWaivers([claim(1, 'A', 10, 9, 1, 50), claim(2, 'B', 50, 1)], { A: team(1, 100, [50]), B: team(2) }, new Set([50])));
    expect(o[1].won).toBe(true);
    expect(o[2].won).toBe(false);
  });
  it('cannot drop a player who was added earlier in the same run', () => {
    const o = by(resolveWaivers([claim(1, 'A', 10, 5, 1), claim(2, 'A', 20, 5, 2, 10)], { A: team(1, 100, [1]) }, new Set()));
    expect(o[1].won).toBe(true);
    expect(o[2]).toMatchObject({ won: false, reason: 'You can’t drop a player you just added' });
  });
  it('returns the new rolling order', () => {
    const r = resolveWaivers([claim(1, 'B', 10, 5)], { A: team(1), B: team(2), C: team(3) }, new Set());
    expect(r.waiverPos).toEqual({ A: 1, B: 3, C: 2 });
  });
  it('does not mutate the caller’s state', () => {
    const teams = { A: team(1, 100, [1]) };
    resolveWaivers([claim(1, 'A', 10, 30, 1, 1)], teams, new Set([1]));
    expect(teams.A.faab).toBe(100);
    expect([...teams.A.roster]).toEqual([1]);
  });
  it('zero-dollar claims are allowed', () => {
    expect(list(resolveWaivers([claim(1, 'A', 10, 0)], { A: team(1) }, new Set()))[0].won).toBe(true);
  });
});
