// End-to-end check of: injured list (IL), waiver period after drops, and the player card endpoint.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/extras-e2e.mjs
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
const sql = (q) => { writeFileSync('/tmp/extras.sql', q); execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/extras.sql'], { cwd: apiDir, stdio: 'ignore' }); };
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');
const shift = (d, n) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const today = (await get('/teams/AM/lineup', K)).today, yesterday = shift(today, -1);

await call('POST', '/seasons/push', null, K);
const cand = (await get('/keepers?season=2027', K)).candidates;
const keep = async (team, tok, n) => { for (const c of cand.filter((c) => c.teamId === team && c.tier === 1 && c.cost).slice(0, n)) await call('PUT', '/keepers', { teamId: team, playerId: c.playerId, kept: true }, tok); };
await keep('AM', K, 5); await keep('RC', C, 3);
const pool = async (qs, t = K) => (await get(`/players/pool?${qs}`, t)).players;
const fillers = (await pool('limit=60')).slice(0, 21).map((p) => p.id);
for (const id of fillers) await call('POST', '/draft/sales', { playerId: id, teamId: 'AM', price: 1 }, K);
const freeAgents = (await pool('limit=10&offset=150')).map((p) => p.id);
const roster = async (t) => (await get(`/teams/${t}/roster?season=2027`, K)).slots;
const lineup = async (t = 'AM', d) => get(`/teams/${t}/lineup${d ? `?date=${d}` : ''}`, K);
const slotOf = async (id, t = 'AM') => (await roster(t)).find((s) => s.playerId === id)?.slot;
const move = (playerId, toSlot, tok = K) => call('PUT', '/teams/AM/lineup', { playerId, toSlot }, tok);
const status = (id, st, tok = K) => call('PUT', `/players/${id}/status`, { status: st }, tok);
const claim = (b, tok = K) => call('POST', '/claims', b, tok);
const [f0, f1, f2, f3, f4, f5, f6] = fillers;
ok((await roster('AM')).length === 26, 'AM roster is full (26)');

// ============================================================ injured list
ok((await status(f0, 'IL', C)).s === 403, 'only the commissioner sets injury status');
ok((await status(f0, 'BROKEN')).s === 400, 'unknown status rejected');
ok((await status(999999, 'IL')).s === 404, 'unknown player rejected');
await status(f0, 'DTD');
ok((await lineup()).slots.find((s) => s.playerId === f0).injury === 'DTD', 'lineup shows his status');
ok((await move(f0, 'IL1')).s === 400, 'a day-to-day player can’t go on the injured list');
await status(f0, 'IL');
ok((await move(f0, 'IL1')).s === 200 && (await slotOf(f0)) === 'IL1', 'an IL player moves to IL1');
ok((await move(f1, 'IL2')).s === 400, 'a healthy player can’t take an IL slot');
const f1Slot = await slotOf(f1);
ok((await move(f0, f1Slot)).s === 400, 'swapping an IL player for a healthy one would put the healthy one on IL: refused');

// roster limit counts only active players
const A = freeAgents;
ok((await claim({ addPlayerId: A[0], bid: 1 })).s === 201, 'with one player on IL, AM (25 active) can add without a drop');
const run1 = await call('POST', '/waivers/process', null, K);
ok(run1.s === 200 && run1.j.won === 1, 'and the claim wins');
ok((await roster('AM')).length === 27 && (await lineup()).slots.filter((s) => !s.slot.startsWith('IL')).length === 26, 'AM has 27 players: 26 active + 1 on IL');
ok((await claim({ addPlayerId: A[1], bid: 1 })).s === 400, 'now at 26 active, another add needs a drop');
ok((await claim({ addPlayerId: A[1], bid: 1, dropPlayerId: f0 })).s === 400, 'dropping the IL player doesn’t free a spot');
ok((await claim({ addPlayerId: A[1], bid: 1, dropPlayerId: f6 })).s === 201, 'dropping an active player does');
const pend = (await get('/claims', K)).pending[0];
await call('DELETE', `/claims/${pend.id}`, null, K);

// the trade roster limit ignores IL players on the way out but not on the way in
const rcKeepers = await roster('RC');
const tr = (tok, b) => call('POST', '/trades', b, tok);
ok((await tr(K, { toTeam: 'RC', give: [f0], get: [rcKeepers[0].playerId] })).s === 400, 'trading away an IL player frees no active spot, so a 1-for-1 would put AM over');
ok((await tr(C, { toTeam: 'AM', give: [rcKeepers[0].playerId, rcKeepers[1].playerId], get: [f6] })).s === 400, 'receiving 2 for 1 puts AM over the active limit');
ok((await tr(K, { toTeam: 'RC', give: [f6], get: [rcKeepers[0].playerId] })).s === 201, 'an active-for-active 1-for-1 is fine');
await call('POST', `/trades/${(await get('/trades', K)).sent[0].id}/cancel`, null, K);

// the IL has four slots; swaps among injured players are fine
// f4 stands in for a benched player (anyone can swap with a bench slot, so the displaced IL player can go there)
const benched = (await lineup()).slots.find((s) => s.slot.startsWith('B') && ![f0, f1, f2, f3].includes(s.playerId)).playerId;
for (const id of [f1, f2, f3, benched]) await status(id, 'IL');
ok((await move(f1, 'IL2')).s === 200 && (await move(f2, 'IL3')).s === 200 && (await move(f3, 'IL4')).s === 200, 'fill IL2–IL4');
ok((await move(benched, 'IL1')).s === 200, 'an injured bench player swaps into IL1, sending the old occupant to the bench');
ok((await slotOf(f0)).startsWith('B'), 'the displaced player landed on the bench');
const inIL = (await lineup()).slots.filter((s) => s.slot.startsWith('IL'));
ok(inIL.length === 4 && new Set(inIL.map((s) => s.slot)).size === 4, 'the injured list never holds more than four');
ok((await move(benched, 'IL5')).s === 400, 'there is no fifth IL slot');
// IL players score nothing toward the day total
const starter = (await lineup()).slots.find((s) => !s.slot.startsWith('B') && !s.slot.startsWith('IL'));
sql(`INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${today}', 'AM', ${f1}, 'IL2', 30), (2027, '${today}', 'AM', ${starter.playerId}, '${starter.slot}', 5);`);
const l = await lineup();
ok(l.total === 5 && l.slots.find((s) => s.playerId === f1).points === 30, 'an IL player’s points are shown but not counted');
// healed players count against the limit again
await status(f1, null);
ok((await lineup()).slots.find((s) => s.playerId === f1).injury === null, 'clearing a status removes the badge');

// ============================================================ waiver period
ok((await get('/league/settings', K)).waiverDays === 2, 'the waiver period defaults to 2 days');
ok((await call('PUT', '/league/settings', { waiverDays: 5 }, C)).s === 403, 'only the commissioner changes it');
ok((await call('PUT', '/league/settings', { waiverDays: 99 }, K)).s === 400, 'out-of-range values rejected');
const d1 = f5;
ok((await call('POST', '/roster/drop', { playerId: d1 }, K)).s === 200, 'AM drops a player');
const inPool = async (id, name) => (await pool(`q=${encodeURIComponent(name)}&owned=all`)).find((p) => p.id === id);
const d1Name = (await get('/draft/players?season=2027', K)).find((p) => p.id === d1).name;
ok((await inPool(d1, d1Name)).waiversUntil === shift(today, 2), `he's on waivers until ${shift(today, 2)}`);
ok((await claim({ addPlayerId: d1, bid: 5 }, C)).s === 201, 'RC can still claim him');
const w0 = await call('POST', '/waivers/process', null, K);
ok(w0.j.deferred === 1 && w0.j.won === 0, 'the claim waits while he is on waivers');
ok(!(await roster('RC')).some((s) => s.playerId === d1) && (await get('/claims', C)).pending.length === 1, 'RC doesn’t have him and the claim is still pending');
ok((await get('/claims', C)).pending[0].waiversUntil === shift(today, 2), 'the pending claim shows when he clears');
ok((await call('POST', '/waivers/process', { asOf: shift(today, 1) }, K)).j.deferred === 1, 'one day later he is still on waivers');
const w2 = await call('POST', '/waivers/process', { asOf: shift(today, 2) }, K);
ok(w2.j.won === 1 && w2.j.deferred === 0, 'once the period clears, the claim wins');
ok((await roster('RC')).some((s) => s.playerId === d1) && !(await inPool(d1, d1Name)).waiversUntil, 'RC has him and the waiver flag is gone');

// a 0-day period: dropped players are claimable at the next run
await call('PUT', '/league/settings', { waiverDays: 0 }, K);
const d2 = f4 === undefined ? f6 : f6;
await call('POST', '/roster/drop', { playerId: d2 }, K);
const d2Name = (await get('/draft/players?season=2027', K)).find((p) => p.id === d2).name;
ok(!(await inPool(d2, d2Name)).waiversUntil, 'with a 0-day period there is no waiver hold');
await claim({ addPlayerId: d2, bid: 0 }, C);
ok((await call('POST', '/waivers/process', null, K)).j.won === 1, 'and the claim wins at the next run');
await call('PUT', '/league/settings', { waiverDays: 2 }, K);

// a drop made through a winning claim also goes on waivers
const dropped = (await roster('RC')).find((s) => s.playerId === d1);
await claim({ addPlayerId: A[2], bid: 0, dropPlayerId: d1 }, C);
await call('POST', '/waivers/process', null, K);
ok((await inPool(d1, d1Name)).waiversUntil === shift(today, 2) && dropped, 'a player dropped by a winning claim goes on waivers too');

// ============================================================ player card
const t1 = await tr(K, { toTeam: 'RC', give: [f2], get: [(await roster('RC'))[0].playerId] });
ok((await call('POST', `/trades/${t1.j.id}/accept`, null, C)).s === 200, 'a trade for the card’s history');
sql(`INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${yesterday}', 'AM', ${f2}, 'B1', 7), (2027, '${shift(today, -2)}', 'AM', ${f2}, 'B1', -3);`);
const card = await get(`/players/${f2}/card`, K);
ok(card.player.id === f2 && card.ownerId === 'RC', 'the card shows who owns him now');
ok(card.draft.some((d) => d.teamId === 'AM' && d.price === 1 && d.season === 2027), 'it shows his draft price');
ok(card.history.some((h) => h.type === 'trade' && h.teamId === 'RC' && h.from === 'AM'), 'the history includes the trade');
ok(card.points.length === 2 && card.seasonPoints === 4, `points by day: 7 and -3 (total ${card.seasonPoints})`);
const card1 = await get(`/players/${d1}/card`, K);
ok(card1.history.some((h) => h.type === 'waiver' && h.teamId === 'RC' && h.faab === 5) && card1.history.filter((h) => h.type === 'drop').length === 2, 'a waiver add and two drops are in the history');
ok(card1.waiversUntil === shift(today, 2), 'and he is on waivers');
ok((await call('GET', '/players/999999/card', null, K)).s === 404, 'unknown player is a 404');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
