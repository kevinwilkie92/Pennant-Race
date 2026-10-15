import { describe, expect, it } from 'vitest';
import { IdTokenError, emailVerified, verifyIdToken, type Jwk } from '../src/oidc';

const b64u = (b: ArrayBuffer | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as Jwk;
  return { priv: kp.privateKey, jwk };
}
async function sign(priv: CryptoKey, claims: object, header: object = { alg: 'RS256', kid: 'k1' }) {
  const body = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(body));
  return `${body}.${b64u(sig)}`;
}
const NOW = 1_800_000_000;
const good = { iss: 'https://accounts.google.com', aud: 'app-1', sub: '123', exp: NOW + 600, email: 'a@b.com', email_verified: true };
const opts = (keys: Jwk[]) => ({ keys, issuers: ['https://accounts.google.com', 'accounts.google.com'], audiences: ['app-1', 'app-2'], now: NOW });
const rejects = async (p: Promise<unknown>, re: RegExp) => { await expect(p).rejects.toThrow(re); await expect(p).rejects.toBeInstanceOf(IdTokenError); };

describe('verifyIdToken', () => {
  it('accepts a valid token', async () => {
    const { priv, jwk } = await keypair();
    const c = await verifyIdToken(await sign(priv, good), opts([{ ...jwk, kid: 'k1' }]));
    expect(c.sub).toBe('123'); expect(c.email).toBe('a@b.com');
  });
  it('accepts an array audience and either Google issuer spelling', async () => {
    const { priv, jwk } = await keypair();
    const t = await sign(priv, { ...good, iss: 'accounts.google.com', aud: ['x', 'app-2'] });
    expect((await verifyIdToken(t, opts([{ ...jwk, kid: 'k1' }]))).sub).toBe('123');
  });
  it('rejects a tampered payload', async () => {
    const { priv, jwk } = await keypair();
    const [h, , s] = (await sign(priv, good)).split('.');
    const forged = `${h}.${b64u(JSON.stringify({ ...good, email: 'evil@b.com' }))}.${s}`;
    await rejects(verifyIdToken(forged, opts([{ ...jwk, kid: 'k1' }])), /signature/);
  });
  it('rejects a token signed by another key', async () => {
    const a = await keypair(), b = await keypair();
    await rejects(verifyIdToken(await sign(a.priv, good), opts([{ ...b.jwk, kid: 'k1' }])), /signature/);
  });
  it('rejects the wrong audience, issuer, and expired tokens', async () => {
    const { priv, jwk } = await keypair(); const keys = [{ ...jwk, kid: 'k1' }];
    await rejects(verifyIdToken(await sign(priv, { ...good, aud: 'other' }), opts(keys)), /different app/);
    await rejects(verifyIdToken(await sign(priv, { ...good, iss: 'https://evil.example' }), opts(keys)), /issuer/);
    await rejects(verifyIdToken(await sign(priv, { ...good, exp: NOW - 3600 }), opts(keys)), /expired/);
  });
  it('rejects alg none / HS256 and unknown keys and junk', async () => {
    const { priv, jwk } = await keypair(); const keys = [{ ...jwk, kid: 'k1' }];
    await rejects(verifyIdToken(`${b64u(JSON.stringify({ alg: 'none' }))}.${b64u(JSON.stringify(good))}.`, opts(keys)), /algorithm/);
    await rejects(verifyIdToken(await sign(priv, good, { alg: 'HS256', kid: 'k1' }), opts(keys)), /algorithm/);
    await rejects(verifyIdToken(await sign(priv, good, { alg: 'RS256', kid: 'nope' }), opts(keys)), /key/);
    await rejects(verifyIdToken('not.a.jwt', opts(keys)), /Malformed/);
    await rejects(verifyIdToken('', opts(keys)), /Malformed/);
  });
  it('rejects a token with no audiences configured', async () => {
    const { priv, jwk } = await keypair();
    await rejects(verifyIdToken(await sign(priv, good), { ...opts([{ ...jwk, kid: 'k1' }]), audiences: [] }), /different app/);
  });
  it('reads email_verified as a boolean or string', () => {
    expect(emailVerified({ ...good, email_verified: 'true' })).toBe(true);
    expect(emailVerified({ ...good, email_verified: 'false' })).toBe(false);
    expect(emailVerified({ ...good, email_verified: undefined })).toBe(false);
  });
});
