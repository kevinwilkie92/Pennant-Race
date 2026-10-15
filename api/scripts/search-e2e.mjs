// End-to-end check of chat search: it finds only what the searcher may read (league room, own DMs, own groups from
// when they joined), narrows by scope / sender, treats wildcards literally, and pages.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/search-e2e.mjs
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

let last = 0;
const say = async (tok, body) => {             // stay under the 5-per-10-seconds send limit
  const wait = 2200 - (Date.now() - last); if (wait > 0) await sleep(wait);
  const r = await call('POST', '/chat', body, tok); last = Date.now();
  if (r.s !== 201) console.log('send failed', r.s, r.j);
  return r.j;
};
const search = async (tok, q, extra = '') => (await call('GET', `/chat/search?q=${encodeURIComponent(q)}${extra}`, null, tok));
const bodies = (r) => r.j.results.map((x) => x.message.body).sort();

const lg = await say(C, { body: 'zebra in the league room' });
const kc = await say(K, { body: 'zebra between K and C', toTeam: R });
const cm = await say(C, { body: 'zebra between C and M', toTeam: J });
const G1 = (await call('POST', '/chat/groups', { teamIds: [R, J] }, K)).j.group.id;
const g1 = await say(K, { body: 'zebra in group one', groupId: G1 });
const G2 = (await call('POST', '/chat/groups', { teamIds: [J, X] }, C)).j.group.id;   // C, M, D: no K
const g2 = await say(C, { body: 'zebra in group two, K is not here', groupId: G2 });
await say(C, { body: '100% sure about it' });
await say(C, { body: '1000 sure about it' });
await say(M, { body: 'a_b is an underscore' });
await say(M, { body: 'aXb is not' });

// ---- basics
ok((await search(K, 'z')).s === 400 && (await search(K, '')).s === 400, 'a query under 2 characters is refused');
ok((await call('GET', '/chat/search?q=zebra')).s === 401, 'search needs a login');

// ---- who sees what
ok(bodies(await search(K, 'zebra')).join('|') === ['zebra between K and C', 'zebra in group one', 'zebra in the league room'].sort().join('|'), 'K finds the league message, his DM and his group, nothing else');
ok(bodies(await search(C, 'zebra')).length === 5, 'C is in all five conversations and finds all five');
ok(bodies(await search(M, 'zebra')).join('|') === ['zebra between C and M', 'zebra in group one', 'zebra in group two, K is not here', 'zebra in the league room'].sort().join('|'), 'M finds his own DM and groups only (not K and C’s DM)');
const dRes = bodies(await search(D, 'zebra'));
ok(dRes.length === 2 && dRes.includes('zebra in group two, K is not here') && dRes.includes('zebra in the league room'), 'D finds the league room and the one group he is in');
ok(!(await search(K, 'secret')).j.results.length, 'no hits is an empty list');
ok(bodies(await search(K, 'ZEBRA')).length === 3, 'search ignores case');

// ---- where each hit lives
const kr = (await search(K, 'zebra')).j.results;
ok(kr.find((x) => x.message.id === lg.id).where.kind === 'league', 'league hit is labelled league');
ok(JSON.stringify(kr.find((x) => x.message.id === kc.id).where) === JSON.stringify({ kind: 'dm', team: R }), 'a DM hit names the other team');
ok(JSON.stringify(kr.find((x) => x.message.id === g1.id).where) === JSON.stringify({ kind: 'group', id: G1 }), 'a group hit names the group');
ok(JSON.stringify((await search(C, 'zebra')).j.results.find((x) => x.message.id === kc.id).where) === JSON.stringify({ kind: 'dm', team: A }), '...from the other side too');

// ---- scopes and filters
ok(bodies(await search(K, 'zebra', '&scope=league')).length === 1, 'scope=league');
ok(bodies(await search(K, 'zebra', '&scope=private')).length === 2, 'scope=private');
ok(bodies(await search(K, 'zebra', `&scope=dm:${R}`)).join() === 'zebra between K and C', 'scope=dm:<team>');
ok(bodies(await search(K, 'zebra', `&scope=dm:${J}`)).length === 0, 'asking for a DM thread you are not in finds nothing');
ok(bodies(await search(K, 'zebra', `&scope=group:${G1}`)).join() === 'zebra in group one', 'scope=group:<id>');
ok(bodies(await search(K, 'zebra', `&scope=group:${G2}`)).length === 0, 'asking for a group you are not in finds nothing');
ok(bodies(await search(C, 'zebra', `&from=${A}`)).length === 2, 'from=<team> filters by sender');
ok(bodies(await search(K, 'zebra', '&scope=nonsense')).length === 3, 'an unknown scope falls back to everything you may see');

// ---- wildcards are literal
ok(bodies(await search(K, '100%')).join() === '100% sure about it', '% matches a literal percent sign');
ok(bodies(await search(K, 'a_b')).join() === 'a_b is an underscore', '_ matches a literal underscore');
ok(bodies(await search(K, '%%')).length === 0, 'a bare wildcard matches nothing');

// ---- late joiner and leaving
ok((await call('POST', `/chat/groups/${G1}/members`, { teamId: X }, K)).s === 200, 'D joins group one late');
ok(!bodies(await search(D, 'zebra', `&scope=group:${G1}`)).length, 'D cannot find what was said before he joined');
await say(K, { body: 'zebra after D joined', groupId: G1 });
ok(bodies(await search(D, 'zebra', `&scope=group:${G1}`)).join() === 'zebra after D joined', '...but finds what comes after');
await call('DELETE', `/chat/groups/${G1}/members/me`, null, K);
ok(!bodies(await search(K, 'zebra', `&scope=group:${G1}`)).length, 'a team that left a group can no longer search it');
ok(bodies(await search(C, 'zebra', `&scope=group:${G1}`)).length === 2, 'the others still can');

// ---- deleted messages disappear
await call('DELETE', `/chat/${lg.id}`, null, C);
ok(!bodies(await search(K, 'zebra', '&scope=league')).length, 'a deleted message is gone from search');

// ---- paging
const p1 = (await search(C, 'zebra', '&limit=2')).j;
ok(p1.results.length === 2 && p1.hasMore === true, 'a page is capped and says there is more');
const p2 = (await search(C, 'zebra', `&limit=2&before=${p1.results.at(-1).message.id}`)).j;
ok(p2.results.length >= 1 && p2.results.every((x) => x.message.id < p1.results.at(-1).message.id), 'before= continues past the last result');
ok(new Set([...p1.results, ...p2.results].map((x) => x.message.id)).size === p1.results.length + p2.results.length, 'pages do not overlap');

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
