import type { Context, Next } from 'hono';
import type { AppVars, AuthUser, Env } from './types';

const enc = new TextEncoder();
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 100_000; // Workers' WebCrypto cap

const hex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b instanceof Uint8Array ? b.buffer : b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return hex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${hex(salt)}:${await pbkdf2(password, salt)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hash] = stored.split(':');
  if (!saltHex || !hash) return false;
  const got = await pbkdf2(password, unhex(saltHex));
  // constant-time compare
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** Creates a session and returns the opaque bearer token (only its hash is stored). */
export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('INSERT INTO session (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, Date.now() + SESSION_MS).run();
  return token;
}

export async function destroySession(db: D1Database, token: string) {
  await db.prepare('DELETE FROM session WHERE token_hash = ?').bind(await sha256(token)).run();
}

export function bearer(c: Context): string | null {
  const h = c.req.header('Authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export async function userForToken(db: D1Database, token: string): Promise<AuthUser | null> {
  const row = await db.prepare(
    `SELECT u.id, u.email, u.team_id AS teamId, COALESCE(t.is_commissioner, 0) AS isCommissioner
       FROM session s JOIN user u ON u.id = s.user_id LEFT JOIN team t ON t.id = u.team_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), Date.now()).first<{ id: string; email: string; teamId: string | null; isCommissioner: number }>();
  return row ? { ...row, isCommissioner: !!row.isCommissioner } : null;
}

export async function requireAuth(c: Context<{ Bindings: Env; Variables: AppVars }>, next: Next) {
  const token = bearer(c);
  const user = token ? await userForToken(c.env.DB, token) : null;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  c.set('user', user);
  await next();
}

export async function requireCommissioner(c: Context<{ Bindings: Env; Variables: AppVars }>, next: Next) {
  if (!c.get('user').isCommissioner) return c.json({ error: 'Commissioner only' }, 403);
  await next();
}
