// End-to-end check of the Players tab backend: pool, watchlist, FAAB claims, waiver processing, drops, history.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/waivers-e2e.mjs
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
const sql = (q) => { writeFileSync('/tmp/waivers.sql', q); execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/waivers.sql'], { cwd: apiDir, stdio: 'ignore' }); };
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');
const shift = (d, n) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const today = (await get('/teams/AM/lineup', K)).today, yesterday = shift(today, -1);

await call('POST', '/seasons/push', null, K);
const cand = (await get('/keepers?season=2027', K)).candidates;
const keep = async (team, tok, n) => { const picks = cand.filter((c) => c.teamId === team && c.tier === 1 && c.cost).slice(0, n); for (const c of picks) await call('PUT', '/keepers', { teamId: team, playerId: c.playerId, kept: true }, tok); return picks; };
const amKeep = await keep('AM', K, 5), rcKeep = await keep('RC', C, 2);

const pool = async (qs, t = K) => (await get(`/players/pool?${qs}`, t)).players;
const free = await pool('limit=300');
ok(free.length === 300 && free.every((p) => !p.ownerId), 'free-agent pool excludes rostered players');
ok(!free.some((p) => amKeep.some((k) => k.playerId === p.id)), 'a kept player is not a free agent');

// Fill AM to 26 with $1 auction picks so we can test the roster limit
const fill = free.slice(0, 21);
for (const p of fill) await call('POST', '/draft/sales', { playerId: p.id, teamId: 'AM', price: 1 }, K);
ok((await get('/teams/AM/roster?season=2027', K)).slots.length === 26, 'AM roster is full (26)');

// Search + filters
ok((await pool('q=ohtani&owned=all')).length === 2, 'both Ohtanis found');
ok((await pool('q=acuna&owned=all')).some((p) => p.name.includes('Acuna')), 'search ignores accents');
ok((await pool('pos=SP&limit=300')).every((p) => p.positions.includes('SP')), 'position filter');
const byTeam = await pool('sort=team&limit=20');
ok(byTeam.every((p, i) => i === 0 || (byTeam[i - 1].mlbTeam ?? '') <= (p.mlbTeam ?? '')), 'sort by MLB team');

// Watchlist
const star = free[100];
await call('PUT', '/watchlist', { playerId: star.id, watched: true }, K);
ok((await pool('watch=1&owned=all')).map((p) => p.id).join() === String(star.id), 'watchlist shows only starred players');
ok((await pool('watch=1&owned=all', C)).length === 0, 'watchlists are per user');
await call('PUT', '/watchlist', { playerId: star.id, watched: false }, K);
ok((await pool('watch=1&owned=all')).length === 0, 'unstar removes it');

// Claim validation
const X = free[200], Y = free[201], Z = free[202];
const claim = (b, tok = K) => call('POST', '/claims', b, tok);
ok((await claim({ addPlayerId: X.id, bid: 5 }, C)).s === 201, 'RC can claim for their own team');
ok((await claim({ teamId: 'RC', addPlayerId: Z.id, bid: 5 }, K)).s === 201, 'the commissioner can claim for any team');
await call('DELETE', `/claims/${(await get('/claims?teamId=RC', K)).pending.find((p) => p.addId === Z.id).id}`, null, K);
ok((await claim({ teamId: 'AM', addPlayerId: X.id, bid: 5 }, C)).s === 403, 'owners can’t claim for other teams');
ok((await claim({ addPlayerId: amKeep[0].playerId, bid: 1 }, C)).s === 400, 'cannot claim a rostered player');
ok((await claim({ addPlayerId: Y.id, bid: 301 }, C)).s === 400, 'bid above FAAB rejected');
ok((await claim({ addPlayerId: Y.id, bid: -1 }, C)).s === 400 && (await claim({ addPlayerId: Y.id, bid: 1.5 }, C)).s === 400, 'bid must be a whole, non-negative number');
ok((await claim({ addPlayerId: X.id, bid: 9 }, C)).s === 400, 'duplicate pending claim rejected');
ok((await claim({ addPlayerId: X.id, bid: 25 }, K)).s === 400, 'AM’s full roster needs a drop');
ok((await claim({ addPlayerId: X.id, bid: 25, dropPlayerId: rcKeep[0].playerId }, K)).s === 400, 'cannot drop a player who isn’t yours');

// AM claims X with a drop; RC adds a second claim and we reorder
const dropAM = fill[0];
const amClaim = await claim({ addPlayerId: X.id, bid: 25, dropPlayerId: dropAM.id }, K);
ok(amClaim.s === 201, 'AM claims X for $25 dropping a bench-level player');
ok((await claim({ addPlayerId: Y.id, bid: 0 }, C)).s === 201, 'RC adds a $0 claim for Y');
let rc = await get('/claims', C);
ok(rc.pending.length === 2 && rc.pending[0].addId === X.id && rc.pending[1].addId === Y.id && rc.faab === 300, 'RC has two pending claims in priority order, $300 FAAB');
await call('PATCH', `/claims/${rc.pending[1].id}`, { move: 'up' }, C);
rc = await get('/claims', C);
ok(rc.pending[0].addId === Y.id && rc.pending.map((p) => p.priority).join() === '1,2', 'moving a claim up reorders priorities');
ok((await call('PATCH', `/claims/${rc.pending[0].id}`, { bid: 7 }, C)).s === 200 && (await get('/claims', C)).pending[0].bid === 7, 'bids are editable');
ok((await call('PATCH', `/claims/${rc.pending[0].id}`, { bid: 5000 }, C)).s === 400, 'edited bids are validated too');
ok((await call('PATCH', `/claims/${amClaim.j.id}`, { bid: 1 }, C)).s === 403, 'only the owner can edit a claim');

// Process: AM's $25 beats RC's $5 for X; RC's Y ($7) wins
ok((await call('POST', '/waivers/process', null, C)).s === 403, 'only the commissioner can run waivers');
const run = await call('POST', '/waivers/process', null, K);
ok(run.s === 200 && run.j.won === 2 && run.j.failed === 1, `processed: ${run.j.won} won, ${run.j.failed} failed`);
const am = await get('/claims?teamId=AM', K), rc2 = await get('/claims', C);
ok(am.recent[0].status === 'won' && am.faab === 275, 'AM won X and paid $25');
ok(rc2.recent.some((r) => r.addId === X.id && r.status === 'failed' && /no longer available/.test(r.reason)), 'RC’s losing claim records why it failed');
ok(rc2.faab === 293 && rc2.recent.some((r) => r.addId === Y.id && r.status === 'won'), 'RC won Y and paid $7');

const amRoster = (await get('/teams/AM/roster?season=2027', K)).slots;
ok(amRoster.length === 26 && amRoster.some((s) => s.playerId === X.id) && !amRoster.some((s) => s.playerId === dropAM.id), 'AM roster: X added, dropped player gone, still 26');
ok((await pool('limit=300', K)).concat(await pool('q=' + encodeURIComponent(dropAM.name), K)).some((p) => p.id === dropAM.id), 'the dropped player is a free agent again');
ok(!(await pool('limit=300')).some((p) => p.id === X.id), 'X is no longer a free agent');
const log = await get('/transactions', K);
ok(log.some((t) => t.type === 'waiver' && t.player === X.name && t.teamId === 'AM' && t.faab === 25) && log.some((t) => t.type === 'drop' && t.player === dropAM.name), 'activity log shows the waiver add and the drop');
ok((await call('POST', '/waivers/process', null, K)).j.won === 0, 'running waivers again is a no-op');

// History: yesterday AM had the dropped player and not X; RC didn't have Y
const amY = await get(`/teams/AM/lineup?date=${yesterday}`, K);
ok(amY.slots.some((s) => s.playerId === dropAM.id) && !amY.slots.some((s) => s.playerId === X.id), 'yesterday’s lineup still has the dropped player and not the new one');
ok((await get(`/teams/RC/lineup?date=${yesterday}`, K)).slots.every((s) => s.playerId !== Y.id), 'RC didn’t have Y yesterday');
ok((await get('/teams/RC/lineup', K)).slots.some((s) => s.playerId === Y.id), 'RC has Y today');
const xSlot = amRoster.find((s) => s.playerId === X.id).slot;
await call('PUT', '/teams/AM/lineup', { playerId: X.id, toSlot: xSlot.startsWith('B') ? 'Util2' : 'B6' }, K);
ok((await get(`/teams/AM/lineup?date=${yesterday}`, K)).slots.every((s) => s.playerId !== X.id), 'moving a newly added player does not backfill history');

// Immediate drop + lock
ok((await call('POST', '/roster/drop', { playerId: Y.id }, K)).s === 404, 'a drop applies to your own team; RC’s player isn’t on AM’s roster');
ok((await call('POST', '/roster/drop', { teamId: 'AM', playerId: amRoster[0].playerId }, C)).s === 403, 'an owner cannot drop players from another team');
ok((await call('POST', '/roster/drop', { playerId: 424242 }, C)).s === 404, 'dropping a player you don’t have is a 404');
const yTeam = (await get('/draft/players?season=2027', K)).find((p) => p.id === Y.id).mlbTeam;
sql(`INSERT INTO mlb_game (date, team, start_utc) VALUES ('${today}', '${yTeam}', '${new Date(Date.now() - 3600_000).toISOString().slice(0, 19)}Z');`);
ok((await call('POST', '/roster/drop', { playerId: Y.id }, C)).s === 409, 'a player whose game has started can’t be dropped');
sql('DELETE FROM mlb_game;');
const pend = await claim({ addPlayerId: Z.id, bid: 3, dropPlayerId: Y.id }, C);
ok((await call('POST', '/roster/drop', { playerId: Y.id }, C)).s === 200, 'RC drops Y immediately');
ok((await pool('q=' + encodeURIComponent(Y.name))).some((p) => p.id === Y.id), 'Y is back in the free-agent pool');
ok(!(await get('/teams/RC/roster?season=2027', K)).slots.some((s) => s.playerId === Y.id), 'and gone from RC’s roster');
ok((await get('/claims', C)).pending.find((p) => p.id === pend.j.id).dropId === null, 'a pending claim that was going to drop him loses its drop');

// Season rollover resets FAAB and cancels pending claims
await call('POST', '/seasons/push', null, K);
const teams = await get('/teams', K);
ok(teams.every((t) => t.faab === 300), 'push to 2028 resets everyone’s FAAB to $300');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
