// End-to-end check of lineup editing: eligibility, swaps, permissions, locks, and daily history.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/lineup-e2e.mjs
// Uses SYNTHETIC game start times / points to exercise the rules.
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
const sql = (q) => { writeFileSync('/tmp/lineup.sql', q); execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/lineup.sql'], { cwd: apiDir, stdio: 'ignore' }); };
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');

const shift = (d, n) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const today = (await get('/teams/AM/lineup', K)).today;
const yesterday = shift(today, -1), tomorrow = shift(today, 1);

// Before a live season: archived 2026 is read-only.
const a26 = await get('/teams/AM/lineup', K);
ok(a26.season === 2026 && a26.editable === false && a26.slots.length === 26, '2026 archive: 26 slots, not editable');
ok((await call('PUT', '/teams/AM/lineup', { playerId: a26.slots[0].playerId, toSlot: 'B1' }, K)).s === 409, 'archived lineups are frozen');

await call('POST', '/seasons/push', null, K);
const cand = (await get('/keepers?season=2027', K)).candidates.filter((c) => c.teamId === 'AM' && c.tier === 1 && c.cost);
const want = ['Kyle Bradish', 'Trevor Rogers', 'Seiya Suzuki', 'Kevin McGonigle', 'Jeremy Pena'];
for (const n of want) await call('PUT', '/keepers', { teamId: 'AM', playerId: cand.find((c) => c.name === n).playerId, kept: true }, K);

const lu = async (date) => get(`/teams/AM/lineup${date ? `?date=${date}` : ''}`, K);
const slotOf = (l, name) => l.slots.find((s) => s.name === name)?.slot;
const put = (body, tok = K) => call('PUT', '/teams/AM/lineup', body, tok);
const id = (name) => cand.find((c) => c.name === name).playerId;

let l = await lu();
ok(l.season === 2027 && l.editable && l.slots.length === 5, 'live season: 5 slotted keepers, editable');
const start = Object.fromEntries(l.slots.map((s) => [s.name, s.slot]));
ok(start['Seiya Suzuki'] === 'OF1' && start['Kyle Bradish'] === 'SP1' && start['Trevor Rogers'] === 'SP2', `draft-derived slots (${JSON.stringify(start)})`);

// Eligibility
ok((await put({ playerId: id('Seiya Suzuki'), toSlot: 'SP3' })).s === 400, 'an outfielder cannot take an SP slot');
ok((await put({ playerId: id('Kyle Bradish'), toSlot: 'RP1' })).s === 400, 'an SP-only pitcher cannot take an RP slot');
ok((await put({ playerId: id('Seiya Suzuki'), toSlot: 'Nope' })).s === 400, 'unknown slot rejected');
ok((await put({ playerId: 999999, toSlot: 'B1' })).s === 404, 'unknown player rejected');

// Move into an empty slot, then bench and back
ok((await put({ playerId: id('Seiya Suzuki'), toSlot: 'Util1' })).s === 200, 'move to an empty slot (OF1 -> Util1)');
l = await lu(); ok(slotOf(l, 'Seiya Suzuki') === 'Util1', 'lineup shows the move');
ok(slotOf(await get('/teams/AM/roster?season=2027', K), 'Seiya Suzuki') === 'Util1', 'the stored roster reflects it');
ok((await put({ playerId: id('Trevor Rogers'), toSlot: 'B1' })).s === 200 && slotOf(await lu(), 'Trevor Rogers') === 'B1', 'bench a pitcher');
ok((await put({ playerId: id('Trevor Rogers'), toSlot: 'SP2' })).s === 200 && slotOf(await lu(), 'Trevor Rogers') === 'SP2', 'bring him back');

// Swap two players (SS <-> IF): both are shortstops
const mc = slotOf(l, 'Kevin McGonigle'), pe = slotOf(l, 'Jeremy Pena');
ok((await put({ playerId: id('Kevin McGonigle'), toSlot: pe })).s === 200, `swap ${mc} <-> ${pe}`);
l = await lu(); ok(slotOf(l, 'Kevin McGonigle') === pe && slotOf(l, 'Jeremy Pena') === mc, 'both players traded slots');
// A swap is refused if the displaced player can't fill the vacated slot
ok((await put({ playerId: id('Kyle Bradish'), toSlot: slotOf(l, 'Seiya Suzuki') })).s === 400, 'cannot swap a pitcher into the outfielder’s Util slot');

// Permissions
ok((await put({ playerId: id('Seiya Suzuki'), toSlot: 'OF1' }, C)).s === 403, 'another owner cannot edit this lineup');

// Past days can't be edited; history shows the lineup as it was
ok((await put({ date: yesterday, playerId: id('Seiya Suzuki'), toSlot: 'OF1' })).s === 400, 'cannot edit a past day');
const past = await lu(yesterday);
ok(slotOf(past, 'Seiya Suzuki') === 'OF1' && slotOf(past, 'Kevin McGonigle') === mc, 'yesterday still shows the original lineup (history)');
ok(past.editable === false, 'past days are not editable');

// Points on a past day belong to the slot he held that day
sql(`INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${yesterday}', 'AM', ${id('Seiya Suzuki')}, 'OF1', 11.5);
     INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${yesterday}', 'AM', ${id('Kyle Bradish')}, 'SP1', 7);
     INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${yesterday}', 'AM', ${id('Trevor Rogers')}, 'SP2', 4);`);
const py = await lu(yesterday);
ok(py.slots.find((s) => s.name === 'Seiya Suzuki').points === 11.5 && py.total === 22.5, `yesterday's total sums the slots he held that day (${py.total})`);

// Bench players don't count toward the day's total.
await put({ playerId: id('Trevor Rogers'), toSlot: 'B1' });
sql(`INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${today}', 'AM', ${id('Kyle Bradish')}, 'SP1', 3);
     INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${today}', 'AM', ${id('Trevor Rogers')}, 'B1', 40);`);
const pt = await lu();
ok(pt.total === 3 && pt.slots.find((s) => s.name === 'Trevor Rogers').points === 40, `a benched player's points are shown but not counted (${pt.total})`);
await put({ playerId: id('Trevor Rogers'), toSlot: 'SP2' });
ok((await lu(yesterday)).total === 22.5, 'moving him back does not change yesterday');

// Future-dated edits leave today alone
ok((await put({ date: tomorrow, playerId: id('Seiya Suzuki'), toSlot: 'OF2' })).s === 200, 'schedule a change for tomorrow');
ok(slotOf(await lu(), 'Seiya Suzuki') === 'Util1' && slotOf(await lu(tomorrow), 'Seiya Suzuki') === 'OF2', 'today unchanged, tomorrow shows the new slot');
ok(slotOf(await get('/teams/AM/roster?season=2027', K), 'Seiya Suzuki') === 'Util1', 'the stored (today) roster is untouched by a future edit');

// First-pitch lock (synthetic game start 1 hour ago for Suzuki's team CHC; none for others)
const ago = new Date(Date.now() - 3600_000).toISOString().slice(0, 19) + 'Z';
sql(`INSERT INTO mlb_game (date, team, start_utc) VALUES ('${today}', 'CHC', '${ago}');`);
l = await lu();
ok(l.slots.find((s) => s.name === 'Seiya Suzuki').locked === true && l.slots.filter((s) => s.locked).length === 1, 'only the player whose game started is locked');
ok((await put({ playerId: id('Seiya Suzuki'), toSlot: 'B2' })).s === 409, 'a locked player cannot be moved');
ok((await put({ playerId: id('Kevin McGonigle'), toSlot: slotOf(l, 'Seiya Suzuki') })).s === 409, 'nobody can swap into a locked player’s slot');
ok((await put({ playerId: id('Jeremy Pena'), toSlot: 'B3' })).s === 200, 'other players can still be moved');
ok((await put({ date: tomorrow, playerId: id('Seiya Suzuki'), toSlot: 'OF3' })).s === 200, 'locks only apply to today; tomorrow is open');
sql(`DELETE FROM mlb_game;
     INSERT INTO mlb_game (date, team, start_utc) VALUES ('${today}', 'CHC', '${new Date(Date.now() + 3600_000).toISOString().slice(0, 19)}Z');`);
ok((await lu()).slots.every((s) => !s.locked), 'a game that has not started yet does not lock anyone');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
