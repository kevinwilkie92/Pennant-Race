// End-to-end check of read receipts for direct messages and groups: live delivery, the opt-out (reciprocal, and it
// reveals nothing about the past when switched back on), claims clamped to what was really said, and privacy.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/receipts-e2e.mjs
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
const [A, R, J, X] = (await get('/public/teams')).map((t) => t.id);
const K = await reg('k@x.com', A), C = await reg('c@x.com', R), M = await reg('m@x.com', J), D = await reg('d@x.com', X);
if (![K, C, M, D].every(Boolean)) { console.log('FAIL could not register the test users (is the database fresh?)'); process.exit(1); }

const feeds = {};
const open = async (name, tok) => {
  const events = []; feeds[name] = events;
  const ws = new WebSocket(`ws://localhost:8787/draft/ws?token=${tok}`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return ws;
};
const socks = [await open('K', K), await open('C', C), await open('M', M), await open('D', D)];
const reads = (n) => feeds[n].filter((e) => e.type === 'chat-read');
const waitRead = async (n, pred, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = reads(n).find(pred); if (e) return e; await sleep(50); } return null; };
const say = async (tok, body) => (await call('POST', '/chat', body, tok)).j;
const dmRead = (tok, team, lastId) => call('POST', '/chat/dm-read', { team, lastId }, tok);
const dmReceipts = async (tok, team) => (await get(`/chat/dm/${team}`, tok)).receipts;

try {
  ok((await get('/chat/settings', K)).readReceipts === true, 'receipts are on by default');
  ok((await call('PUT', '/chat/settings', { readReceipts: 'yes' }, K)).s === 400, 'the setting must be true or false');

  // ---- direct messages
  const a = await say(K, { body: 'hello RC', toTeam: R });
  ok((await dmReceipts(K, R)).length === 0, 'nothing is read yet');
  ok((await dmRead(C, A, a.id)).s === 200, 'RC reads it');
  const ev = await waitRead('K', (e) => e.scope === 'dm' && e.teamId === R && e.lastId === a.id);
  ok(!!ev && typeof ev.at === 'number', 'the sender is told live');
  await sleep(300);
  ok(reads('C').length === 0 && reads('M').length === 0 && reads('D').length === 0, 'nobody else hears about it (not even the reader)');
  const rc = await dmReceipts(K, R);
  ok(rc.length === 1 && rc[0].teamId === R && rc[0].lastId === a.id, 'the sender sees it on reload');
  ok((await dmReceipts(C, A)).length === 0, 'RC has no receipt from K (K has not read anything)');

  // ---- honesty: a claim can't run past what was said
  await dmRead(C, A, 999999);
  const b = await say(K, { body: 'second message', toTeam: R });
  ok((await get('/chat/dms', C)).conversations.find((c) => c.team === A).unread === 1, 'reading "999999" did not pre-read the future');
  ok((await dmRead(C, 'NOPE', 5)).s === 400 && (await dmRead(C, R, 5)).s === 400, 'unknown team / yourself rejected');

  // ---- opting out
  ok((await call('PUT', '/chat/settings', { readReceipts: false }, C)).j.readReceipts === false, 'RC turns receipts off');
  const c1 = await say(K, { body: 'third', toTeam: R });
  feeds.K.length = 0;
  await dmRead(C, A, c1.id);
  await sleep(500);
  ok(reads('K').length === 0, 'while off, RC reads silently');
  ok((await get('/chat/dms', C)).conversations.find((c) => c.team === A).unread === 0, '...but his unread count still clears');
  ok((await dmReceipts(K, R)).length === 0, 'while RC has receipts off, K sees none from him at all');
  ok((await dmReceipts(C, A)).length === 0, 'and RC sees nobody else’s receipts (reciprocal)');
  await call('PUT', '/chat/settings', { readReceipts: true }, C);
  ok((await dmReceipts(K, R))[0].lastId === a.id, 'switching back on shows only what he shared before, nothing about what he read while off');
  const d1 = await say(K, { body: 'fourth', toTeam: R });
  await dmRead(C, A, d1.id);
  ok(!!(await waitRead('K', (e) => e.scope === 'dm' && e.lastId === d1.id)), 'new reads are shared again');

  // ---- the viewer opts out too: no live receipts, no fetched receipts
  await call('PUT', '/chat/settings', { readReceipts: false }, K);
  feeds.K.length = 0;
  const e1 = await say(K, { body: 'fifth', toTeam: R });
  await dmRead(C, A, e1.id);
  await sleep(500);
  ok(reads('K').length === 0, 'a team that has receipts off is not sent anyone else’s');
  ok((await dmReceipts(K, R)).length === 0, 'and sees none on reload');
  await call('PUT', '/chat/settings', { readReceipts: true }, K);

  // ---- groups
  await sleep(10500);                      // (the send rate limit is 5 messages per 10 seconds)
  const G = (await call('POST', '/chat/groups', { teamIds: [R, J] }, K)).j.group.id;
  const g1 = await say(K, { body: 'group hello', groupId: G });
  feeds.K.length = 0; feeds.C.length = 0; feeds.M.length = 0; feeds.D.length = 0;
  ok((await call('POST', '/chat/group-read', { groupId: G, lastId: g1.id }, C)).s === 200, 'RC reads the group message');
  ok(!!(await waitRead('K', (e) => e.scope === 'group' && e.group === G && e.teamId === R && e.lastId === g1.id)), 'the sender is told live');
  ok(!!(await waitRead('M', (e) => e.scope === 'group' && e.group === G && e.teamId === R)), 'so is the other member');
  await sleep(300);
  ok(reads('C').length === 0 && reads('D').length === 0, 'not the reader, and not a non-member');
  ok((await call('POST', '/chat/group-read', { groupId: G, lastId: g1.id }, D)).s === 404, 'a non-member cannot mark it read');
  let gr = (await get(`/chat/groups/${G}`, K)).receipts;
  ok(gr.length === 1 && gr[0].teamId === R, 'K sees only RC so far');
  await call('POST', '/chat/group-read', { groupId: G, lastId: g1.id }, M);
  gr = (await get(`/chat/groups/${G}`, K)).receipts;
  ok(gr.length === 2 && gr.every((r) => r.lastId === g1.id), 'then both');
  ok((await get(`/chat/groups/${G}`, K)).receipts.every((r) => r.teamId !== A), 'the viewer is never listed as having seen their own message');
  ok((await call('POST', '/chat/group-read', { groupId: G, lastId: 999999 }, M)).s === 200 && (await get('/chat/groups', M)).groups.find((g) => g.id === G).unread === 0, 'group claims are clamped too (no unread left, none invented)');
  await sleep(500);
  const g2 = await say(K, { body: 'later group message', groupId: G });
  ok((await get('/chat/groups', M)).groups.find((g) => g.id === G).unread === 1, '...so a later message is still unread');

  // M opts out: reads without sharing
  await call('PUT', '/chat/settings', { readReceipts: false }, M);
  feeds.K.length = 0;
  await call('POST', '/chat/group-read', { groupId: G, lastId: g2.id }, M);
  await sleep(500);
  ok(reads('K').length === 0, 'an opted-out member reads silently');
  gr = (await get(`/chat/groups/${G}`, K)).receipts;
  ok(!gr.some((r) => r.teamId === J), 'and he disappears from everyone’s receipts');
  await call('PUT', '/chat/settings', { readReceipts: true }, M);
  gr = (await get(`/chat/groups/${G}`, K)).receipts;
  ok(gr.find((r) => r.teamId === J).lastId === g1.id, 'back on, his shared position is where it was (not what he read while off)');
  await call('PUT', '/chat/settings', { readReceipts: false }, M);
  ok((await get(`/chat/groups/${G}`, M)).receipts.length === 0, 'he sees no one else’s');
} finally { socks.forEach((s) => s.close()); }

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
