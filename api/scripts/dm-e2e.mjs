// End-to-end check of direct messages (privacy!), replies, @mentions, images, edits and typing indicators.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/dm-e2e.mjs
import { deflateSync } from 'node:zlib';

const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await call('GET', p, null, t)).j;
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
// a message POST that waits out the per-team rate limit instead of failing
const send = async (tok, body) => { for (let i = 0; i < 8; i++) { const r = await call('POST', '/chat', body, tok); if (r.s !== 429) return r; await sleep(2600); } throw new Error('rate limited'); };
const upload = (bytes, tok) => fetch(`${B}/chat/image`, { method: 'POST', headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: bytes });

function png(size, [r, g, b]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]));
}

const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC'), M = await reg('m@x.com', 'MJ'), S = await reg('s@x.com', 'KS');
if (![K, C, M, S].every(Boolean)) { console.log('FAIL could not register the four test users (is the database fresh?)'); process.exit(1); }
const feeds = {};
const open = async (name, tok) => {
  const events = []; feeds[name] = events;
  const ws = new WebSocket(`ws://localhost:8787/draft/ws?token=${tok}`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return ws;
};
const wsK = await open('K', K), wsC = await open('C', C), wsM = await open('M', M), wsS = await open('S', S);
const got = async (name, pred, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = feeds[name].find(pred); if (e) return e; await sleep(50); } return null; };
const never = async (name, pred, ms = 1200) => { await sleep(ms); return !feeds[name].some(pred); };

// ============================================================ direct messages
ok((await send(K, { body: 'hi me', toTeam: 'AM' })).s === 400, 'you can’t message yourself');
ok((await send(K, { body: 'hi', toTeam: 'ZZ' })).s === 400, 'unknown team is rejected');
const d1 = await send(K, { body: 'secret: I want your closer', toTeam: 'RC' });
ok(d1.s === 201 && d1.j.toTeam === 'RC' && d1.j.teamId === 'AM', 'AM sends RC a direct message');
const isD1 = (e) => e.type === 'chat' && e.message.id === d1.j.id;
ok(await got('C', isD1) && await got('K', isD1), 'RC receives it live, and AM’s own screen gets it too');
ok(await never('M', isD1) && await never('S', isD1, 300), 'bystanders’ sockets never receive it');
ok((await get('/chat?limit=100', M)).messages.every((m) => m.id !== d1.j.id) && (await get('/chat?limit=100', K)).messages.every((m) => m.id !== d1.j.id), 'it is not in the league room, even for the sender');
ok((await get('/chat/dm/AM', M)).messages.length === 0 && (await get('/chat/dm/RC', M)).messages.length === 0, 'a bystander’s threads with those teams don’t contain it');
const thread = await get('/chat/dm/AM', C);
ok(thread.messages.length === 1 && thread.messages[0].body === d1.j.body, 'RC’s thread with AM has it');
ok((await get('/chat/dm/RC', K)).messages.length === 1, 'AM sees it in the RC thread');
ok((await call('GET', '/chat/dm/RC', null, C)).s === 400 && (await call('GET', '/chat/dm/ZZ', null, C)).s === 400, 'a thread with yourself or an unknown team is a 400');
ok((await call('GET', '/chat/dms')).s === 401, 'sign-in is required');

// conversation list + unread
let dms = await get('/chat/dms', C);
ok(dms.conversations.length === 1 && dms.conversations[0].team === 'AM' && dms.conversations[0].unread === 1 && dms.totalUnread === 1, 'RC’s list shows one unread conversation with AM');
ok(dms.conversations[0].last.body.startsWith('secret') && dms.conversations[0].last.fromMe === false, 'with a preview of the last message');
ok((await get('/chat/dms', M)).conversations.length === 0, 'a bystander has no conversations');
ok((await get('/chat/unread', C)).dm === 1 && (await get('/chat/unread', M)).dm === 0, 'the unread summary counts direct messages separately');
await call('POST', '/chat/dm-read', { team: 'AM', lastId: d1.j.id }, C);
ok((await get('/chat/dms', C)).totalUnread === 0 && (await get('/chat/unread', C)).dm === 0, 'reading the thread clears it');
await call('POST', '/chat/dm-read', { team: 'AM', lastId: 1 }, C);
ok((await get('/chat/unread', C)).dm === 0, 'the marker never moves backwards');

// replies in a DM
const league1 = await send(K, { body: 'League-wide hello' });
const reply = await send(C, { body: 'Not for sale.', toTeam: 'AM', replyTo: d1.j.id });
ok(reply.s === 201 && reply.j.replyTo.id === d1.j.id && reply.j.replyTo.body.startsWith('secret') && reply.j.replyTo.teamId === 'AM', 'RC replies to the DM; the quote carries the original');
ok((await send(C, { body: 'x', toTeam: 'AM', replyTo: league1.j.id })).s === 400, 'a DM can’t reply to a league message');
ok((await send(C, { body: 'x', replyTo: d1.j.id })).s === 400, 'a league message can’t reply to a DM');
ok((await send(M, { body: 'x', toTeam: 'RC', replyTo: d1.j.id })).s === 400 && (await send(M, { body: 'x', replyTo: d1.j.id })).s === 400, 'a bystander can’t reply to someone else’s DM');
ok((await send(C, { body: 'x', toTeam: 'AM', replyTo: 999999 })).s === 400, 'replying to a missing message is a 400');

// reactions, edits, deletes, pins — participants only
ok((await call('POST', `/chat/${d1.j.id}/react`, { emoji: '👀' }, M)).s === 404, 'a bystander can’t react to a DM (it looks like it doesn’t exist)');
ok((await call('POST', `/chat/${d1.j.id}/react`, { emoji: '👀' }, C)).s === 200, 'a participant can');
ok(await got('K', (e) => e.type === 'chat-react' && e.id === d1.j.id) && await never('M', (e) => e.type === 'chat-react' && e.id === d1.j.id, 300), 'and only the two teams see the reaction');
ok((await call('PATCH', `/chat/${d1.j.id}`, { body: 'hacked' }, M)).s === 404 && (await call('PATCH', `/chat/${d1.j.id}`, { body: 'hacked' }, C)).s === 403, 'only the author edits (bystander: not found, recipient: forbidden)');
const ed = await call('PATCH', `/chat/${d1.j.id}`, { body: 'secret: I want your closer — name a price' }, K);
ok(ed.s === 200 && ed.j.editedAt > 0 && ed.j.body.endsWith('name a price'), 'the author edits a DM; it is marked edited');
ok(await got('C', (e) => e.type === 'chat-edit' && e.message.id === d1.j.id) && await never('S', (e) => e.type === 'chat-edit', 300), 'the edit goes to the two teams only');
ok((await call('PUT', `/chat/${d1.j.id}/pin`, { pinned: true }, K)).s === 404, 'a DM can’t be pinned, even by the commissioner');
const dmCM = await send(C, { body: 'private between C and M', toTeam: 'MJ' });
ok((await call('DELETE', `/chat/${dmCM.j.id}`, null, K)).s === 404, 'the commissioner can’t see or delete other people’s DMs');
ok((await call('DELETE', `/chat/${dmCM.j.id}`, null, M)).s === 403, 'the recipient can’t delete the sender’s message');
ok((await call('DELETE', `/chat/${dmCM.j.id}`, null, C)).s === 200 && await got('M', (e) => e.type === 'chat-delete' && e.id === dmCM.j.id) && await never('K', (e) => e.type === 'chat-delete' && e.id === dmCM.j.id, 300), 'the author deletes; only the two teams are told');

// ============================================================ replies in the league room
const long = await send(K, { body: 'L'.repeat(300) });
const r2 = await send(M, { body: 'a reply', replyTo: long.j.id });
ok(r2.s === 201 && r2.j.replyTo.body.length === 140 && r2.j.replyTo.teamId === 'AM', 'a reply quotes up to 140 characters of the original');
ok((await get('/chat?limit=100', C)).messages.find((m) => m.id === r2.j.id).replyTo.id === long.j.id, 'the list includes the quote');
await call('DELETE', `/chat/${long.j.id}`, null, K);
ok((await get('/chat?limit=100', C)).messages.find((m) => m.id === r2.j.id).replyTo.deleted === true, 'if the original is deleted the reply says so');

// ============================================================ mentions
const men = await send(K, { body: 'Trade deadline talk: @RC @rc and @MJ — not @AM, not @ZZ' });
ok(JSON.stringify(men.j.mentions) === JSON.stringify(['RC', 'MJ']), `mentions are found once, without yourself or unknown teams (${men.j.mentions})`);
const uC = await get('/chat/unread', C), uS = await get('/chat/unread', S);
ok(uC.mentions >= 1 && uC.count >= uC.mentions, 'a mentioned team sees a mention count');
ok(uS.mentions === 0 && uS.count > 0, 'a team that wasn’t mentioned only sees ordinary unread');
const dmMention = await send(K, { body: '@RC just between us', toTeam: 'RC' });
ok(dmMention.j.mentions.length === 0, 'DMs don’t create mentions');
const lastLeague = (await get('/chat?limit=1', C)).messages[0].id;
await call('POST', '/chat/read', { lastId: lastLeague }, C);
ok((await get('/chat/unread', C)).mentions === 0, 'reading the room clears mentions');

// ============================================================ editing in the league room
ok((await call('PATCH', `/chat/${men.j.id}`, { body: 'hijack' }, C)).s === 403 && (await call('PATCH', `/chat/${men.j.id}`, { body: 'hijack' }, M)).s === 403, 'other owners can’t edit your message');
const em = await call('PATCH', `/chat/${men.j.id}`, { body: 'Trade deadline talk: @KS only now' }, K);
ok(em.s === 200 && JSON.stringify(em.j.mentions) === JSON.stringify(['KS']) && em.j.editedAt > 0, 'editing re-reads the mentions');
ok(await got('S', (e) => e.type === 'chat-edit' && e.message.id === men.j.id), 'everyone gets the edit live');
const same = await call('PATCH', `/chat/${men.j.id}`, { body: 'Trade deadline talk: @KS only now' }, K);
ok(same.j.editedAt === em.j.editedAt, 'saving the same text doesn’t bump the edited time');
ok((await call('PATCH', `/chat/${men.j.id}`, { body: '   ' }, K)).s === 400 && (await call('PATCH', `/chat/${men.j.id}`, { body: 'x'.repeat(501) }, K)).s === 400, 'an edit can’t be empty or over 500 characters');
ok((await call('PATCH', '/chat/999999', { body: 'x' }, K)).s === 404, 'editing a missing message is a 404');

// ============================================================ images
const good = png(24, [30, 160, 90]);
ok((await upload(good, null)).status === 401, 'uploading needs a sign-in');
ok((await upload(new Uint8Array(0), C)).status === 400, 'an empty upload is rejected');
ok((await upload(new TextEncoder().encode('<html><script>1</script></html>'), C)).status === 415 && (await upload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), C)).status === 415, 'HTML and SVG are rejected by their bytes');
const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(good.slice(0, 8));
ok((await upload(big, C)).status === 413, 'over 2 MB is rejected');
const up = await (await upload(good, C)).json();
ok(/^[0-9a-f-]{36}\.png$/.test(up.imageKey), 'a PNG upload gets a random name');
const served = await fetch(`${B}/chat-images/${up.imageKey}`);
const bytes = new Uint8Array(await served.arrayBuffer());
ok(served.status === 200 && bytes.length === good.length && served.headers.get('content-type') === 'image/png' && served.headers.get('x-content-type-options') === 'nosniff', 'it is served back byte for byte with safe headers');
ok((await fetch(`${B}/chat-images/${encodeURIComponent('../x.png')}`)).status === 404 && (await fetch(`${B}/chat-images/${'0'.repeat(36)}.png`)).status === 404, 'bad or unknown names are 404s');
ok((await send(M, { body: 'stealing it', imageKey: up.imageKey })).s === 400, 'another team can’t attach your upload');
const pic = await send(C, { imageKey: up.imageKey });
ok(pic.s === 201 && pic.j.imageKey === up.imageKey && pic.j.body === '', 'an image alone is a valid message');
ok((await send(C, { body: 'again', imageKey: up.imageKey })).s === 400, 'an upload can only be attached once');
ok((await send(C, { body: 'nope', imageKey: `${'a'.repeat(36)}.png` })).s === 400, 'an unknown image key is rejected');
ok((await send(C, { body: '' })).s === 400, 'no text and no image is rejected');
ok(await got('M', (e) => e.type === 'chat' && e.message.id === pic.j.id && e.message.imageKey === up.imageKey), 'the image message arrives live');
const rep = await send(K, { body: 'nice', replyTo: pic.j.id });
ok(rep.j.replyTo.hasImage === true, 'a reply to a picture says it has an image');
const up2 = await (await upload(png(16, [200, 60, 60]), K)).json();
const dmPic = await send(K, { toTeam: 'RC', body: 'for you only', imageKey: up2.imageKey });
ok(dmPic.s === 201 && await got('C', (e) => e.type === 'chat' && e.message.id === dmPic.j.id) && await never('M', (e) => e.type === 'chat' && e.message.id === dmPic.j.id, 300), 'an image DM goes only to the two teams');
ok((await call('DELETE', `/chat/${pic.j.id}`, null, C)).s === 200, 'delete the picture message');
ok((await fetch(`${B}/chat-images/${up.imageKey}`)).status === 404, 'its file is deleted too');

// ============================================================ typing indicators
const typing = (ws, scope) => ws.send(JSON.stringify({ type: 'typing', scope }));
typing(wsC, 'league');
const t1 = await got('K', (e) => e.type === 'typing' && e.teamId === 'RC' && e.scope === 'league');
ok(t1 && await got('M', (e) => e.type === 'typing' && e.teamId === 'RC') && await got('S', (e) => e.type === 'typing' && e.teamId === 'RC'), 'league typing reaches everyone else');
ok(!feeds.C.some((e) => e.type === 'typing'), 'but not the person typing');
await sleep(900);
typing(wsC, 'AM');
ok(await got('K', (e) => e.type === 'typing' && e.scope === 'dm' && e.teamId === 'RC'), 'DM typing reaches the addressee, tagged as a DM');
ok(await never('M', (e) => e.type === 'typing' && e.scope === 'dm', 600) && await never('S', (e) => e.type === 'typing' && e.scope === 'dm', 100), 'and nobody else');
const before = feeds.K.filter((e) => e.type === 'typing').length;
await sleep(900); typing(wsC, 'league'); typing(wsC, 'league'); typing(wsC, 'league');
await sleep(500);
ok(feeds.K.filter((e) => e.type === 'typing').length === before + 1, 'a burst of typing signals is rate-limited to one');
await sleep(900);
const n0 = feeds.K.length;
wsC.send(JSON.stringify({ type: 'typing', scope: '../../x' })); wsC.send('not json'); wsC.send(JSON.stringify({ type: 'chat', message: { body: 'forged' } })); wsC.send('x'.repeat(500));
await sleep(600);
ok(feeds.K.length === n0, 'invalid scopes, junk and forged chat frames are ignored');

// ============================================================ upload rate limit (last: it uses up a team's quota)
const results = [];
for (let i = 0; i < 11; i++) results.push((await upload(png(8, [i * 20, 50, 50]), S)).status);
ok(results.slice(0, 10).every((s) => s === 200) && results[10] === 429, 'the eleventh upload within a minute is refused');

for (const w of [wsK, wsC, wsM, wsS]) w.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
