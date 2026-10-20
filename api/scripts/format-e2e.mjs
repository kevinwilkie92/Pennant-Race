// End-to-end check of the editable roster layout and season format: validation, the draft/roster size following the
// layout, refusals that protect existing rosters, schedules built from the season rules, and rebuilding a schedule.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/format-e2e.mjs
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
const sql = (q) => { writeFileSync('/tmp/format.sql', q); execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/format.sql'], { cwd: apiDir, stdio: 'pipe' }); };
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');
const put = (b, t = K) => call('PUT', '/league/rules', b, t);

// ---- validation
for (const [bad, why] of [[{ roster: { OF: 99 } }, 'too many outfield slots'], [{ roster: { OF: -1 } }, 'a negative slot count'], [{ roster: { XX: 1 } }, 'an unknown slot type'],
  [{ roster: { C: 0, '1B': 0, '2B': 0, '3B': 0, SS: 0, IF: 0, OF: 0, UTIL: 0 } }, 'no hitter slots'], [{ roster: { SP: 0, RP: 0 } }, 'no pitcher slots'],
  [{ roster: { BN: 0, OF: 0, UTIL: 0, SP: 0, RP: 1, IF: 0 } }, 'a roster under 10 players'], [{ playoffTeams: 1 }, 'a one-team playoff'], [{ playoffTeams: 9 }, 'more than 8 playoff teams'],
  [{ regularWeeks: 0 }, 'zero regular weeks'], [{ regularWeeks: 26 }, 'a season longer than 26 weeks']]) {
  ok((await put(bad)).s === 400, `refuses ${why}`);
}
ok((await put({ roster: { BN: 3 } }, C)).s === 403, 'only a commissioner can change the layout');
ok((await get('/league/rules', C)).rules.roster.OF === 4, 'layout unchanged after refusals');

await call('POST', '/seasons/push', null, K);
// ---- a bigger roster: draft size follows the layout
ok((await put({ roster: { BN: 8 } })).j.rules.roster.BN === 8, 'bench raised to 8');
let st = await get('/draft/state?season=2027', K);
ok(st.rules.rosterSize === 28, 'draft state reports a 28-player roster');
const am = st.managers.find((m) => m.teamId === 'AM');
ok(am.maxBid === 300 - (28 - am.filled - 1), 'max bid holds back a dollar for each of the 28 spots');
ok((await get('/teams/AM/roster?season=2027', K)).slots.length >= 0, 'the roster endpoint still answers');

// ---- shrinking below what a team holds is refused (put a full roster on AM first)
const pool = await get('/draft/players?season=2027', K);
const labels = ['C', '1B', '2B', '3B', 'SS', 'IF', 'OF1', 'OF2', 'OF3', 'OF4', 'Util1', 'Util2', 'SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2', 'RP3', 'RP4', ...Array.from({ length: 8 }, (_, i) => `B${i + 1}`)];
sql(`DELETE FROM roster_slot WHERE season = 2027 AND team_id = 'AM';` + labels.map((l, i) => `INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (2027, 'AM', ${pool[i].id}, '${l}');`).join(''));
const r1 = await put({ roster: { BN: 2 } });
ok(r1.s === 409, `shrinking below a team’s players is refused (${r1.j.error ?? r1.j.reason ?? ''})`);
ok((await get('/league/rules', C)).rules.roster.BN === 8, 'and the layout is unchanged');
sql(`DELETE FROM roster_slot WHERE season = 2027 AND team_id = 'AM';`);
ok((await put({ roster: { BN: 6 } })).s === 200, 'back to 6 on the bench once the roster is empty');

// ---- season format drives the schedule
ok((await put({ regularWeeks: 10, playoffTeams: 4 })).s === 200, 'set 10 regular weeks and a 4-team playoff');
const sch = await call('POST', '/schedule', { startDate: '2027-03-29' }, K);
ok(sch.s === 201 && sch.j.weeks === 12 && sch.j.matchups === 60, `schedule: 12 weeks (10 + 2 playoff rounds), 60 matchups (${JSON.stringify(sch.j)})`);
ok((await put({ regularWeeks: 20, playoffTeams: 8 })).s === 200, 'rules can change after the schedule exists');
const st2 = await get('/standings?season=2027&asOf=2027-09-01', K);
ok(st2.playoffTeams === 4 && st2.regularWeeks === 10, 'the existing season keeps its own format');
const wk = await get('/weeks?season=2027&asOf=2027-04-01', K);
ok((wk.weeks ?? wk).length === 12, 'weeks list still has 12 weeks');

// ---- rebuild
ok((await call('DELETE', '/schedule?season=2027', null, C)).s === 403, 'only a commissioner removes a schedule');
sql(`INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '2027-04-01', 'AM', ${pool[0].id}, 'OF1', 5);`);
const refused = await call('DELETE', '/schedule?season=2027', null, K);
ok(refused.s === 409, 'removal refused once scores exist');
sql(`DELETE FROM daily_points WHERE season = 2027;`);
ok((await call('DELETE', '/schedule?season=2027', null, K)).s === 200, 'removal works with no scores');
const sch2 = await call('POST', '/schedule', { startDate: '2027-03-29' }, K);
ok(sch2.s === 201 && sch2.j.weeks === 23 && sch2.j.matchups === 120, `rebuilt with the new rules: 20 + 3 rounds (${JSON.stringify(sch2.j)})`);
const st3 = await get('/standings?season=2027&asOf=2027-09-01', K);
ok(st3.playoffTeams === 8 && st3.regularWeeks === 20, 'standings now use the 8-team, 20-week format');
ok((await put({ playoffTeams: 0 })).s === 200, 'no-playoff rule can be set');
await call('DELETE', '/schedule?season=2027', null, K);
const sch3 = await call('POST', '/schedule', { startDate: '2027-03-29' }, K);
ok(sch3.s === 201 && sch3.j.weeks === 20, 'no playoffs: just the regular weeks');
const br = await get('/bracket?season=2027&asOf=2027-12-01', K);
ok(br.matches.length === 0, 'no bracket when there are no playoffs');
ok((await put({ playoffTeams: 12, regularWeeks: 10 })).s === 400, 'more than 8 playoff teams is refused');
await call('DELETE', '/schedule?season=2027', null, K);
ok((await put({ playoffTeams: 8, regularWeeks: 10 })).s === 200, 'set 8 teams');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
