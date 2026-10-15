// End-to-end check of group conversations: validation, membership privacy, live delivery, unread, replies, edits,
// rename, add/leave, history for late joiners, typing signals, and that nothing leaks into the league room or DMs.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/groups-e2e.mjs
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
const teams = (await get('/public/teams')).map((t) => t.id);
const [T1, T2, T3, T4, T5, T6, T7, T8, T9] = teams;       // T1 = AM, the commissioner
const K = await reg('k@x.com', T1), C = await reg('c@x.com', T2), M = await reg('m@x.com', T3), D = await reg('d@x.com', T4);
if (![K, C, M, D].every(Boolean)) { console.log('FAIL could not register the test users (is the database fresh?)'); process.exit(1); }

const feeds = {};
const open = async (name, tok) => {
  const events = []; feeds[name] = events;
  const ws = new WebSocket(`ws://localhost:8787/draft/ws?token=${tok}`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return ws;
};
const socks = { K: await open('K', K), C: await open('C', C), M: await open('M', M), D: await open('D', D) };
const of = (name, type) => feeds[name].filter((e) => e.type === type);
const waitFor = async (name, type, pred = () => true, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = of(name, type).find(pred); if (e) return e; await sleep(50); } return null; };
const send = (tok, body) => call('POST', '/chat', body, tok);

try {
  // ---- validation
  ok((await call('POST', '/chat/groups', { teamIds: [T2] }, K)).s === 400, 'two teams is a direct message, not a group');
  ok((await call('POST', '/chat/groups', { teamIds: [T2, 'NOPE'] }, K)).s === 400, 'unknown team rejected');
  ok((await call('POST', '/chat/groups', { teamIds: 'RC' }, K)).s === 400, 'teamIds must be a list');
  ok((await call('POST', '/chat/groups', { teamIds: teams.slice(1, 10) }, K)).s === 400, 'more than 8 teams rejected');
  ok((await call('POST', '/chat/groups', { teamIds: [T2, T3], name: 'x'.repeat(41) }, K)).s === 400, 'a long name is rejected');

  // ---- create
  const g1 = await call('POST', '/chat/groups', { teamIds: [T2, T3], name: '  Trade   talk ' }, K);
  ok(g1.s === 201 && g1.j.group.members.length === 3 && g1.j.group.name === 'Trade talk', 'create a group (name tidied)');
  const G1 = g1.j.group.id;
  ok(!!(await waitFor('C', 'chat-group', (e) => e.id === G1)) && !!(await waitFor('M', 'chat-group', (e) => e.id === G1)), 'members are told live');
  await sleep(300);
  ok(of('D', 'chat-group').length === 0, 'a non-member hears nothing');
  const again = await call('POST', '/chat/groups', { teamIds: [T1, T3] }, C);
  ok(again.s === 200 && again.j.existing === true && again.j.group.id === G1, 'the same teams in another order open the existing group');

  // ---- privacy
  ok((await call('GET', `/chat/groups/${G1}`, null, D)).s === 404, 'a non-member cannot read the group');
  ok((await send(D, { body: 'let me in', groupId: G1 })).s === 403, 'a non-member cannot post to it');
  ok((await call('PATCH', `/chat/groups/${G1}`, { name: 'x' }, D)).s === 404, 'a non-member cannot rename it');
  ok((await call('POST', `/chat/groups/${G1}/members`, { teamId: T4 }, D)).s === 404, 'a non-member cannot add himself');
  ok((await call('POST', '/chat/group-read', { groupId: G1, lastId: 5 }, D)).s === 404, 'or mark it read');
  ok((await get('/chat/groups', D)).groups.length === 0, 'it is not in his list');

  // ---- messages, live
  const m1 = await send(K, { body: 'who wants to talk trades?', groupId: G1 });
  ok(m1.s === 201 && m1.j.groupId === G1 && m1.j.toTeam === null, 'send to the group');
  ok(!!(await waitFor('C', 'chat', (e) => e.message.id === m1.j.id)) && !!(await waitFor('M', 'chat', (e) => e.message.id === m1.j.id)), 'members get it live');
  await sleep(300);
  ok(!of('D', 'chat').some((e) => e.message.id === m1.j.id), 'a non-member never receives it');
  ok(!(await get('/chat', D)).messages.some((m) => m.id === m1.j.id) && !(await get('/chat', C)).messages.some((m) => m.id === m1.j.id), 'it never appears in the league room');
  ok((await get('/chat/dms', C)).conversations.length === 0, 'or in direct messages');
  ok((await send(K, { body: 'both', groupId: G1, toTeam: T2 })).s === 400, 'a message is for one conversation only');
  ok((await send(K, { body: 'nobody', groupId: 99999 })).s === 403, 'unknown group is refused');

  // ---- replies
  const league = await send(K, { body: 'league message' });
  ok((await send(C, { body: 'reply in group', groupId: G1, replyTo: m1.j.id })).s === 201, 'reply within the group');
  ok((await send(C, { body: 'cross', groupId: G1, replyTo: league.j.id })).s === 400, 'cannot reply to a league message from a group');
  ok((await send(C, { body: 'cross', replyTo: m1.j.id })).s === 400, 'cannot reply to a group message from the league room');

  // ---- unread
  const list = (await get('/chat/groups', C)).groups.find((g) => g.id === G1);
  ok(list.unread === 1 && list.last.fromMe === true, `unread shows in the list (${list.unread})`);
  const un0 = (await get('/chat/unread', M)).dm;
  ok(un0 >= 2, `the private-message badge counts group messages (${un0})`);
  const lastId = (await get(`/chat/groups/${G1}`, M)).messages.at(-1).id;
  ok((await call('POST', '/chat/group-read', { groupId: G1, lastId }, M)).s === 200, 'mark read');
  ok((await get('/chat/unread', M)).dm === 0 && (await get('/chat/groups', M)).groups[0].unread === 0, 'read clears the badge');
  ok((await call('POST', '/chat/group-read', { groupId: G1, lastId: 1 }, M)).s === 200 && (await get('/chat/groups', M)).groups[0].unread === 0, 'the marker never moves backward');

  // ---- edit / react / delete
  const mid = m1.j.id;
  ok((await call('PATCH', `/chat/${mid}`, { body: 'edited' }, C)).s === 403, 'only the author edits');
  ok((await call('PATCH', `/chat/${mid}`, { body: 'who wants to talk trades? (edited)' }, K)).s === 200 && !!(await waitFor('C', 'chat-edit', (e) => e.message.id === mid)), 'author edits; members see it');
  ok((await call('POST', `/chat/${mid}/react`, { emoji: '🔥' }, C)).s === 200 && !!(await waitFor('M', 'chat-react', (e) => e.id === mid)), 'members react');
  ok((await call('POST', `/chat/${mid}/react`, { emoji: '🔥' }, D)).s === 404, 'a non-member cannot react');
  ok((await call('PATCH', `/chat/${mid}`, { body: 'hijack' }, D)).s === 404 && (await call('DELETE', `/chat/${mid}`, null, D)).s === 404, 'or edit / delete');

  // ---- rename
  ok((await call('PATCH', `/chat/groups/${G1}`, { name: 'Deadline deals' }, C)).j.group.name === 'Deadline deals', 'any member can rename');
  ok(!!(await waitFor('K', 'chat-group', (e) => e.id === G1)), 'and everyone is told');
  ok((await call('PATCH', `/chat/groups/${G1}`, { name: '' }, C)).j.group.name === null, 'an empty name clears it');

  // ---- the commissioner has no window into a group they are not in
  const g2 = (await call('POST', '/chat/groups', { teamIds: [T3, T4] }, C)).j.group;
  ok(g2.members.sort().join() === [T2, T3, T4].sort().join(), 'a second group without the commissioner');
  const c2 = await send(C, { body: 'private from the commissioner', groupId: g2.id });
  ok((await call('GET', `/chat/groups/${g2.id}`, null, K)).s === 404, 'the commissioner cannot read it');
  ok((await call('DELETE', `/chat/${c2.j.id}`, null, K)).s === 404, 'nor delete its messages');
  ok(!of('K', 'chat').some((e) => e.message.id === c2.j.id), 'nor receive them live');

  // ---- late joiner sees only what follows
  ok((await call('POST', `/chat/groups/${G1}/members`, { teamId: T4 }, D)).s === 404, 'a non-member still cannot add himself');
  ok((await call('POST', `/chat/groups/${G1}/members`, { teamId: 'NOPE' }, C)).s === 400, 'unknown team rejected');
  ok((await call('POST', `/chat/groups/${G1}/members`, { teamId: T3 }, C)).s === 409, 'already a member');
  const add = await call('POST', `/chat/groups/${G1}/members`, { teamId: T4 }, C);
  ok(add.s === 200 && add.j.group.members.includes(T4), 'a member adds another team');
  ok(!!(await waitFor('D', 'chat-group', (e) => e.id === G1)), 'the new member is told');
  const hist = await get(`/chat/groups/${G1}`, D);
  ok(hist.messages.length === 0, `he cannot see what was said before he joined (${hist.messages.length} messages)`);
  const m2 = await send(K, { body: 'welcome', groupId: G1 });
  ok(!!(await waitFor('D', 'chat', (e) => e.message.id === m2.j.id)), 'he gets new messages live');
  ok((await get(`/chat/groups/${G1}`, D)).messages.map((m) => m.id).join() === String(m2.j.id), 'and sees only those');
  ok((await call('POST', '/chat/react-old', {}, D)).s === 404 && (await call('POST', `/chat/${mid}/react`, { emoji: '👍' }, D)).s === 404, 'old messages stay hidden (react refused)');
  ok((await send(D, { body: 'hi all', groupId: G1 })).s === 201, 'he can post');

  // ---- size limit
  for (const t of [T5, T6, T7, T8]) await call('POST', `/chat/groups/${G1}/members`, { teamId: t }, K);
  ok((await get(`/chat/groups/${G1}`, K)).group.members.length === 8, 'grow to eight teams');
  ok((await call('POST', `/chat/groups/${G1}/members`, { teamId: T9 }, K)).s === 400, 'the ninth is refused');

  // ---- typing
  feeds.C.length = 0; feeds.D.length = 0; feeds.M.length = 0;
  socks.K.send(JSON.stringify({ type: 'typing', scope: `group:${G1}` }));
  ok(!!(await waitFor('C', 'typing', (e) => e.scope === 'group' && e.group === G1 && e.teamId === T1)), 'members see who is typing in the group');
  feeds.K.length = 0; feeds.M.length = 0;
  const outsider = (await call('POST', '/chat/groups', { teamIds: [T2, T3] }, D)).j.group;  // D, C, M: K is not in it
  socks.C.send(JSON.stringify({ type: 'typing', scope: `group:${outsider.id}` }));
  await sleep(500);
  ok(of('K', 'typing').length === 0, 'a non-member does not see typing in a group he is not in');
  ok(!!(await waitFor('D', 'typing', (e) => e.group === outsider.id)), '...but its members do');
  feeds.D.length = 0; feeds.M.length = 0;
  socks.K.send(JSON.stringify({ type: 'typing', scope: `group:${outsider.id}` }));        // K is not a member and tries anyway
  await sleep(600);
  ok(of('D', 'typing').length === 0 && of('M', 'typing').length === 0, 'a non-member cannot send typing into a group');

  // ---- leaving
  const gl = await call('DELETE', `/chat/groups/${G1}/members/me`, null, D);
  ok(gl.s === 200, 'leave a group');
  ok((await call('GET', `/chat/groups/${G1}`, null, D)).s === 404 && (await send(D, { body: 'still here?', groupId: G1 })).s === 403, 'he can no longer read or post');
  ok((await get(`/chat/groups/${G1}`, K)).messages.some((m) => m.teamId === T4), 'what he said stays for the others');
  ok(!(await get(`/chat/groups/${G1}`, K)).group.members.includes(T4), 'he is off the member list');
  ok((await call('DELETE', `/chat/groups/${G1}/members/me`, null, D)).s === 404, 'leaving twice is a 404');

  // ---- the last one out turns off the lights
  const lone = (await call('POST', '/chat/groups', { teamIds: [T3, T4, T5] }, C)).j.group;
  const lm = await send(C, { body: 'bye', groupId: lone.id });
  for (const [tok] of [[C], [M], [D], [await reg('x5@x.com', T5)]]) await call('DELETE', `/chat/groups/${lone.id}/members/me`, null, tok);
  ok((await call('GET', `/chat/groups/${lone.id}`, null, C)).s === 404, 'when everyone has left the group is gone');
  ok((await call('PATCH', `/chat/${lm.j.id}`, { body: 'x' }, C)).s === 404, '... along with its messages');
  const recreated = await call('POST', '/chat/groups', { teamIds: [T3, T4, T5] }, C);
  ok(recreated.s === 201 && recreated.j.group.id !== lone.id, 'the same teams can start over');
} finally { Object.values(socks).forEach((s) => s.close()); }

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
