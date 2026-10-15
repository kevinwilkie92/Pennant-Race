// End-to-end check of the nominated-player strip ("on the block"): permissions, validation, live delivery, clearing, late joiners.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/nominate-e2e.mjs
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
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC'), M = await reg('m@x.com', 'MJ');
if (![K, C, M].every(Boolean)) { console.log('FAIL could not register the test users (is the database fresh?)'); process.exit(1); }

const feeds = {};
const open = async (name, tok) => {
  const events = []; feeds[name] = events;
  const ws = new WebSocket(`ws://localhost:8787/draft/ws?token=${tok}`);
  ws.onmessage = (m) => events.push(JSON.parse(m.data));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return ws;
};
const nom = (name) => feeds[name].filter((e) => e.type === 'nomination');
const lastNom = (name) => nom(name).at(-1)?.nomination;
const waitNom = async (name, pred, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = nom(name).find(pred); if (e) return e; await sleep(50); } return null; };
const put = (b, tok = K) => call('PUT', '/draft/nomination', b, tok);

ok((await put({ playerId: 1 })).s === 409, 'with no live season there is nothing to nominate for');
await call('POST', '/seasons/push', null, K);
const ws = { C: await open('C', C), M: await open('M', M) };
const pool = (await get('/draft/players?season=2027', K));
const [p1, p2, p3, p4, p5] = pool;

ok((await put({ playerId: p1.id }, C)).s === 403, 'only the commissioner can nominate');
ok((await put({}, K)).s === 400 && (await put({ playerId: 'x' }, K)).s === 400, 'a bad request is a 400');
ok((await put({ playerId: 999999 })).s === 404, 'unknown player is a 404');

// nominate: everyone sees it, and it's in the draft state
const r1 = await put({ playerId: p1.id });
ok(r1.s === 200 && r1.j.nomination.name === p1.name, `nominate ${p1.name}`);
const e1 = await waitNom('C', (e) => e.nomination?.playerId === p1.id);
ok(e1 && (await waitNom('M', (e) => e.nomination?.playerId === p1.id)), 'other clients receive it live');
ok(e1.nomination.positions.length > 0 && e1.nomination.teamId === null && e1.nomination.bid === null, 'with his positions, and no leader or bid yet');
let st = await get('/draft/state?season=2027', C);
ok(st.nomination?.playerId === p1.id && st.nomination.name === p1.name, 'the draft state includes it (for anyone who opens the board)');

// leader and bid, updated as they change
ok((await put({ playerId: p1.id, teamId: 'RC', bid: 12 })).s === 200, 'set the leading team and bid');
ok(await waitNom('M', (e) => e.nomination?.teamId === 'RC' && e.nomination?.bid === 12), 'the update is broadcast');
ok((await put({ playerId: p1.id, teamId: 'MJ', bid: 15 })).s === 200 && (await get('/draft/state?season=2027', M)).nomination.bid === 15, 'it can change again; the state follows');
ok((await put({ playerId: p1.id, bid: 20 })).s === 200 && !!(await waitNom('C', (e) => e.nomination?.bid === 20 && e.nomination.teamId === null)), 'a bid with no leader is allowed');

// validation
ok((await put({ playerId: p1.id, bid: 0 })).s === 400 && (await put({ playerId: p1.id, bid: -3 })).s === 400 && (await put({ playerId: p1.id, bid: 1.5 })).s === 400, 'bids must be whole dollars of at least $1');
ok((await put({ playerId: p1.id, teamId: 'ZZ' })).s === 400, 'unknown team is rejected');
ok((await put({ playerId: p1.id, teamId: 'RC', bid: 999 })).s === 400, 'a bid above that team’s max bid is rejected');
ok(lastNom('C').bid === 20, 'a rejected update leaves the strip as it was');

// replacing it, and clearing it
await put({ playerId: p2.id });
ok(await waitNom('C', (e) => e.nomination?.playerId === p2.id), 'nominating another player replaces the first');
ok((await call('DELETE', '/draft/nomination', null, C)).s === 403, 'only the commissioner can clear it');
ok((await call('DELETE', '/draft/nomination', null, K)).s === 200 && await waitNom('M', (e) => e.nomination === null, 3000), 'clearing it tells everyone');
ok((await get('/draft/state?season=2027', C)).nomination === null, 'and the state is empty');
const before = nom('C').length;
await call('DELETE', '/draft/nomination', null, K); await sleep(500);
ok(nom('C').length === before, 'clearing when nothing is nominated sends nothing');

// recording the sale clears it
await put({ playerId: p3.id, teamId: 'RC', bid: 8 });
await waitNom('C', (e) => e.nomination?.playerId === p3.id);
const n0 = nom('C').length;
ok((await call('POST', '/draft/sales', { playerId: p3.id, teamId: 'RC', price: 8 }, K)).s === 201, 'record the sale');
ok(await waitNom('C', (e) => e.nomination === null && nom('C').length > n0), 'the strip clears when he is sold');
ok((await get('/draft/state?season=2027', C)).nomination === null, 'the state agrees');
ok((await put({ playerId: p3.id })).s === 409, 'a player who has already been drafted can’t be nominated');

// drawing the next team clears it
await put({ playerId: p4.id });
await waitNom('C', (e) => e.nomination?.playerId === p4.id);
const n1 = nom('C').length;
await call('POST', '/draft/hat', { mlbTeam: 'AZ' }, K);
ok(await waitNom('C', (e) => e.nomination === null && nom('C').length > n1), 'drawing a new team clears it');

// a client that connects mid-auction gets the current nomination straight away
await put({ playerId: p5.id, teamId: 'MJ', bid: 4 });
ws.late = await open('late', M);
ok(await waitNom('late', (e) => e.nomination?.playerId === p5.id && e.nomination.bid === 4 && e.nomination.teamId === 'MJ'), 'a late joiner receives it on connecting');

// a team with a full roster can't be the leader
await call('DELETE', '/draft/nomination', null, K);
const fill = pool.slice(10, 36);
for (const p of fill) await call('POST', '/draft/sales', { playerId: p.id, teamId: 'MV', price: 1 }, K);
ok((await put({ playerId: pool[40].id, teamId: 'MV', bid: 2 })).s === 400, 'a team with a full roster can’t lead the bidding');

for (const w of Object.values(ws)) w.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
