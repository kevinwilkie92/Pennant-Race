import { describe, expect, it } from 'vitest';
import { checkCommissionerChange, cleanJoinCode, cleanLeagueName, generateJoinCode, joinCodeMatches, normalizeJoinCode } from '../src';

describe('league name', () => {
  it('tidies and bounds the name', () => {
    expect(cleanLeagueName('  Carrollton   All Stars ')).toEqual({ ok: true, name: 'Carrollton All Stars' });
    expect(cleanLeagueName('A').ok).toBe(false); expect(cleanLeagueName('   ').ok).toBe(false); expect(cleanLeagueName(5).ok).toBe(false);
    expect(cleanLeagueName('x'.repeat(41)).ok).toBe(false); expect(cleanLeagueName('x'.repeat(40)).ok).toBe(true);
  });
});

describe('join code', () => {
  it('generates readable codes from the safe alphabet', () => {
    const c = generateJoinCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 255]));
    expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    for (let i = 0; i < 50; i++) expect(generateJoinCode(crypto.getRandomValues(new Uint8Array(8)))).not.toMatch(/[01OIL]/);
    expect(() => generateJoinCode(new Uint8Array(3))).toThrow();
  });
  it('compares ignoring case, spaces and hyphens', () => {
    expect(normalizeJoinCode('k7mq x2-pd')).toBe('K7MQX2PD');
    expect(joinCodeMatches('k7mq-x2pd', 'K7MQ-X2PD')).toBe(true);
    expect(joinCodeMatches('K7MQX2PE', 'K7MQ-X2PD')).toBe(false);
    expect(joinCodeMatches('', '')).toBe(false); expect(joinCodeMatches('x', undefined)).toBe(false); expect(joinCodeMatches(5, 'abc123')).toBe(false); expect(joinCodeMatches('---', '---')).toBe(false);
  });
  it('validates a custom code', () => {
    expect(cleanJoinCode('  Spring 2027 ')).toEqual({ ok: true, code: 'Spring 2027' });
    expect(cleanJoinCode('abc').ok).toBe(false); expect(cleanJoinCode('a b c d e').ok).toBe(false);
    expect(cleanJoinCode('bad!code1').ok).toBe(false); expect(cleanJoinCode('x'.repeat(33)).ok).toBe(false); expect(cleanJoinCode(null).ok).toBe(false);
  });
});

describe('commissioner changes', () => {
  const rows = [
    { teamId: 'AM', isCommissioner: true, hasAccount: true }, { teamId: 'RC', isCommissioner: false, hasAccount: true },
    { teamId: 'MJ', isCommissioner: false, hasAccount: false },
  ];
  it('promotes a team that has a manager', () => expect(checkCommissionerChange(rows, 'RC', true)).toEqual({ ok: true, changed: true }));
  it('will not promote a team with nobody signed up', () => expect(checkCommissionerChange(rows, 'MJ', true).ok).toBe(false));
  it('will not demote the last commissioner', () => expect(checkCommissionerChange(rows, 'AM', false).ok).toBe(false));
  it('can demote one of several', () => {
    const two = rows.map((r) => (r.teamId === 'RC' ? { ...r, isCommissioner: true } : r));
    expect(checkCommissionerChange(two, 'AM', false)).toEqual({ ok: true, changed: true });
  });
  it('counts only commissioners who have signed up', () => {
    const ghost = [{ teamId: 'AM', isCommissioner: true, hasAccount: true }, { teamId: 'ZZ', isCommissioner: true, hasAccount: false }, { teamId: 'RC', isCommissioner: false, hasAccount: true }];
    expect(checkCommissionerChange(ghost, 'AM', false).ok).toBe(false);          // ZZ is flagged but nobody can act as ZZ
  });
  it('is a no-op when nothing changes, and rejects unknown teams', () => {
    expect(checkCommissionerChange(rows, 'AM', true)).toEqual({ ok: true, changed: false });
    expect(checkCommissionerChange(rows, 'RC', false)).toEqual({ ok: true, changed: false });
    expect(checkCommissionerChange(rows, 'ZZ', true).ok).toBe(false);
  });
});
