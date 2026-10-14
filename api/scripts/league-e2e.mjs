// End-to-end check of the schedule, matchup, standings and bracket endpoints.
// Uses SYNTHETIC points (a team's strength decides its weekly score) — it verifies the math, not real results.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/league-e2e.mjs
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
const reg = async (email, teamId) => (await call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode: 'testcode' })).j.token;
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');

ok((await call('POST', '/seasons/push', null, K)).j.year === 2027, 'push to 2027');
ok((await call('POST', '/schedule', { startDate: '2027-03-29' }, C)).s === 403, 'only the commissioner builds the schedule');
ok((await call('POST', '/schedule', { startDate: '2027-03-30' }, K)).s === 400, 'start date must be a Monday');
const sch = await call('POST', '/schedule', { startDate: '2027-03-29' }, K);
ok(sch.s === 201 && sch.j.weeks === 26 && sch.j.matchups === 138, 'schedule created: 26 weeks, 138 regular-season matchups');
ok((await call('POST', '/schedule', { startDate: '2027-03-29' }, K)).s === 409, 'cannot create the schedule twice');

const wk = await get('/weeks?season=2027&asOf=2027-04-01', K);
ok(wk.weeks.length === 26 && wk.current === 1 && wk.weeks[0].start === '2027-03-29' && wk.weeks[0].end === '2027-04-04', 'week 1 is Mar 29 – Apr 4, current week = 1');
ok(wk.weeks[22].end === '2027-09-05' && wk.weeks[25].end === '2027-09-26', 'week 23 ends Sep 5, week 26 ends Sep 26');

const teams = (await get('/teams', K)).map((t) => t.id).sort();
ok(teams.length === 12, '12 teams');
const strength = Object.fromEntries(teams.map((t, i) => [t, 12 - i])); // teams[0] is strongest

// SYNTHETIC points: one row per team per week (on the Monday), score = 100 + strength*3 + week%4.
const monday = (w) => new Date(Date.parse('2027-03-29') + (w - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
const rows = [];
for (let w = 1; w <= 26; w++) for (const t of teams) rows.push(`INSERT INTO daily_points (season, date, team_id, player_id, slot, points) VALUES (2027, '${monday(w)}', '${t}', 1, 'C', ${100 + strength[t] * 3 + (w % 4)});`);
writeFileSync('/tmp/league-points.sql', rows.join('\n'));
execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/league-points.sql'], { cwd: apiDir, stdio: 'ignore' });

const m1 = await get('/matchups?season=2027&week=1&asOf=2027-04-10', K);
ok(m1.length === 6 && m1.every((m) => m.final), 'week 1 has 6 matchups and is final after Sunday');
ok(m1.every((m) => m.homeScore === 100 + strength[m.home] * 3 + 1 && m.awayScore === 100 + strength[m.away] * 3 + 1), 'weekly scores sum daily points');
const mid = await get('/matchups?season=2027&week=1&asOf=2027-04-01', K);
ok(mid.every((m) => !m.final), 'week 1 is not final mid-week');

// Independent recomputation of the standings from the API's own matchup scores.
const exp = Object.fromEntries(teams.map((t) => [t, { w: 0, l: 0, pf: 0, pa: 0 }]));
for (let w = 1; w <= 23; w++) for (const m of await get(`/matchups?season=2027&week=${w}&asOf=2027-10-01`, K)) {
  exp[m.home].pf += m.homeScore; exp[m.home].pa += m.awayScore; exp[m.away].pf += m.awayScore; exp[m.away].pa += m.homeScore;
  if (m.homeScore > m.awayScore) { exp[m.home].w++; exp[m.away].l++; } else { exp[m.away].w++; exp[m.home].l++; }
}
const st = await get('/standings?season=2027&asOf=2027-10-01', K);
ok(st.rows.length === 12 && st.rows.every((r) => r.played === 23 && r.remaining === 0), 'every team has played 23 games');
ok(st.rows.every((r) => r.w === exp[r.teamId].w && r.l === exp[r.teamId].l && Math.abs(r.pf - exp[r.teamId].pf) < 0.01 && Math.abs(r.pa - exp[r.teamId].pa) < 0.01), 'standings match an independent tally of W-L, PF, PA');
ok(st.rows[0].teamId === teams[0] && st.rows[0].w === 23 && st.rows[0].gb === 0, 'strongest team is 23-0 and leads');
ok(st.rows.slice(0, 6).every((r) => r.status === 'clinched') && st.rows.slice(6).every((r) => r.status === 'eliminated'), 'top 6 clinched, bottom 6 eliminated at season end');
ok(st.rows[0].streak === 'W23', 'streak W23');

const early = await get('/standings?season=2027&asOf=2027-04-14', K);
ok(early.rows.every((r) => r.played === 2) && early.rows.every((r) => r.status === 'alive'), 'two weeks in: 2 games each, everyone alive');
const none = await get('/standings?season=2027&asOf=2027-03-30', K);
ok(none.rows.every((r) => r.played === 0), 'before week 1 ends: no games counted');

const pre = await get('/bracket?season=2027&asOf=2027-08-01', K);
ok(pre.seeds.length === 0 && pre.matches.length === 0, 'no bracket until the regular season ends');
const br = await get('/bracket?season=2027&asOf=2027-10-01', K);
const by = Object.fromEntries(br.matches.map((m) => [m.id, m]));
const S = br.seeds;
ok(JSON.stringify(S) === JSON.stringify(teams.slice(0, 6)), 'seeds are the top six');
ok(by.QF1.a === S[2] && by.QF1.b === S[5] && by.QF2.a === S[3] && by.QF2.b === S[4], 'quarterfinals 3v6 and 4v5');
ok(by.SF1.a === S[0] && by.SF1.b === S[3] && by.SF2.a === S[1] && by.SF2.b === S[2], 'semifinals 1 v (4/5 winner), 2 v (3/6 winner)');
ok(by.FINAL.a === S[0] && by.FINAL.b === S[1] && by.FINAL.winner === S[0], 'championship: seed 1 beats seed 2');
ok(by.THIRD.a === S[3] && by.THIRD.b === S[2] && by.THIRD.winner === S[2], '3rd place: seed 3 beats seed 4');

for (const [w, n] of [[24, 2], [25, 2], [26, 2]]) {
  const pm = await get(`/matchups?season=2027&week=${w}&asOf=2027-10-01`, K);
  ok(pm.length === n && pm.every((m) => m.final), `week ${w} lists ${n} playoff matchups from the bracket`);
}
const fin = (await get('/matchups?season=2027&week=26&asOf=2027-10-01', K));
ok(fin.some((m) => m.home === S[0] && m.away === S[1]), 'week 26 includes the championship (seed 1 v seed 2)');
const bye = await get('/matchups?season=2027&week=24&asOf=2027-10-01', K);
ok(!bye.some((m) => [m.home, m.away].includes(S[0]) || [m.home, m.away].includes(S[1])), 'seeds 1 and 2 have a week-24 bye');
const live = await get('/matchups?season=2027&week=24&asOf=2027-09-08', K);
ok(live.length === 2 && live.every((m) => !m.final), 'a playoff week in progress is not final');

const tw = await get('/teams/AM/week?season=2027&week=2', K);
ok(tw.days.length === 7 && tw.days[0] === '2027-04-05' && tw.days[6] === '2027-04-11', 'team week lists 7 days (Mon–Sun)');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
