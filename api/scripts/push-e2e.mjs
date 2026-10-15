// End-to-end check of push notifications against fake push services on port 8791 (run-e2e.sh enables http://localhost
// endpoints and points Expo at it). Decrypts what a browser would receive, checks the VAPID signature, and covers
// device management, preferences, who gets notified for chat / mentions / trades / waivers, and dead-device cleanup.
// Run against a FRESH local API started with the vars in run-e2e.sh, then:  node api/scripts/push-e2e.mjs
import http from 'node:http';
import crypto from 'node:crypto';
const B = 'http://localhost:8787';
const VAPID_PUBLIC = 'BAuSa4rD3UsmSBI7R8_tgKq7tIdOGEPzD99K4Ub3cTDpo9pN0Y38ViPwYyqJATw0y_MbcaBxqsEqas1CP2IqjHA';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await call('GET', p, null, t)).j;
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const [A, R, J] = ['AM', 'RC', 'MJ'];                 // AM is the commissioner
const K = await reg('k@x.com', A), C = await reg('c@x.com', R), M = await reg('m@x.com', J);

// ---- a device: a receiver key pair, and the decrypting reader a browser would run
const b64u = (b) => Buffer.from(b).toString('base64url');
const received = {};                              // path -> [{ headers, payload }]
const devices = {};
function newDevice(name) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  devices[name] = { ecdh, auth, endpoint: `http://localhost:8791/push/${name}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
  return devices[name];
}
function decrypt(dev, body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const hk = (ikm, s, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, n));
  const secret = dev.ecdh.computeSecret(asPub);
  const ikm = hk(secret, dev.auth, Buffer.concat([Buffer.from('WebPush: info\0'), dev.ecdh.getPublicKey(), asPub]), 32);
  const cek = hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());          // drop the 0x02 delimiter
}
const expoGot = [];
const fake = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url === '/expo') {
      const msgs = JSON.parse(body.toString()); expoGot.push(...msgs);
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ data: msgs.map((m) => (String(m.to).includes('DEAD') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) }));
    }
    const name = req.url.replace('/push/', '');
    if (name.startsWith('gone')) { res.statusCode = 410; return res.end(); }
    (received[name] ??= []).push({ headers: req.headers, body });
    res.statusCode = 201; res.end();
  });
}).listen(8791);
const waitPush = async (name, n = 1, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if ((received[name]?.length ?? 0) >= n) return received[name]; await sleep(50); } return received[name] ?? []; };
const msgs = (name) => (received[name] ?? []).map((r) => decrypt(devices[name], r.body));
const subscribe = (tok, name) => call('POST', '/push/subscribe', { kind: 'web', endpoint: devices[name].endpoint, keys: devices[name].keys }, tok);

let lastSend = 0;
const say = async (tok, body) => { const w = 2200 - (Date.now() - lastSend); if (w > 0) await sleep(w); const r = await call('POST', '/chat', body, tok); lastSend = Date.now(); return r.j; };
const teamName = async (id) => (await get('/public/teams')).find((t) => t.id === id).name;

try {
  // ---- config + validation
  ok((await call('GET', '/push/config')).s === 401, 'config needs a login');
  const cfg = await get('/push/config', K);
  ok(cfg.web === VAPID_PUBLIC && cfg.expo === true, 'config gives the browser the public key');
  newDevice('k1'); newDevice('k2'); newDevice('c1'); newDevice('gone1');
  ok((await call('POST', '/push/subscribe', { kind: 'web', endpoint: 'http://evil.example/x', keys: devices.k1.keys }, K)).s === 400, 'a non-https, non-local endpoint is refused');
  ok((await call('POST', '/push/subscribe', { kind: 'web', endpoint: 'https://169.254.169.254/latest', keys: devices.k1.keys }, K)).s === 400, 'an internal address is refused');
  ok((await call('POST', '/push/subscribe', { kind: 'web', endpoint: devices.k1.endpoint }, K)).s === 400, 'keys are required');
  ok((await call('POST', '/push/subscribe', { kind: 'web', endpoint: devices.k1.endpoint, keys: devices.k1.keys })).s === 401, 'subscribing needs a login');
  ok((await call('POST', '/push/subscribe', { kind: 'carrier-pigeon', endpoint: 'x' }, K)).s === 400, 'unknown device type refused');
  ok((await call('POST', '/push/subscribe', { kind: 'expo', endpoint: 'not-a-token' }, K)).s === 400, 'a bad Expo token is refused');
  ok((await subscribe(K, 'k1')).s === 201 && (await subscribe(K, 'k2')).s === 201 && (await subscribe(C, 'c1')).s === 201, 'three browsers subscribe');
  ok((await call('POST', '/push/subscribe', { kind: 'expo', endpoint: 'ExponentPushToken[abcdefghij123456]' }, K)).s === 201, 'and a phone app');
  ok((await get('/push/devices', K)).devices.length === 3, 'K has three devices');

  // ---- a DM reaches the other team's devices (decrypted), not the sender's
  const cName = await teamName(R), kName = await teamName(A);
  await say(C, { body: 'want to talk trades?', toTeam: A });
  await waitPush('k1'); await waitPush('k2');
  const dm = msgs('k1')[0];
  ok(dm.title === cName && dm.body === 'want to talk trades?' && dm.url === `/?chat=dm:${R}` && dm.kind === 'dm', `K's browser receives the DM (${dm.title}: ${dm.body})`);
  ok(msgs('k2').length === 1 && !received.c1, 'both of K’s browsers get it; the sender’s device does not');
  const hdr = received.k1[0].headers;
  ok(hdr['content-encoding'] === 'aes128gcm' && hdr.urgency === 'high' && Number(hdr.ttl) > 0, 'sent with the right encoding, urgency and TTL');
  const m = hdr.authorization.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(Buffer.from(VAPID_PUBLIC, 'base64url').subarray(1, 33)), y: b64u(Buffer.from(VAPID_PUBLIC, 'base64url').subarray(33, 65)) }, format: 'jwk' });
  ok(!!m && m[4] === VAPID_PUBLIC && crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'the VAPID signature verifies against the public key');
  ok(JSON.parse(Buffer.from(m[2], 'base64url')).aud === 'http://localhost:8791', 'and names the push service as its audience');
  await sleep(300);
  ok(expoGot.length === 1 && expoGot[0].to === 'ExponentPushToken[abcdefghij123456]' && expoGot[0].title === cName && expoGot[0].data.url === `/?chat=dm:${R}`, 'the phone app gets it through Expo');

  // ---- preferences
  ok((await get('/push/prefs', K)).dm === true && (await get('/push/prefs', K)).preview === true, 'everything is on by default');
  ok((await call('PUT', '/push/prefs', { dm: 'no' }, K)).s === 400 && (await call('PUT', '/push/prefs', { nope: true }, K)).s === 400 && (await call('PUT', '/push/prefs', {}, K)).s === 400, 'bad preference updates are refused');
  ok((await call('PUT', '/push/prefs', { dm: false }, K)).j.dm === false, 'K turns DM notifications off');
  const before = received.k1.length;
  await say(C, { body: 'second dm', toTeam: A }); await sleep(900);
  ok(received.k1.length === before, 'no DM notification while it is off');
  await call('PUT', '/push/prefs', { dm: true, preview: false }, K);
  await say(C, { body: 'secret plans', toTeam: A }); await waitPush('k1', before + 1);
  const hidden = msgs('k1').at(-1);
  ok(hidden.body === 'Open Pennant Race to read it' && !JSON.stringify(hidden).includes('secret'), 'with previews off the text never leaves the server');
  await call('PUT', '/push/prefs', { preview: true }, K);

  // ---- groups, mentions
  const G = (await call('POST', '/chat/groups', { teamIds: [R, J], name: 'Trade talk' }, K)).j.group.id;
  await say(M, { body: 'group hello', groupId: G });
  await waitPush('c1'); await waitPush('k1', before + 2);
  const gm = msgs('c1').at(-1), mName = await teamName(J);
  ok(gm.title === 'Trade talk' && gm.body === `${mName}: group hello` && gm.url === `/?chat=group:${G}`, `a group message reaches the other members (${gm.title} / ${gm.body})`);
  const kGroup = msgs('k1').at(-1);
  ok(kGroup.kind === 'group', 'including K');
  const c1n = received.c1.length;
  await call('PUT', '/push/prefs', { group: false }, C);
  await say(M, { body: 'second group message', groupId: G }); await sleep(900);
  ok(received.c1.length === c1n, 'group notifications can be switched off separately');

  const k1n = received.k1.length;
  await say(C, { body: `hey @${A} are you around?` });
  await waitPush('k1', k1n + 1);
  const mention = msgs('k1').at(-1);
  ok(mention.kind === 'mention' && mention.title === `${cName} mentioned you` && mention.url === '/?chat=league', 'an @mention in the league room notifies that team');
  const k1m = received.k1.length;
  await say(C, { body: 'a league message with no mention' }); await sleep(900);
  ok(received.k1.length === k1m, 'ordinary league chat sends no push');

  // ---- trades
  const cand = (await call('POST', '/seasons/push', null, K), (await get('/keepers?season=2027', K)).candidates);
  const mine = cand.find((p) => p.teamId === A && p.tier === 1 && p.cost), theirs = cand.find((p) => p.teamId === R && p.tier === 1 && p.cost);
  await call('PUT', '/keepers', { teamId: A, playerId: mine.playerId, kept: true }, K); await call('PUT', '/keepers', { teamId: R, playerId: theirs.playerId, kept: true }, C);
  const c1b = received.c1.length;
  const offer = await call('POST', '/trades', { toTeam: R, give: [mine.playerId], get: [theirs.playerId] }, K);
  ok(offer.s === 201, 'K proposes a trade');
  await waitPush('c1', c1b + 1);
  const t1 = msgs('c1').at(-1);
  ok(t1.kind === 'trade' && t1.title === `Trade offer from ${kName}`, 'the other team is notified of the offer');
  const k1t = received.k1.length;
  await call('POST', `/trades/${offer.j.id}/reject`, null, C);
  await waitPush('k1', k1t + 1);
  ok(msgs('k1').at(-1).title === `${cName} declined your trade`, 'the proposer hears about the rejection');
  const c1pre = received.c1.length;
  const offer2 = await call('POST', '/trades', { toTeam: R, give: [mine.playerId], get: [theirs.playerId] }, K);
  await waitPush('c1', c1pre + 1);                                  // the new-offer notification arrives first
  const c1c = received.c1.length;
  await call('POST', `/trades/${offer2.j.id}/cancel`, null, K);
  await waitPush('c1', c1c + 1);
  ok(msgs('c1').at(-1).title.includes('withdrew'), 'a withdrawal notifies the recipient');

  // ---- waivers
  const free = (await get('/players/pool?limit=50', C)).players[0];
  ok((await call('POST', '/claims', { addPlayerId: free.id, bid: 3 }, C)).s === 201, 'RC claims a free agent');
  const c1w = received.c1.length;
  await call('PUT', '/push/prefs', { group: true }, C);
  await call('POST', '/waivers/process', null, K);
  await waitPush('c1', c1w + 1);
  const w = msgs('c1').at(-1);
  ok(w.kind === 'waiver' && w.title === `Waiver claim won: ${free.name}` && w.body.includes('$3'), `the claimant hears the result (${w.title})`);

  // ---- test notification, device ownership, removal
  const k1x = received.k1.length;
  await call('PUT', '/push/prefs', { dm: false, group: false, mention: false, trade: false, waiver: false }, K);
  ok((await call('POST', '/push/test', null, K)).j.sent === 3, 'the test notification reaches every device even with everything off');
  ok((await call('POST', '/push/test', null, K)).s === 429, 'tests are rate limited');
  await waitPush('k1', k1x + 1);
  ok(msgs('k1').at(-1).body.includes('working'), 'and it says it is working');
  ok((await call('POST', '/push/subscribe', { kind: 'web', endpoint: devices.k2.endpoint, keys: devices.k2.keys }, M)).s === 201, 'a device that signs in as someone else moves to them');
  ok((await get('/push/devices', K)).devices.length === 2 && (await get('/push/devices', M)).devices.length === 1, 'K no longer owns it');
  ok((await call('DELETE', '/push/subscribe', { endpoint: devices.k1.endpoint }, C)).s === 200 && (await get('/push/devices', K)).devices.length === 2, 'another user cannot remove K’s device');
  ok((await call('DELETE', '/push/subscribe', { endpoint: devices.k1.endpoint }, K)).s === 200 && (await get('/push/devices', K)).devices.length === 1, 'K removes his own');

  // ---- dead devices are cleaned up
  ok((await subscribe(C, 'gone1')).s === 201 && (await call('POST', '/push/subscribe', { kind: 'expo', endpoint: 'ExponentPushToken[DEADdeaddead1234]' }, C)).s === 201, 'RC adds a dead browser and a dead phone');
  const before2 = (await get('/push/devices', C)).devices.length;
  await call('PUT', '/push/prefs', { dm: true }, C);
  await say(K, { body: 'anyone there?', toTeam: R });
  await sleep(1500);
  const left = (await get('/push/devices', C)).devices;
  ok(before2 === 3 && left.length === 1 && left[0].endpoint === devices.c1.endpoint, 'a 410 and a DeviceNotRegistered ticket remove those devices');
} finally { fake.close(); }

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
