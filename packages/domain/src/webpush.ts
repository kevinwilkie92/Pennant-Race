// Web Push for Workers/Node (WebCrypto only): RFC 8291 payload encryption (aes128gcm, RFC 8188) and RFC 8292 VAPID auth.

const enc = new TextEncoder();
// Workers and DOM type declarations disagree about a few WebCrypto signatures (ECDH's `public`, generateKey's result);
// the runtime behaviour is identical, so this file talks to a loosely typed handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subtle: any = crypto.subtle;
type Bytes = Uint8Array<ArrayBuffer>;

export const b64uEncode = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const b64uDecode = (s: string): Bytes => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)) as Bytes;
};
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out as Bytes;
};

/** HKDF-SHA256 extract-and-expand. */
async function hkdf(ikm: BufferSource, salt: BufferSource, info: BufferSource, bytes: number): Promise<Bytes> {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8)) as Bytes;
}

export type PushKeys = { p256dh: string; auth: string };
export const MAX_PAYLOAD = 3800;
const RECORD_SIZE = 4096;

/**
 * Encrypts a payload for one subscription. Returns the full request body (RFC 8188 header + a single record),
 * to be POSTed with `Content-Encoding: aes128gcm`.
 */
export async function encryptPayload(keys: PushKeys, payload: Uint8Array, opts: { salt?: Uint8Array; senderKey?: CryptoKeyPair } = {}): Promise<Bytes> {
  if (payload.length > MAX_PAYLOAD) throw new Error('Push payload too large');
  const uaPublic = b64uDecode(keys.p256dh), authSecret = b64uDecode(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Bad subscription key');
  if (authSecret.length !== 16) throw new Error('Bad subscription auth secret');

  const sender: CryptoKeyPair = opts.senderKey ?? (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await subtle.exportKey('raw', sender.publicKey)) as Bytes;
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256)) as Bytes;

  const ikm = await hkdf(shared, authSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = (opts.salt ?? crypto.getRandomValues(new Uint8Array(16))) as Bytes;
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then the 0x02 "last record" delimiter.
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2])))) as Bytes;

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

export type Vapid = { publicKey: string; privateKey: string; subject: string };   // base64url: 65-byte public key, 32-byte private scalar

async function vapidSigningKey(v: Vapid): Promise<CryptoKey> {
  const pub = b64uDecode(v.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point');
  return subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: v.privateKey, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** The Authorization header for a push service: a short-lived ES256 token naming the service's origin, plus our public key. */
export async function vapidAuthorization(endpoint: string, v: Vapid, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud, exp: nowSeconds + 12 * 3600, sub: v.subject })));
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidSigningKey(v), enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64uEncode(sig)}, k=${v.publicKey}`;
}

/** Makes a fresh VAPID key pair (run once; keep the private part secret). */
export async function generateVapid(subject: string): Promise<Vapid> {
  const kp: CryptoKeyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const jwk: JsonWebKey = await subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64uEncode(pub), privateKey: jwk.d!, subject };
}

/** Only https push-service endpoints are accepted (stops a client aiming our server at an internal address). */
export function validEndpoint(endpoint: unknown, allowLocal = false): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    if (allowLocal && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return u.protocol === 'http:' || u.protocol === 'https:';   // tests only
    return u.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(u.hostname);
  } catch { return false; }
}
