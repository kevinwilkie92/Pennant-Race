// End-to-end check of Google / Apple sign-in. Signs test ID tokens with a throwaway key and serves the matching
// public key from a local JWKS endpoint (run-e2e.sh points GOOGLE_JWKS_URL / APPLE_JWKS_URL at port 8799).
// Run against a FRESH local API started with the vars in run-e2e.sh, then:  node api/scripts/social-e2e.mjs
import http from 'node:http';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';
const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const call = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const server = http.createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); }).listen(8799);

const b64u = (x) => Buffer.from(x).toString('base64url');
const token = (claims, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) => {
  const body = `${b64u(JSON.stringify({ alg, kid }))}.${b64u(JSON.stringify(claims))}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
};
const exp = () => Math.floor(Date.now() / 1000) + 600;
const google = (o = {}) => ({ iss: 'https://accounts.google.com', aud: 'test-google-web', sub: 'g-1', exp: exp(), email: 'new@x.com', email_verified: true, nonce: 'nonce-12345', ...o });
const apple = (o = {}) => ({ iss: 'https://appleid.apple.com', aud: 'test.apple.service', sub: 'a-1', exp: exp(), email: 'abc@privaterelay.appleid.com', email_verified: 'true', nonce: 'nonce-12345', ...o });
const social = (provider, idToken, extra = {}) => call('POST', '/auth/social', { provider, idToken, nonce: 'nonce-12345', ...extra });

try {
  const pr = (await call('GET', '/auth/providers')).j;
  ok(pr.google?.clientId === 'test-google-web' && pr.apple?.clientId === 'test.apple.service', 'providers endpoint lists the configured client IDs');

  ok((await call('POST', '/auth/social', { provider: 'github', idToken: 'x', nonce: 'nonce-12345' })).s === 400, 'unknown provider rejected');
  ok((await call('POST', '/auth/social', { provider: 'google', idToken: 'x' })).s === 400, 'a nonce is required');
  ok((await social('google', 'junk.token.here')).s === 401, 'garbage token rejected');
  ok((await social('google', token(google(), { key: other.privateKey }))).s === 401, 'token signed by the wrong key rejected');
  ok((await social('google', token(google({ aud: 'someone-elses-app' })))).s === 401, 'token for another app rejected');
  ok((await social('google', token(google({ iss: 'https://evil.example' })))).s === 401, 'wrong issuer rejected');
  ok((await social('google', token(google({ exp: Math.floor(Date.now() / 1000) - 3600 })))).s === 401, 'expired token rejected');
  ok((await social('google', token(google({ nonce: 'different-nonce-1' })))).s === 401, 'nonce mismatch rejected');
  ok((await social('google', token(google(), { alg: 'none' }))).s === 401, 'alg=none rejected');
  ok((await social('apple', token(google()))).s === 401, "a Google token can't be used as an Apple sign-in");

  // brand-new manager
  const need = await social('google', token(google()));
  ok(need.s === 409 && need.j.needsSignup === true && need.j.email === 'new@x.com', 'unknown account is asked for the join code and team');
  ok((await social('google', token(google()), { joinCode: 'wrong', teamId: 'RC' })).s === 403, 'wrong join code rejected');
  ok((await social('google', token(google()), { joinCode: 'testcode', teamId: 'NOPE' })).s === 400, 'unknown team rejected');
  const made = await social('google', token(google()), { joinCode: 'testcode', teamId: 'RC' });
  ok(made.s === 201 && made.j.token, 'new manager created with join code + team');
  const me = (await call('GET', '/me', null, made.j.token)).j;
  ok(me.user?.teamId === 'RC' && me.user?.email === 'new@x.com', 'signed in as RC with the Google email');
  ok((await social('google', token(google()), { joinCode: 'testcode', teamId: 'MJ' })).s === 200, 'the same Google account signs straight back in (no join code needed)');
  ok((await call('POST', '/auth/login', { email: 'new@x.com', password: '!' })).s === 401 && (await call('POST', '/auth/login', { email: 'new@x.com', password: '' })).s === 401, 'a social-only account has no usable password');
  ok((await social('google', token(google({ sub: 'g-2', email: 'other@x.com' })), { joinCode: 'testcode', teamId: 'RC' })).s === 409, 'a team can only have one owner account');

  // existing email/password account gets the provider linked by verified email
  const K = await reg('k@x.com', 'AM');
  const link = await social('google', token(google({ sub: 'g-k', email: 'K@x.com' })));
  ok(link.s === 200 && (await call('GET', '/me', null, link.j.token)).j.user?.teamId === 'AM', 'verified email links Google to the existing account');
  const again = await social('google', token(google({ sub: 'g-k', email: 'someone-else@x.com' })));
  ok(again.s === 200 && (await call('GET', '/me', null, again.j.token)).j.user?.teamId === 'AM', 'once linked, the provider id decides (not the email)');
  const unverified = await social('google', token(google({ sub: 'g-evil', email: 'k@x.com', email_verified: false })));
  ok(unverified.s === 409 && unverified.j.needsSignup, 'an UNVERIFIED email never links to an existing account');

  // Apple: relay email, nonce sent as its SHA-256 (what the native iOS API produces)
  const raw = 'raw-nonce-abcdef';
  const hashed = createHash('sha256').update(raw).digest('hex');
  const ap = await call('POST', '/auth/social', { provider: 'apple', idToken: token(apple({ nonce: hashed })), nonce: raw, joinCode: 'testcode', teamId: 'MJ' });
  ok(ap.s === 201, 'Apple sign-up works with a hashed nonce');
  ok((await call('GET', '/me', null, ap.j.token)).j.user?.teamId === 'MJ', 'Apple account owns MJ');
  const noEmail = await call('POST', '/auth/social', { provider: 'apple', idToken: token(apple({ sub: 'a-2', email: undefined, email_verified: undefined })), nonce: 'nonce-12345', joinCode: 'testcode', teamId: 'DB' });
  ok(noEmail.s === 201, 'Apple sign-up without an email address works');
  ok((await social('apple', token(apple({ sub: 'a-2', email: undefined })))).s === 200, '… and signs back in');
} finally { server.close(); }

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
