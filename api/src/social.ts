import type { Hono } from 'hono';
import { IdTokenError, emailVerified, verifyIdToken, type IdClaims, type Jwk } from '@pennant/domain';
import { createSession } from './auth';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;
type Provider = 'google' | 'apple';

const PROVIDERS: Record<Provider, { issuers: string[]; jwks: string }> = {
  google: { issuers: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { issuers: ['https://appleid.apple.com'], jwks: 'https://appleid.apple.com/auth/keys' },
};

const ids = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const clientIds = (env: Env, p: Provider) => ids(p === 'google' ? env.GOOGLE_CLIENT_IDS : env.APPLE_CLIENT_IDS);
const jwksUrl = (env: Env, p: Provider) => (p === 'google' ? env.GOOGLE_JWKS_URL : env.APPLE_JWKS_URL) || PROVIDERS[p].jwks;

// Signing keys change rarely; keep them for an hour and refetch once if a token names a key we don't have.
const keyCache = new Map<string, { at: number; keys: Jwk[] }>();
async function signingKeys(url: string, force: boolean): Promise<Jwk[]> {
  const hit = keyCache.get(url);
  if (hit && !force && Date.now() - hit.at < 3_600_000) return hit.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not fetch signing keys (${r.status})`);
  const keys = ((await r.json()) as { keys: Jwk[] }).keys;
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

async function claimsFor(env: Env, provider: Provider, idToken: string): Promise<IdClaims> {
  const opts = { issuers: PROVIDERS[provider].issuers, audiences: clientIds(env, provider) };
  const url = jwksUrl(env, provider);
  try {
    return await verifyIdToken(idToken, { ...opts, keys: await signingKeys(url, false) });
  } catch (e) {
    if (e instanceof IdTokenError && /signing key/.test(e.message)) return verifyIdToken(idToken, { ...opts, keys: await signingKeys(url, true) });
    throw e;
  }
}

/** Sign in with Google / Apple. The app obtains an ID token from the provider; we verify it and map it to a league account. */
export function registerSocial(app: App) {
  // Which buttons to show, and the public client IDs the app needs to start each flow.
  app.get('/auth/providers', (c) => c.json({
    google: clientIds(c.env, 'google')[0] ? { clientId: clientIds(c.env, 'google')[0] } : null,
    apple: clientIds(c.env, 'apple')[0] ? { clientId: clientIds(c.env, 'apple')[0] } : null,
  }));

  app.post('/auth/social', async (c) => {
    const b = await c.req.json<{ provider?: string; idToken?: string; nonce?: string; joinCode?: string; teamId?: string }>().catch(() => ({} as Record<string, string>));
    const provider = b.provider as Provider;
    if (provider !== 'google' && provider !== 'apple') return c.json({ error: 'Unknown provider' }, 400);
    if (!clientIds(c.env, provider).length) return c.json({ error: `Sign in with ${provider === 'google' ? 'Google' : 'Apple'} is not set up` }, 501);
    if (!b.idToken || !b.nonce || b.nonce.length < 8) return c.json({ error: 'Missing sign-in details' }, 400);

    let claims: IdClaims;
    try { claims = await claimsFor(c.env, provider, b.idToken); }
    catch (e) { return c.json({ error: e instanceof IdTokenError ? `Sign-in rejected: ${e.message}` : 'Could not check the sign-in with the provider' }, e instanceof IdTokenError ? 401 : 502); }
    // Proves this token was minted for this sign-in attempt (the app hands the provider the raw nonce or its SHA-256).
    if (claims.nonce !== b.nonce && claims.nonce !== (await sha256(b.nonce))) return c.json({ error: 'Sign-in rejected: nonce mismatch' }, 401);

    const db = c.env.DB;
    const linked = await db.prepare('SELECT user_id AS id FROM identity WHERE provider = ? AND subject = ?').bind(provider, claims.sub).first<{ id: string }>();
    if (linked) return c.json({ token: await createSession(db, linked.id) });

    // First time with this provider account: attach it to an existing account that owns the same verified email…
    const email = claims.email && emailVerified(claims) ? claims.email.trim().toLowerCase() : null;
    const existing = email ? await db.prepare('SELECT id FROM user WHERE email = ?').bind(email).first<{ id: string }>() : null;
    if (existing) {
      await db.prepare('INSERT INTO identity (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').bind(provider, claims.sub, existing.id, Date.now()).run();
      return c.json({ token: await createSession(db, existing.id) });
    }

    // …otherwise this is a new manager: same gate as email sign-up (league join code + an unclaimed team).
    if (!b.joinCode || !b.teamId) return c.json({ error: 'New here: enter the league join code and pick your team', needsSignup: true, email }, 409);
    if (!c.env.JOIN_CODE || b.joinCode !== c.env.JOIN_CODE) return c.json({ error: 'Invalid league join code' }, 403);
    if (!(await db.prepare('SELECT id FROM team WHERE id = ?').bind(b.teamId).first())) return c.json({ error: 'Unknown team' }, 400);
    if (await db.prepare('SELECT 1 FROM user WHERE team_id = ?').bind(b.teamId).first()) return c.json({ error: 'That team already has an owner account' }, 409);

    const id = crypto.randomUUID();
    // Providers can hide the address (Apple relay) or omit it; the placeholder keeps the UNIQUE column satisfied.
    const login = email ?? `${provider}-${claims.sub}@social.invalid`;
    try {
      await db.batch([
        db.prepare("INSERT INTO user (id, email, password_hash, team_id, created_at) VALUES (?, ?, '!', ?, ?)").bind(id, login, b.teamId, Date.now()),
        db.prepare('INSERT INTO identity (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').bind(provider, claims.sub, id, Date.now()),
      ]);
    } catch { return c.json({ error: 'That account is already registered' }, 409); }
    return c.json({ token: await createSession(db, id) }, 201);
  });
}
