/** The league's "today" is a US Eastern calendar date (MLB's day), not UTC. */
export const leagueToday = (now = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** ISO timestamp without fractional seconds, so string comparison against stored start times is exact. */
export const isoNow = (now = new Date()) => now.toISOString().slice(0, 19) + 'Z';
