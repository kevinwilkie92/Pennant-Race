// League settings rules: the league's name, the join code, and who may be commissioner. Pure functions.

export const MIN_LEAGUE_NAME = 2;
export const MAX_LEAGUE_NAME = 40;

export function cleanLeagueName(raw: unknown): { ok: true; name: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'The league needs a name' };
  const name = raw.replace(/\s+/g, ' ').trim();
  const len = [...name].length;
  if (len < MIN_LEAGUE_NAME) return { ok: false, reason: `The league name needs at least ${MIN_LEAGUE_NAME} characters` };
  if (len > MAX_LEAGUE_NAME) return { ok: false, reason: `The league name is limited to ${MAX_LEAGUE_NAME} characters` };
  return { ok: true, name };
}

// ---------------------------------------------------------------- join code

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';       // no 0/O, 1/I/L: easy to read out loud
/** A fresh code like `K7MQ-X2PD`. `bytes` must hold 8 random bytes. */
export function generateJoinCode(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error('Need 8 random bytes');
  const chars = Array.from(bytes.slice(0, 8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Codes compare ignoring case, spaces and hyphens, so "k7mq x2pd" matches "K7MQ-X2PD". */
export const normalizeJoinCode = (s: string) => s.toUpperCase().replace(/[\s-]+/g, '');

export function cleanJoinCode(raw: unknown): { ok: true; code: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'Enter a code' };
  const code = raw.trim();
  if (!/^[A-Za-z0-9 -]+$/.test(code)) return { ok: false, reason: 'Use only letters, numbers, spaces and hyphens' };
  const n = normalizeJoinCode(code).length;
  if (n < 6) return { ok: false, reason: 'The code needs at least 6 letters or numbers' };
  if (n > 32) return { ok: false, reason: 'The code is limited to 32 letters or numbers' };
  return { ok: true, code };
}

export const joinCodeMatches = (given: unknown, actual: string | undefined | null) =>
  typeof given === 'string' && !!actual && normalizeJoinCode(actual).length > 0 && normalizeJoinCode(given) === normalizeJoinCode(actual);

// ---------------------------------------------------------------- commissioners

export type CommissionerRow = { teamId: string; isCommissioner: boolean; hasAccount: boolean };

/**
 * May `teamId` be made (or stop being) a commissioner? A team must have a manager signed in before it can be
 * promoted (so no one inherits the role by registering later), and the league can never be left with none.
 */
export function checkCommissionerChange(rows: CommissionerRow[], teamId: string, make: boolean): { ok: true; changed: boolean } | { ok: false; reason: string } {
  const t = rows.find((r) => r.teamId === teamId);
  if (!t) return { ok: false, reason: 'Unknown team' };
  if (t.isCommissioner === make) return { ok: true, changed: false };
  if (make && !t.hasAccount) return { ok: false, reason: 'That team has no manager signed up yet' };
  // Someone with a login must always be left holding the role (a flagged team nobody has signed in as can't act).
  if (!make && !rows.some((r) => r.isCommissioner && r.hasAccount && r.teamId !== teamId)) return { ok: false, reason: 'The league needs at least one commissioner who is signed up. Make someone else a commissioner first.' };
  return { ok: true, changed: true };
}
