// End-to-end check of league chat: validation, pagination, rate limit, reactions, pinning, deleting, unread, live delivery.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/chat-e2e.mjs
const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const call = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await call('GET', p, null, t)).j;
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC'), M = await reg('m@x.com', 'MJ'), S = await reg('s@x.com', 'KS');
const say = (tok, body) => call('POST', '/chat', { body }, tok);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- live socket for RC (opened first so it sees everything)
const events = [];
ok((await fetch(`${B}/draft/ws?token=bad`)).status === 401, 'the live socket rejects a bad token');
const ws = new WebSocket(`ws://localhost:8787/draft/ws?token=${C}`);
ws.onmessage = (m) => events.push(JSON.parse(m.data));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const waitFor = async (pred, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = events.find(pred); if (e) return e; await sleep(50); } return null; };

// --- validation
ok((await say(K, '')).s === 400 && (await say(K, '   \n ')).s === 400, 'empty and blank messages are rejected');
ok((await say(K, 'x'.repeat(501))).s === 400, 'over 500 characters is rejected');
ok((await say(K, 'é'.repeat(500))).s === 201, 'exactly 500 characters (counted as characters) is fine');
ok((await call('POST', '/chat', { body: 'hi' })).s === 401, 'sign-in is required');
const first = await say(K, '  Welcome to the league!  ');
ok(first.s === 201 && first.j.body === 'Welcome to the league!' && first.j.teamId === 'AM', 'a message is trimmed and tagged with the sender’s team');
const live = await waitFor((e) => e.type === 'chat' && e.message.id === first.j.id);
ok(live && live.message.body === 'Welcome to the league!', 'another client receives it live');

// --- pagination (oldest -> newest), under the rate limit by spreading across teams
const ids = [];
for (let round = 0; round < 3; round++) for (const tok of [C, M, S]) ids.push((await say(tok, `message ${ids.length + 1}`)).j.id);
let all = await get('/chat?limit=100', K);
ok(all.messages.length === 11 && all.messages.every((m, i) => i === 0 || m.id > all.messages[i - 1].id), 'messages come back oldest to newest');
const p1 = await get('/chat?limit=4', K);
ok(p1.messages.length === 4 && p1.hasMore && p1.messages.at(-1).id === all.messages.at(-1).id, 'the first page is the newest four');
const p2 = await get(`/chat?limit=4&before=${p1.messages[0].id}`, K);
ok(p2.messages.length === 4 && p2.messages.at(-1).id < p1.messages[0].id && p2.hasMore, 'the next page continues backwards');
const p3 = await get(`/chat?limit=4&before=${p2.messages[0].id}`, K);
ok(p3.messages.length === 3 && !p3.hasMore, 'the last page says there is no more');

// --- rate limit (per team)
await sleep(10_500);
const burst = [];
for (let i = 0; i < 6; i++) burst.push((await say(K, `burst ${i}`)).s);
ok(burst.slice(0, 5).every((s) => s === 201) && burst[5] === 429, 'the sixth message inside ten seconds is refused');
ok((await say(C, 'other teams are unaffected')).s === 201, 'the limit is per team');

// --- reactions
const target = ids[0];
ok((await call('POST', `/chat/${target}/react`, { emoji: '🤡' }, K)).s === 400, 'only the offered emoji are allowed');
ok((await call('POST', '/chat/999999/react', { emoji: '🔥' }, K)).s === 404, 'unknown message is a 404');
const r1 = await call('POST', `/chat/${target}/react`, { emoji: '🔥' }, K);
ok(JSON.stringify(r1.j.reactions) === JSON.stringify({ '🔥': ['AM'] }), 'a reaction is recorded for the team');
await call('POST', `/chat/${target}/react`, { emoji: '🔥' }, M);
await call('POST', `/chat/${target}/react`, { emoji: '😂' }, M);
const lst = (await get('/chat?limit=100', K)).messages.find((m) => m.id === target);
ok(lst.reactions['🔥'].length === 2 && lst.reactions['😂'].length === 1, 'counts add up across teams');
ok(await waitFor((e) => e.type === 'chat-react' && e.id === target && e.reactions['🔥']?.length === 2), 'reactions are broadcast live');
const off = await call('POST', `/chat/${target}/react`, { emoji: '🔥' }, K);
ok(off.j.reactions['🔥'].length === 1 && off.j.reactions['🔥'][0] === 'MJ', 'reacting again removes your reaction');
await call('POST', `/chat/${target}/react`, { emoji: '🔥' }, M);
ok(!('🔥' in (await get('/chat?limit=100', K)).messages.find((m) => m.id === target).reactions), 'an emoji with no reactions disappears');

// --- pinning: commissioner only, one at a time
ok((await call('PUT', `/chat/${target}/pin`, { pinned: true }, C)).s === 403, 'only the commissioner can pin');
ok((await call('PUT', `/chat/${target}/pin`, { pinned: true }, K)).s === 200 && (await get('/chat', K)).pinned.id === target, 'the commissioner pins an announcement');
ok(await waitFor((e) => e.type === 'chat-pin' && e.pinned?.id === target), 'the pin is broadcast');
await call('PUT', `/chat/${ids[1]}/pin`, { pinned: true }, K);
const pinnedNow = await get('/chat?limit=100', K);
ok(pinnedNow.pinned.id === ids[1] && pinnedNow.messages.filter((m) => m.pinned).length === 1, 'pinning another replaces the first');
ok((await call('PUT', '/chat/999999/pin', { pinned: true }, K)).s === 404, 'pinning a missing message is a 404');

// --- deleting
ok((await call('DELETE', `/chat/${first.j.id}`, null, C)).s === 403, 'you can’t delete someone else’s message');
const mine = await say(C, 'delete me');
ok((await call('DELETE', `/chat/${mine.j.id}`, null, C)).s === 200, 'you can delete your own');
ok(await waitFor((e) => e.type === 'chat-delete' && e.id === mine.j.id), 'the delete is broadcast');
ok((await call('DELETE', `/chat/${ids[1]}`, null, K)).s === 200, 'the commissioner can delete anyone’s');
ok((await get('/chat', K)).pinned === null, 'deleting the pinned message clears the announcement');
ok((await call('DELETE', `/chat/${ids[1]}`, null, K)).s === 404, 'deleting twice is a 404');

// --- unread
const before = (await get('/chat/unread', M)).count;
ok(before > 0, `MJ has ${before} unread messages from other teams`);
const lastId = (await get('/chat?limit=1', M)).messages[0].id;
await call('POST', '/chat/read', { lastId }, M);
ok((await get('/chat/unread', M)).count === 0, 'reading up to the newest clears the badge');
await call('POST', '/chat/read', { lastId: 1 }, M);
ok((await get('/chat/unread', M)).count === 0, 'the read marker never moves backwards');
await say(M, 'my own message');
ok((await get('/chat/unread', M)).count === 0, 'your own messages don’t count as unread');
await say(S, 'a new one from KS');
ok((await get('/chat/unread', M)).count === 1, 'a message from another team counts');

ws.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
