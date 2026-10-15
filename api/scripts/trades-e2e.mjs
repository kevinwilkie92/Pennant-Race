// End-to-end check of trades: validation, permissions, accept/reject/cancel, stale offers, uneven trades,
// same-day reversals (lineup history), the first-pitch lock, and the commissioner veto.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/trades-e2e.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const call = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await call('GET', p, null, t)).j;
const sql = (q) => { writeFileSync('/tmp/trades.sql', q); execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/trades.sql'], { cwd: apiDir, stdio: 'ignore' }); };
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');
const shift = (d, n) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const today = (await get('/teams/AM/lineup', K)).today, yesterday = shift(today, -1);

await call('POST', '/seasons/push', null, K);
const cand = (await get('/keepers?season=2027', K)).candidates;
const keep = async (team, tok, n) => { for (const c of cand.filter((c) => c.teamId === team && c.tier === 1 && c.cost).slice(0, n)) await call('PUT', '/keepers', { teamId: team, playerId: c.playerId, kept: true }, tok); };
await keep('AM', K, 5); await keep('RC', C, 4);
const pool = (await get('/players/pool?limit=60', K)).players;
for (const p of pool.slice(0, 21)) await call('POST', '/draft/sales', { playerId: p.id, teamId: 'AM', price: 1 }, K);

const roster = async (t) => (await get(`/teams/${t}/roster?season=2027`, K)).slots;
const ids = (r) => r.map((s) => s.playerId);
let am = await roster('AM'), rc = await roster('RC');
ok(am.length === 26 && rc.length === 4, `AM has 26 players, RC has 4`);
const amF = am.filter((s) => !s.keeperYear);              // AM's $1 fillers
const [a1, a2, a3, a4, a5] = amF.map((s) => s.playerId);
const [r1, r2, r3, r4] = rc.map((s) => s.playerId);
const offer = (tok, b) => call('POST', '/trades', b, tok);
const trades = async (tok, team) => get(`/trades${team ? `?teamId=${team}` : ''}`, tok);

// --- validation
ok((await offer(K, { toTeam: 'AM', give: [a1], get: [a2] })).s === 400, 'cannot trade with yourself');
ok((await offer(K, { toTeam: 'RC', give: [], get: [r1] })).s === 400, 'both sides need a player');
ok((await offer(K, { toTeam: 'ZZ', give: [a1], get: [r1] })).s === 400, 'unknown team');
ok((await offer(K, { toTeam: 'RC', give: [r1], get: [r2] })).s === 400, 'cannot offer a player you don’t have');
ok((await offer(K, { toTeam: 'RC', give: [a1], get: [a2] })).s === 400, 'cannot ask for a player they don’t have');
ok((await offer(K, { toTeam: 'RC', give: [a1], get: [r1, r2] })).s === 400, 'AM (26) can’t take two for one: roster limit');
ok((await offer(C, { toTeam: 'AM', give: [r1, r2], get: [a1] })).s === 400, 'RC can’t send AM two for one: AM would be over the limit');
ok((await offer(K, { toTeam: 'RC', give: amF.slice(0, 6).map((s) => s.playerId), get: [r1] })).s === 400, 'at most 5 players per side');

// --- propose, list, permissions
const o1 = await offer(K, { toTeam: 'RC', give: [a1], get: [r1] });
ok(o1.s === 201, 'AM offers a1 for r1');
let tAM = await trades(K), tRC = await trades(C);
ok(tAM.sent.length === 1 && tAM.received.length === 0 && tRC.received.length === 1 && tRC.sent.length === 0, 'sent for AM, received for RC');
ok(tRC.received[0].give[0].id === a1 && tRC.received[0].get[0].id === r1 && tRC.received[0].problem === null, 'offer details include players, no problems');
ok((await call('POST', `/trades/${o1.j.id}/accept`, null, K)).s === 403, 'the proposer can’t accept their own offer');
ok((await call('POST', `/trades/${o1.j.id}/reject`, null, K)).s === 403, 'the proposer can’t reject it either');
ok((await call('POST', `/trades/${o1.j.id}/cancel`, null, C)).s === 403, 'the recipient can’t cancel it');

// --- reject
ok((await call('POST', `/trades/${o1.j.id}/reject`, null, C)).s === 200, 'RC rejects');
ok((await call('POST', `/trades/${o1.j.id}/accept`, null, C)).s === 409, 'a rejected offer can’t be accepted');
ok((await trades(K)).history[0].status === 'rejected', 'rejected offers move to history');

// --- accept 1-for-1
const o2 = await offer(K, { toTeam: 'RC', give: [a1], get: [r1] });
ok((await call('POST', `/trades/${o2.j.id}/accept`, null, C)).s === 200, 'RC accepts');
am = await roster('AM'); rc = await roster('RC');
ok(am.length === 26 && rc.length === 4, 'roster sizes unchanged after a 1-for-1');
ok(ids(am).includes(r1) && !ids(am).includes(a1) && ids(rc).includes(a1) && !ids(rc).includes(r1), 'the players changed teams');
ok(new Set(am.map((s) => s.slot)).size === 26 && new Set(rc.map((s) => s.slot)).size === 4, 'every slot holds one player');
ok(!(await get('/players/pool?limit=300', K)).players.some((p) => [a1, r1].includes(p.id)), 'neither player became a free agent');
const lu = async (t, d) => (await get(`/teams/${t}/lineup${d ? `?date=${d}` : ''}`, K)).slots;
ok((await lu('AM', yesterday)).some((s) => s.playerId === a1) && !(await lu('AM', yesterday)).some((s) => s.playerId === r1), 'yesterday AM still had a1, not r1');
ok((await lu('RC', yesterday)).some((s) => s.playerId === r1) && !(await lu('RC', yesterday)).some((s) => s.playerId === a1), 'yesterday RC still had r1, not a1');
ok((await lu('AM')).some((s) => s.playerId === r1) && (await lu('RC')).some((s) => s.playerId === a1), 'today they’re swapped');
const act = await get('/transactions', K);
const tr = act.find((x) => x.type === 'trade');
ok(tr && JSON.parse(tr.detail).give.length === 1 && JSON.parse(tr.detail).to === 'RC', 'the activity log records the trade');
ok((await trades(C)).history[0].status === 'accepted', 'accepted offers move to history');

// --- same-day reversal (the history key includes the team)
const back = await offer(C, { toTeam: 'AM', give: [a1], get: [r1] });
ok((await call('POST', `/trades/${back.j.id}/accept`, null, K)).s === 200, 'the same two players are traded back the same day');
ok(ids(await roster('AM')).includes(a1) && ids(await roster('RC')).includes(r1), 'both are home again');
ok((await lu('AM')).some((s) => s.playerId === a1) && !(await lu('AM')).some((s) => s.playerId === r1), 'today’s AM lineup is correct after the reversal');
ok((await lu('RC', yesterday)).some((s) => s.playerId === r1) && (await lu('AM', yesterday)).some((s) => s.playerId === a1), 'yesterday is untouched by the round trip');

// --- stale offers are cancelled when a player is traded elsewhere
const o3 = await offer(K, { toTeam: 'RC', give: [a2], get: [r2] });
const o4 = await offer(K, { toTeam: 'RC', give: [a2], get: [r3] });
ok((await call('POST', `/trades/${o3.j.id}/accept`, null, C)).s === 200, 'accept the first offer');
const hist = (await trades(K)).history;
ok(hist.find((o) => o.id === o4.j.id)?.status === 'cancelled', 'the competing offer is cancelled automatically');
ok((await call('POST', `/trades/${o4.j.id}/accept`, null, C)).s === 409, 'and can’t be accepted afterwards');

// --- a waiver claim whose drop was traded away loses that drop
const fa = (await get('/players/pool?limit=5&offset=100', K)).players[0];
const cl = await call('POST', '/claims', { addPlayerId: fa.id, bid: 2, dropPlayerId: a3 }, K);
ok(cl.s === 201, 'AM has a pending claim that drops a3');
const o5 = await offer(K, { toTeam: 'RC', give: [a3], get: [r4] });
await call('POST', `/trades/${o5.j.id}/accept`, null, C);
ok((await get('/claims', K)).pending.find((p) => p.id === cl.j.id).dropId === null, 'trading a3 away clears it from the pending claim');

// --- uneven trade (2 for 1) and roster counts
const rcBefore = await roster('RC');
const o6 = await offer(K, { toTeam: 'RC', give: [a4, a5], get: [rcBefore[0].playerId] });
ok(o6.s === 201 && (await call('POST', `/trades/${o6.j.id}/accept`, null, C)).s === 200, 'a 2-for-1 trade goes through');
ok((await roster('AM')).length === 25 && (await roster('RC')).length === rcBefore.length + 1, `AM now has 25, RC has ${rcBefore.length + 1}`);

// --- first-pitch lock
const amNow = await roster('AM');
const victim = amNow.find((s) => s.mlbTeam && !s.keeperYear);
const rcNow = await roster('RC');
const o7 = await offer(K, { toTeam: 'RC', give: [victim.playerId], get: [rcNow[0].playerId] });
ok(o7.s === 201, 'an offer is created before the game starts');
sql(`INSERT INTO mlb_game (date, team, start_utc) VALUES ('${today}', '${victim.mlbTeam}', '${new Date(Date.now() - 3600_000).toISOString().slice(0, 19)}Z');`);
ok((await call('POST', `/trades/${o7.j.id}/accept`, null, C)).s === 409, 'cannot accept once a player’s game has started');
ok((await offer(K, { toTeam: 'RC', give: [victim.playerId], get: [rcNow[1].playerId] })).s === 409, 'cannot propose a locked player either');
ok((await trades(C)).received.find((o) => o.id === o7.j.id).problem?.includes('game has started'), 'the pending list explains why');
sql('DELETE FROM mlb_game;');
ok((await trades(C)).received.find((o) => o.id === o7.j.id).problem === null, 'the problem clears once nothing is locked');

// --- cancel / veto
ok((await call('POST', `/trades/${o7.j.id}/cancel`, null, K)).s === 200, 'the proposer withdraws an offer');
const o8 = await offer(C, { toTeam: 'AM', give: [rcNow[2].playerId], get: [amNow[0].playerId] });
ok((await call('POST', `/trades/${o8.j.id}/cancel`, null, K)).s === 200, 'the commissioner can cancel someone else’s offer (veto)');
ok((await trades(C)).history.find((o) => o.id === o8.j.id).status === 'cancelled', 'it shows as cancelled');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
