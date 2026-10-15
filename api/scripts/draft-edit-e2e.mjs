// End-to-end check of editing an archived draft (price, team, remove) and its guard rails.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/draft-edit-e2e.mjs
const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const call = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await call('GET', p, null, t)).j;
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');
if (![K, C].every(Boolean)) { console.log('FAIL could not register the test users (is the database fresh?)'); process.exit(1); }

const sales = async (yr) => (await get(`/draft/state?season=${yr}`, K)).sales;
const url = (yr, pid) => `/draft/archive/${yr}/sales/${pid}`;
await call('POST', '/seasons/push', null, K);
const s26 = await sales(2026);
const a = s26.find((s) => !s.isKeeper && s.teamId === 'AM');
ok((await call('PATCH', url(2026, a.playerId), { price: 5 }, C)).s === 403, 'non-commissioner cannot edit');
ok((await call('PATCH', url(2026, a.playerId), {}, K)).s === 400, 'an empty edit is rejected');
ok((await call('PATCH', url(2026, a.playerId), { price: 0 }, K)).s === 400, 'price must be at least $1');
ok((await call('PATCH', url(2026, a.playerId), { price: 2.5 }, K)).s === 400, 'price must be a whole number');
ok((await call('PATCH', url(2026, a.playerId), { price: 9999 }, K)).s === 400, 'price cannot break the $300 budget');
ok((await call('PATCH', url(2026, a.playerId), { teamId: 'ZZZ' }, K)).s === 400, 'unknown team rejected');
ok((await call('PATCH', url(2026, 999999), { price: 5 }, K)).s === 404, 'a player who was not drafted is a 404');
ok((await call('PATCH', url(1999, a.playerId), { price: 5 }, K)).s === 404, 'an unknown season is a 404');

const before = a.price;
const newPrice = before === 7 ? 8 : 7;
const r1 = await call('PATCH', url(2026, a.playerId), { price: newPrice }, K);
ok(r1.s === 200, `change price $${before} -> $${newPrice}`);
ok((await sales(2026)).find((s) => s.playerId === a.playerId).price === newPrice, 'the new price is in the draft log');
const st = await get('/draft/state?season=2026', K);
ok(st.managers.find((m) => m.teamId === 'AM').spent === s26.filter((s) => s.teamId === 'AM').reduce((t, s) => t + s.price, 0) - before + newPrice, "team's spend follows the edit");

// A full team can't take another player; free a spot first.
const rc = s26.find((s) => !s.isKeeper && s.teamId === 'RC');
ok((await call('PATCH', url(2026, a.playerId), { teamId: 'RC' }, K)).s === 400, 'a full roster cannot receive a player');
const rcRoster = (await get('/teams/RC/roster?season=2026', K)).slots;
ok((await call('DELETE', url(2026, rc.playerId), null, C)).s === 403, 'non-commissioner cannot remove a sale');
ok((await call('DELETE', url(2026, rc.playerId), null, K)).s === 200, 'remove a sale');
ok(!(await sales(2026)).some((s) => s.playerId === rc.playerId), 'the sale is gone from the log');
const rcAfter = (await get('/teams/RC/roster?season=2026', K)).slots;
ok(rcAfter.length === rcRoster.length - 1 && !rcAfter.some((x) => x.playerId === rc.playerId), 'and from his team\'s roster');

const mv = await call('PATCH', url(2026, a.playerId), { teamId: 'RC' }, K);
ok(mv.s === 200, `move ${a.name} to RC (${mv.j.error ?? 'ok'})`);
ok((await sales(2026)).find((s) => s.playerId === a.playerId).teamId === 'RC', 'the log shows the new team');
const rcFinal = (await get('/teams/RC/roster?season=2026', K)).slots;
const amFinal = (await get('/teams/AM/roster?season=2026', K)).slots;
ok(rcFinal.some((x) => x.playerId === a.playerId) && !amFinal.some((x) => x.playerId === a.playerId), 'he moved rosters too');
ok(new Set(rcFinal.map((x) => x.slot)).size === rcFinal.length, 'no two players share a slot');

// Keeper lock: a player kept into 2027 can't be edited in 2026.
const kv = await get('/keepers?season=2027', K);
const cand = kv.candidates.find((c) => c.tier === 1 && c.teamId === 'AM' && c.cost != null);
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: cand.playerId, kept: true }, K)).s === 200, `keep ${cand.name} for 2027`);
ok((await call('PATCH', url(2026, cand.playerId), { price: 3 }, K)).s === 409, 'a player kept into a later season is locked');
ok((await call('DELETE', url(2026, cand.playerId), null, K)).s === 409, '... and cannot be removed');
const keeperSale = (await sales(2027)).find((s) => s.isKeeper);
ok((await call('PATCH', url(2027, keeperSale.playerId), { price: 3 }, K)).s === 409, 'the live 2027 season is not editable here');

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
