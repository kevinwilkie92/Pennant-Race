// Verifies an OpenID Connect ID token (RS256) issued by Google or Apple. Pure WebCrypto, so it runs in
// Workers, Node and the test runner alike. The caller supplies the provider's public keys (JWKS).

export type Jwk = JsonWebKey & { kid?: string };
export type IdClaims = {
  iss: string; aud: string | string[]; sub: string; exp: number; iat?: number;
  email?: string; email_verified?: boolean | 'true' | 'false'; nonce?: string; is_private_email?: boolean | 'true' | 'false';
  name?: string;
};
export type VerifyOptions = {
  keys: Jwk[]; issuers: string[]; audiences: string[]; now?: number; /** seconds of allowed clock skew */ skew?: number;
};

const dec = new TextDecoder();
const b64u = (s: string): Uint8Array<ArrayBuffer> => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(p);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
};
const json = (s: string) => JSON.parse(dec.decode(b64u(s)));

export class IdTokenError extends Error {}

/** Returns the token's claims if the signature, issuer, audience and expiry all check out; throws IdTokenError otherwise. */
export async function verifyIdToken(token: string, o: VerifyOptions): Promise<IdClaims> {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new IdTokenError('Malformed token');
  let header: { alg?: string; kid?: string }, claims: IdClaims;
  try { header = json(parts[0]); claims = json(parts[1]); } catch { throw new IdTokenError('Malformed token'); }
  if (header.alg !== 'RS256') throw new IdTokenError('Unsupported signing algorithm');   // never accept "none" or HMAC

  const jwk = o.keys.find((k) => k.kid === header.kid && (k.kty === 'RSA'));
  if (!jwk) throw new IdTokenError('Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new IdTokenError('Bad signature');

  if (!o.issuers.includes(claims.iss)) throw new IdTokenError('Wrong issuer');
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.some((a) => o.audiences.includes(a))) throw new IdTokenError('Token was issued for a different app');
  const now = o.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + (o.skew ?? 60) < now) throw new IdTokenError('Token expired');
  if (!claims.sub) throw new IdTokenError('Token has no subject');
  return claims;
}

export const emailVerified = (c: IdClaims) => c.email_verified === true || c.email_verified === 'true';
