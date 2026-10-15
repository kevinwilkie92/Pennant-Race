import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode, encryptPayload, generateVapid, validEndpoint, vapidAuthorization } from '../src';

const te = new TextEncoder(), td = new TextDecoder();
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let a = 0; for (const x of p) { o.set(x, a); a += x.length; } return o; };

/** An independent reader following RFC 8291 section 3.4 (what a browser does), to check our encryption. */
async function decrypt(body: Uint8Array, receiver: CryptoKeyPair, receiverPub: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
  const asPub = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  expect(rs).toBe(4096); expect(idlen).toBe(65);
  const hk = async (ikm: Uint8Array, s: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s as BufferSource, info: info as BufferSource }, await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']), n * 8));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, receiver.privateKey, 256));
  const ikm = await hk(secret, auth, cat(te.encode('WebPush: info\0'), receiverPub, asPub), 32);
  const cek = await hk(ikm, salt, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(ikm, salt, te.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  expect(plain[plain.length - 1]).toBe(2);                    // last-record delimiter
  return plain.slice(0, -1);
}

async function subscription() {
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { receiver, pub, auth, keys: { p256dh: b64uEncode(pub), auth: b64uEncode(auth) } };
}

describe('web push encryption (RFC 8291)', () => {
  it('round-trips a payload through an independent reader', async () => {
    const s = await subscription();
    const msg = JSON.stringify({ title: 'Rally Cats', body: 'who wants to talk trades? 🔥' });
    const body = await encryptPayload(s.keys, te.encode(msg));
    expect(td.decode(await decrypt(body, s.receiver, s.pub, s.auth))).toBe(msg);
  });
  it('uses a fresh key and salt every time (no repeated ciphertext)', async () => {
    const s = await subscription();
    const a = await encryptPayload(s.keys, te.encode('same')), b = await encryptPayload(s.keys, te.encode('same'));
    expect(b64uEncode(a)).not.toBe(b64uEncode(b));
  });
  it('cannot be read with the wrong auth secret or by another subscriber', async () => {
    const s = await subscription(), other = await subscription();
    const body = await encryptPayload(s.keys, te.encode('private'));
    await expect(decrypt(body, s.receiver, s.pub, other.auth)).rejects.toBeDefined();
    await expect(decrypt(body, other.receiver, other.pub, s.auth)).rejects.toBeDefined();
  });
  it('rejects malformed keys and oversized payloads', async () => {
    const s = await subscription();
    await expect(encryptPayload({ p256dh: 'AAAA', auth: s.keys.auth }, te.encode('x'))).rejects.toThrow();
    await expect(encryptPayload({ p256dh: s.keys.p256dh, auth: 'AAAA' }, te.encode('x'))).rejects.toThrow();
    await expect(encryptPayload(s.keys, new Uint8Array(4000))).rejects.toThrow(/too large/);
  });
  it('handles an empty-ish and a near-limit payload', async () => {
    const s = await subscription();
    expect((await decrypt(await encryptPayload(s.keys, new Uint8Array(0)), s.receiver, s.pub, s.auth)).length).toBe(0);
    expect((await decrypt(await encryptPayload(s.keys, new Uint8Array(3800).fill(65)), s.receiver, s.pub, s.auth)).length).toBe(3800);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a token a push service can verify, bound to its origin', async () => {
    const v = await generateVapid('mailto:commish@example.org');
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', v, 1_800_000_000);
    const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/)!;
    expect(m[4]).toBe(v.publicKey);
    const pub = b64uDecode(v.publicKey);
    const key = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uDecode(m[3]), te.encode(`${m[1]}.${m[2]}`))).toBe(true);
    expect(JSON.parse(td.decode(b64uDecode(m[1])))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(td.decode(b64uDecode(m[2])));
    expect(claims.aud).toBe('https://fcm.googleapis.com');          // origin only, not the path
    expect(claims.sub).toBe('mailto:commish@example.org');
    expect(claims.exp).toBe(1_800_000_000 + 12 * 3600);             // under the 24-hour cap
  });
  it('a tampered token fails verification', async () => {
    const v = await generateVapid('mailto:a@b.co');
    const m = (await vapidAuthorization('https://push.example/x', v)).match(/t=([\w-]+)\.([\w-]+)\.([\w-]+),/)!;
    const key = await crypto.subtle.importKey('raw', b64uDecode(v.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const forged = b64uEncode(te.encode(JSON.stringify({ aud: 'https://evil.example', exp: 9e9, sub: 'mailto:a@b.co' })));
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uDecode(m[3]), te.encode(`${m[1]}.${forged}`))).toBe(false);
  });
  it('refuses a malformed public key', async () => {
    await expect(vapidAuthorization('https://x.example', { publicKey: 'AAAA', privateKey: 'AAAA', subject: 'mailto:a@b.co' })).rejects.toThrow();
  });
});

describe('endpoint validation', () => {
  it('accepts https push services and refuses everything that could aim us inward', () => {
    expect(validEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/x', 'ftp://x.com', 'javascript:alert(1)', 'not a url', '', 5, null, 'https://x.com/' + 'a'.repeat(1000)]) expect(validEndpoint(bad)).toBe(false);
    expect(validEndpoint('http://localhost:8791/x', true)).toBe(true);
    expect(validEndpoint('http://evil.example/x', true)).toBe(false);           // the test allowance covers localhost only
    expect(validEndpoint('https://172.20.0.1/x')).toBe(false);
  });
});
