// End-to-end check of keeper + season-push rules. Run against a FRESH local API:
//   rm -rf api/.wrangler; (cd api && echo JOIN_CODE=testcode > .dev.vars && npx wrangler d1 migrations apply pennant-race --local && npx wrangler dev)
//   node api/scripts/keepers-e2e.mjs   (consumes the DB: it pushes 2026 -> 2027 -> 2028)
const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const call = async (method, path, body, tok) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await call('GET', p, null, t)).j;
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');

const v26 = await get('/keepers?season=2026', K);
ok(v26.kept.length === 55 && v26.candidates.length === 0, `2026 archive: 55 recorded keepers, read-only (${v26.kept.length})`);

ok((await call('POST', '/seasons/push', null, C)).s === 403, 'non-commissioner cannot push');
const push = await call('POST', '/seasons/push', null, K);
ok(push.s === 201 && push.j.year === 2027, 'push 2026 -> 2027 live');

const v = await get('/keepers?season=2027', K);
const n = (t) => v.candidates.filter((c) => c.tier === t).length;
ok(v.candidates.length === 312, `312 rostered players are candidates (${v.candidates.length})`);
ok(n(1) === 257 && n(2) === 39 && n(0) === 16, `rollover buckets Y1=257 Y2=39 NotEligible=16 (got ${n(1)}/${n(2)}/${n(0)})`);
const y1 = v.candidates.filter((c) => c.tier === 1 && c.lastPrice != null);
ok(y1.every((c) => c.cost === c.lastPrice + 5), 'Year-1 cost = last price + $5');
ok(v.candidates.filter((c) => c.tier === 2).every((c) => c.cost === null), 'Year-2 cost unknown until ESPN average is set');

const mine = (t) => v.candidates.filter((c) => c.teamId === 'AM' && c.tier === t);
const am1 = mine(1), am2 = mine(2), am0 = mine(0);
ok(am1.length >= 6 && am2.length >= 1 && am0.length >= 1, `AM has Y1:${am1.length} Y2:${am2.length} NE:${am0.length}`);

// keep five Year-1s
for (const c of am1.slice(0, 5)) ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: c.playerId, kept: true }, K)).s === 200, `keep ${c.name} for $${c.cost}`);
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: am1[5].playerId, kept: true }, K)).s === 400, 'sixth keeper rejected');
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: am0[0].playerId, kept: true }, K)).s === 400, 'not-eligible player rejected');
const st = await get('/draft/state?season=2027', K);
const amMoney = st.managers.find((m) => m.teamId === 'AM');
const total = am1.slice(0, 5).reduce((a, c) => a + c.cost, 0);
ok(amMoney.spent === total && amMoney.filled === 5 && amMoney.maxBid === 300 - total - 20, `budget reflects keepers: spent $${amMoney.spent}, max bid $${amMoney.maxBid}`);
ok(st.sales.filter((s) => s.isKeeper).length === 5, 'keepers appear as is_keeper sales');

// A live season has no frozen roster yet: the roster endpoint slots the draft sales (keepers) itself.
const live27 = await get('/teams/AM/roster?season=2027', K);
ok(live27.slots.length === 5 && live27.slots.every((x) => x.slot && x.keeperYear === 1 && x.price > 0), `live-season roster is built from keepers (${live27.slots.length} slotted)`);
ok(live27.slots.some((x) => x.name === 'Kyle Bradish' && x.slot.startsWith('SP')) && live27.slots.some((x) => x.name === 'Seiya Suzuki' && x.slot.startsWith('OF')), 'keepers land in the right slots (SP, OF)');
const wk27 = await get('/teams/AM/week?season=2027&week=1', K);
ok(wk27.slots.length === 5, 'the weekly matchup view shows the same roster');

// release one, then Year 2 flow
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: am1[0].playerId, kept: false }, K)).s === 200, 'release a keeper');
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: am2[0].playerId, kept: true }, K)).s === 400, 'Year-2 keeper blocked until avg salary set');
ok((await call('PUT', '/player-values', { playerId: am2[0].playerId, avgSalary: 20.6 }, C)).s === 403, 'only commissioner sets avg salary');
ok((await call('PUT', '/player-values', { playerId: am2[0].playerId, avgSalary: 20.6 }, K)).s === 200, 'commissioner sets avg salary');
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: am2[0].playerId, kept: true }, K)).s === 200, 'Year-2 keeper allowed');
const after = (await get('/keepers?season=2027', K)).kept.find((k) => k.playerId === am2[0].playerId);
ok(after.cost === 21 && after.year === 2, `Year-2 cost is rounded ESPN avg (${after?.cost}), year ${after?.year}`);

// permissions
const rc = v.candidates.filter((c) => c.teamId === 'RC' && c.tier === 1);
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: am1[1].playerId, kept: false }, C)).s === 403, "owner cannot edit another team's keepers");
ok((await call('PUT', '/keepers', { teamId: 'RC', playerId: rc[0].playerId, kept: true }, C)).s === 200, 'owner can keep for own team');
ok((await call('PUT', '/keepers', { teamId: 'RC', playerId: am1[1].playerId, kept: true }, C)).s === 400, "cannot keep another team's player");

// lock once the auction starts
const pool = await get('/draft/players?season=2027', K);
const free = pool.find((p) => !(st.sales.some((s) => s.playerId === p.id)) && !v.candidates.some((c) => c.playerId === p.id));
ok((await call('POST', '/draft/sales', { playerId: free.id, teamId: 'AM', price: 3 }, K)).s === 201, 'auction sale recorded');
ok((await call('PUT', '/keepers', { teamId: 'AM', playerId: am1[1].playerId, kept: true }, K)).s === 409, 'keepers locked after auction starts');
const undo = await call('DELETE', '/draft/sales/last', null, K);
ok(undo.s === 200 && undo.j.seq > 0, 'undo removes the auction sale, never a keeper');
ok((await get('/draft/state?season=2027', K)).sales.filter((s) => s.isKeeper).length === 6, 'all 6 keepers still present after undo');

// push from a live season freezes rosters and rolls years forward
const p2 = await call('POST', '/seasons/push', null, K);
ok(p2.s === 201 && p2.j.year === 2028, 'push 2027 -> 2028');
const seasons = await get('/seasons', K);
ok(seasons.find((s) => s.year === 2027).status === 'archived' && seasons.find((s) => s.year === 2028).status === 'live', '2027 archived, 2028 live');
const r27 = await get('/teams/AM/roster?season=2027', K);
ok(r27.slots.length === 5, `2027 AM roster frozen with its 5 keepers (${r27.slots.length})`);
const v28 = await get('/keepers?season=2028', K);
const yr1kept = v28.candidates.find((c) => c.playerId === am1[2].playerId);
ok(yr1kept && yr1kept.tier === 2, 'a Year-1 keeper in 2027 is Year-2 eligible in 2028');
const yr2kept = v28.candidates.find((c) => c.playerId === am2[0].playerId);
ok(yr2kept && yr2kept.tier === 0, 'a Year-2 keeper in 2027 is not eligible in 2028');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
