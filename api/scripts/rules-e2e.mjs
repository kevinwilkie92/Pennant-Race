// End-to-end check of the editable league rules: who can change them, validation, that the auction / keeper / FAAB /
// injured-list rules really change behaviour, the refusals that protect a season in progress, and that a scoring change
// recalculates every stored score.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/rules-e2e.mjs
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
const sql = (q) => { writeFileSync('/tmp/rules.sql', q); execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/rules.sql'], { cwd: apiDir, stdio: 'pipe' }); };
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');
const put = (b, t = K) => call('PUT', '/league/rules', b, t);
const rules = async () => (await get('/league/rules', C)).rules;

// ---- defaults, permissions, validation
const d = await get('/league/rules', C); if (!d.rules) console.log('rules response:', JSON.stringify(d));
ok(d.rules.budget === 300 && d.rules.minBid === 1 && d.rules.maxKeepers === 5 && d.rules.keeperIncrease === 5 && d.rules.faabBudget === 300 && d.rules.ilSlots === 4 && d.rules.hit.HR === 4 && d.rules.pit.QS === 5, 'the rules start at the league’s original values');
ok(d.defaults.budget === 300 && d.limits.budget.min === 100, 'any manager can read them (with the defaults and limits)');
ok((await call('GET', '/league/rules')).s === 401, 'reading needs a login');
ok((await put({ budget: 400 }, C)).s === 403, 'only a commissioner can change them');
for (const [bad, why] of [[{ budget: 50 }, 'budget below 100'], [{ budget: 250.5 }, 'fractional budget'], [{ minBid: 0 }, 'minimum bid 0'], [{ maxKeepers: 11 }, 'too many keepers'], [{ ilSlots: 9 }, 'too many IL slots'], [{ hit: { HR: 99 } }, 'scoring out of range'], [{ hit: { HR: 0.001 } }, 'scoring with 3 decimals'], [{ hit: { PUNT: 1 } }, 'an unknown stat'], [{ pit: { HR: 1 } }, 'a hitting stat in pitching'], [{ nope: 1 }, 'an unknown rule'], [{}, 'an empty change'], [{ budget: 100, minBid: 5 }, 'a budget a full roster cannot fit']]) {
  ok((await put(bad)).s === 400, `refuses ${why}`);
}
ok((await rules()).budget === 300, 'nothing changed after those refusals');
ok((await put({ budget: 300 })).j.changed.length === 0, 'saving the same values is a harmless no-op');

// ---- FAAB budget applies when the next season starts
ok((await put({ faabBudget: 150 })).j.rules.faabBudget === 150, 'set the FAAB budget to $150');
await call('POST', '/seasons/push', null, K);
ok((await get('/claims', C)).faab === 150, 'the new season starts every team with $150 of FAAB');

// ---- keepers: the limit and the cost increase
const kv = await get('/keepers?season=2027', K);
ok(kv.max === 5, 'the keeper limit shows in the keeper view');
const cands = kv.candidates.filter((c) => c.teamId === 'RC' && c.tier === 1 && c.lastPrice != null);
ok((await put({ keeperIncrease: 10 })).j.rules.keeperIncrease === 10 && (await get('/keepers?season=2027', K)).candidates.find((c) => c.playerId === cands[0].playerId).cost === cands[0].lastPrice + 10, 'a bigger keeper increase raises Year-1 costs');
await put({ keeperIncrease: 5 });
await put({ maxKeepers: 1 });
const keepers = (await get('/keepers?season=2027', C)).candidates.filter((c) => c.teamId === 'RC' && c.tier === 1 && c.cost).slice(0, 2);
ok((await call('PUT', '/keepers', { teamId: 'RC', playerId: keepers[0].playerId, kept: true }, C)).s === 200, 'one keeper fits a limit of 1');
ok((await call('PUT', '/keepers', { teamId: 'RC', playerId: keepers[1].playerId, kept: true }, C)).s === 400, 'a second is refused');
ok((await put({ maxKeepers: 0 })).s === 409, 'the limit cannot go below what a team already kept');
await put({ maxKeepers: 5 });

// ---- auction budget and minimum bid change what a bid may be
const pool = (await get('/draft/players?season=2027', K));
const p1 = pool[0], p2 = pool[1], p3 = pool[2];
ok((await put({ minBid: 2 })).s === 200 && (await call('POST', '/draft/sales', { playerId: p2.id, teamId: 'RC', price: 1 }, K)).s === 400, 'a higher minimum bid refuses a $1 bid');
const rcNow = (await get('/draft/state?season=2027', K)).managers.find((m) => m.teamId === 'RC');
ok(rcNow.maxBid === 300 - rcNow.spent - (26 - rcNow.filled - 1) * 2, `and holds back $2 per open spot (RC max bid ${rcNow.maxBid})`);
await put({ minBid: 1 });

let st = await get('/draft/state?season=2027', K);
const am0 = st.managers.find((m) => m.teamId === 'AM');
ok(st.rules.budget === 300 && am0.maxBid === 300 - (26 - am0.filled - 1), 'the draft state reports the budget and max bids');
await put({ budget: 400 });
st = await get('/draft/state?season=2027', K);
const am1 = st.managers.find((m) => m.teamId === 'AM');
ok(st.rules.budget === 400 && am1.remaining === am0.remaining + 100 && am1.maxBid === am0.maxBid + 100, 'a bigger budget raises everyone’s remaining money and max bid at once');
const over = am1.maxBid + 1;
ok((await call('POST', '/draft/sales', { playerId: p1.id, teamId: 'AM', price: over }, K)).s === 400, 'a bid above the new max is still refused');
ok((await call('POST', '/draft/sales', { playerId: p1.id, teamId: 'AM', price: am1.maxBid }, K)).s === 201, 'a bid right up to the new max is accepted');
ok((await put({ budget: 150 })).s === 409, 'the budget cannot drop below what a team has already spent');

// ---- injured-list slots
ok((await put({ ilSlots: 6 })).j.rules.ilSlots === 6, 'allow 6 injured-list slots');
const amRoster = (await get('/teams/AM/roster?season=2027', K)).slots;
const hurt = amRoster[0];
await call('PUT', `/players/${hurt.playerId}/status`, { status: 'IL' }, K);
ok((await call('PUT', '/teams/AM/lineup', { playerId: hurt.playerId, toSlot: 'IL6' }, K)).s === 200, 'an injured player can be moved into IL6');
ok((await call('PUT', '/teams/AM/lineup', { playerId: hurt.playerId, toSlot: 'IL7' }, K)).s === 400, '…but there is no IL7');
ok((await put({ ilSlots: 4 })).s === 409, 'IL slots cannot shrink while a player sits in a slot that would disappear');
await call('PUT', '/teams/AM/lineup', { playerId: hurt.playerId, toSlot: 'IL1' }, K);
ok((await put({ ilSlots: 4 })).s === 200, 'once he moves up, it can');

// ---- scoring: every stored score is recalculated
sql(`
  INSERT INTO player_game (game_pk, player_id, season, date, role, points, line_json, pos, started) VALUES
    (9001, ${p3.id}, 2027, '2027-04-05', 'H', 99, '{"1B":2,"HR":1,"SO":3,"R":1}', 'OF', 1),
    (9002, ${pool[3].id}, 2027, '2027-04-05', 'P', 99, '{"IP":6.333333333333333,"K":7,"QS":1,"ER":2,"H":5,"BB":1,"W":1}', 'P', 1);
`);
ok((await call('PUT', '/stats/players/' + p3.id + '/mlb-id', { mlbId: 1 }, K)).s === 200, '(test data in place)');
const sc = await put({ hit: { HR: 10, SO: -0.5 }, pit: { K: 2, QS: 8 } });
ok(sc.s === 200 && sc.j.rescored === true && sc.j.changed.length === 4, `a scoring change reports what changed and that it recalculated (${sc.j.changed?.join('; ')})`);
const lead = (await get('/players/stats?window=season', K)).players;
const h = lead.find((x) => x.id === p3.id), pit = lead.find((x) => x.id === pool[3].id);
ok(h && h.points === 2 * 1 + 10 + 1 - 3 * 0.5, `the hitter’s game is re-scored under the new values (${h?.points})`);
ok(pit && Math.abs(pit.points - (19 + 14 + 2 + 8 - 4 - 5 - 1)) < 0.1, `and so is the pitcher’s, quality start included (${pit?.points})`);
ok((await put({ faabBudget: 200 })).j.rescored === false, 'changing a non-scoring rule does not recalculate anything');
const back = await put({ reset: 'scoring' });
ok(back.j.rules.hit.HR === 4 && back.j.rules.pit.QS === 5 && back.j.rules.faabBudget === 200, 'resetting the scoring leaves other rules alone');
ok((await get('/players/stats?window=season', K)).players.find((x) => x.id === p3.id).points === 2 + 4 + 1 - 3, 'and scores go back to the original values');
ok((await put({ reset: 'all' })).s === 409, 'resetting everything is refused while the original budget would be less than a team has already spent');

// ---- history
const log = (await get('/league/settings', K)).audit.map((a) => a.detail);
ok(log.some((l) => /Rules changed by .*Hitting: Home run 4 → 10/.test(l) && /all scores recalculated/.test(l)) && log.some((l) => /Auction budget \$300 → \$400/.test(l)), 'every rules change is in the history with the old and new values');

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
