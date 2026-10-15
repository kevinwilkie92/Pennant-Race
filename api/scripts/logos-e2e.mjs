// End-to-end check of team logos and team names: upload validation, serving headers, replace/remove, permissions, rename.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/logos-e2e.mjs
import { deflateSync } from 'node:zlib';

const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const json = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await json('GET', p, null, t)).j;
const reg = async (email, teamId) => (await json('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const upload = (team, bytes, tok, type = 'image/png') => fetch(`${B}/teams/${team}/logo`, { method: 'PUT', headers: { 'content-type': type, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: bytes });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A real PNG, built by hand: size x size, solid colour.
function png(size, [r, g, b]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC'), M = await reg('m@x.com', 'MJ');
const events = [];
const ws = new WebSocket(`ws://localhost:8787/draft/ws?token=${M}`);
ws.onmessage = (m) => events.push(JSON.parse(m.data));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const sawTeam = async (id, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (events.some((e) => e.type === 'team' && e.id === id)) return true; await sleep(50); } return false; };

// --- upload validation
const good = png(32, [200, 30, 40]);
ok((await upload('RC', good, null)).status === 401, 'uploading needs a sign-in');
ok((await upload('AM', good, C)).status === 403, 'an owner can’t change another team’s logo');
ok((await upload('ZZ', good, K)).status === 404, 'unknown team is a 404');
ok((await upload('RC', new Uint8Array(0), C)).status === 400, 'an empty upload is rejected');
const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
ok((await upload('RC', html, C, 'image/png')).status === 415, 'HTML sent as image/png is rejected (the bytes are checked, not the label)');
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
ok((await upload('RC', svg, C, 'image/svg+xml')).status === 415, 'SVG is not accepted');
ok((await upload('RC', new TextEncoder().encode('GIF89a....'), C, 'image/gif')).status === 415, 'GIF is not accepted');
const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(good.slice(0, 8));
ok((await upload('RC', big, C)).status === 413, 'over 2 MB is rejected');

// --- upload, serve, headers
const up = await upload('RC', good, C);
const upJ = await up.json();
ok(up.status === 200 && /^RC-[0-9a-f-]{36}\.png$/.test(upJ.logoKey), `a PNG is stored under a random name (${upJ.logoKey})`);
ok(await sawTeam('RC'), 'other clients are told the team changed');
const teams = await get('/teams', K);
ok(teams.find((t) => t.id === 'RC').logoKey === upJ.logoKey && teams.find((t) => t.id === 'AM').logoKey === null, '/teams lists the logo for that team only');
const me = await get('/me', C);
ok(me.team.logo_key === upJ.logoKey, '/me includes it too');
const served = await fetch(`${B}/logos/${upJ.logoKey}`);                       // note: no Authorization header
const body = new Uint8Array(await served.arrayBuffer());
ok(served.status === 200 && body.length === good.length && body.every((v, i) => v === good[i]), 'the image is served back byte for byte, without signing in');
ok(served.headers.get('content-type') === 'image/png', 'with the right content type');
ok(served.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(served.headers.get('content-security-policy') ?? ''), 'nosniff and a sandboxing CSP are set');
ok(/immutable/.test(served.headers.get('cache-control') ?? '') && served.headers.get('cross-origin-resource-policy') === 'cross-origin', 'long-lived caching and cross-origin use are allowed');
for (const bad of ['../x', 'nope.png', `RC-${'0'.repeat(36)}.png`, upJ.logoKey.replace('.png', '.svg'), 'RC-' + upJ.logoKey.slice(3) + '/x']) {
  ok((await fetch(`${B}/logos/${encodeURIComponent(bad)}`)).status === 404, `/logos/${bad.slice(0, 22)}… is a 404`);
}

// --- other formats are recognised by their bytes
const jpegish = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const j = await (await upload('MJ', jpegish, M, 'application/octet-stream')).json();
ok(/\.jpg$/.test(j.logoKey) && (await fetch(`${B}/logos/${j.logoKey}`)).headers.get('content-type') === 'image/jpeg', 'JPEG is detected from its bytes, whatever the label');
const webpish = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const w = await (await upload('KS', webpish, K, 'text/plain')).json();
ok(/\.webp$/.test(w.logoKey), 'WebP is detected from its bytes — and the commissioner can set any team’s logo');

// --- replace removes the old file
const second = await (await upload('RC', png(16, [10, 120, 200]), C)).json();
ok(second.logoKey !== upJ.logoKey, 'a new upload gets a new name');
ok((await fetch(`${B}/logos/${upJ.logoKey}`)).status === 404 && (await fetch(`${B}/logos/${second.logoKey}`)).status === 200, 'the old file is gone, the new one is served');

// --- remove
ok((await fetch(`${B}/teams/RC/logo`, { method: 'DELETE', headers: { Authorization: `Bearer ${M}` } })).status === 403, 'another owner can’t remove it');
const del = await fetch(`${B}/teams/RC/logo`, { method: 'DELETE', headers: { Authorization: `Bearer ${C}` } });
ok(del.status === 200 && (await del.json()).logoKey === null, 'the owner removes the logo');
ok((await fetch(`${B}/logos/${second.logoKey}`)).status === 404 && (await get('/teams', K)).find((t) => t.id === 'RC').logoKey === null, 'the file is deleted and the team has none');

// --- rename
const rename = (team, name, tok) => json('PATCH', `/teams/${team}`, { name }, tok);
ok((await rename('RC', '', C)).s === 400 && (await rename('RC', 'x', C)).s === 400, 'names under 2 characters are rejected');
ok((await rename('RC', 'y'.repeat(41), C)).s === 400, 'names over 40 characters are rejected');
ok((await rename('RC', 'Acuña Matata', C)).s === 409 && (await rename('RC', 'acuña matata', C)).s === 409, 'a name another team has is rejected, ignoring case');
ok((await rename('AM', 'Hijacked', C)).s === 403, 'an owner can’t rename another team');
const r1 = await rename('RC', '  Rally   Cats\u0007 2.0  ', C);
ok(r1.s === 200 && r1.j.name === 'Rally Cats 2.0', `whitespace and control characters are cleaned up (“${r1.j.name}”)`);
ok((await get('/teams', K)).find((t) => t.id === 'RC').name === 'Rally Cats 2.0' && (await get('/me', C)).team.name === 'Rally Cats 2.0', 'the new name shows everywhere');
ok((await rename('RC', 'Rally Cats', K)).s === 200, 'the commissioner can rename any team');
ok((await rename('RC', 'Rally Cats', C)).s === 200, 'keeping your own name is fine');
ws.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
