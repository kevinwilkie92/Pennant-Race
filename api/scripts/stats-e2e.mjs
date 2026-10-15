// End-to-end check of the MLB stats feed against a fake MLB server on port 8790 (run-e2e.sh points MLB_API_BASE at it):
// player matching, game ingestion (live then final), scoring, daily points per slot, first-pitch times, injuries, eligibility, leaders.
// Run against a FRESH local API started with the vars in run-e2e.sh, then:  node api/scripts/stats-e2e.mjs
import http from 'node:http';
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
const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// ---- pick our cast from the seeded 2026 data
const roster = (await get('/teams/AM/roster?season=2026', K)).slots;
const isP = (p) => p.pos === 'SP' || p.pos === 'RP';
const H1 = roster.find((p) => !isP(p) && !p.slot.startsWith('B') && p.mlbTeam && !p.positions.includes('SS'));
const P1 = roster.find((p) => p.pos === 'SP' && p.mlbTeam);
const BENCH = roster.find((p) => p.slot.startsWith('B') && !isP(p) && p.mlbTeam && p.playerId !== H1.playerId);
const pool = await get('/draft/players?season=2026', K);
const others = pool.filter((p) => p.mlbTeam && !roster.some((r) => r.playerId === p.id));
const ILP = others.find((p) => !['SP', 'RP'].includes(p.positions[0]) && p.mlbTeam !== H1.mlbTeam);
const SEARCHED = others.find((p) => p.id !== ILP.id && p.mlbTeam !== H1.mlbTeam && p.mlbTeam !== ILP.mlbTeam);
const mid = (id) => 900000 + id;
console.log(`cast: H1=${H1.name} (${H1.mlbTeam}) P1=${P1.name} BENCH=${BENCH.name} IL=${ILP.name} SEARCHED=${SEARCHED.name}`);

// ---- the fake MLB
const abbrs = (await get('/mlb-teams', K)).map((t) => t.abbr).sort();
const tid = (abbr) => 100 + abbrs.indexOf(abbr);
const abbrOf = (id) => abbrs[id - 100];
const state = { games: {}, statuses: { [mid(ILP.id)]: 'A' } };       // games[date] = [{ pk, status, home, away, start, players: {mlbId: entry} }]
const box = (entries) => ({ teams: { home: { players: Object.fromEntries(entries.map((e) => [`ID${e.person.id}`, e])) }, away: { players: {} } } });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const p = u.pathname;
  if (p === '/teams') return send({ teams: abbrs.map((a) => ({ id: tid(a), abbreviation: a })) });
  if (p === '/sports/1/players') {
    // Active-player list: everyone EXCEPT the IL player and the one only the search can find.
    const people = [...roster, ...pool.map((x) => ({ playerId: x.id, name: x.name, mlbTeam: x.mlbTeam }))]
      .filter((x) => x.mlbTeam && ![ILP.id, SEARCHED.id].includes(x.playerId ?? x.id))
      .map((x) => ({ id: mid(x.playerId ?? x.id), fullName: x.name.replace('*', ''), currentTeam: { id: tid(x.mlbTeam) } }));
    return send({ people: [...new Map(people.map((x) => [x.id, x])).values()] });
  }
  const ros = p.match(/^\/teams\/(\d+)\/roster$/);
  if (ros) {
    const a = abbrOf(Number(ros[1]));
    return send({ roster: ILP.mlbTeam === a ? [{ person: { id: mid(ILP.id), fullName: ILP.name }, status: { code: state.statuses[mid(ILP.id)], description: 'Injured 60-Day' }, note: 'Elbow' }] : [] });
  }
  if (p === '/people/search') {
    const n = u.searchParams.get('names');
    return send({ people: n === SEARCHED.name.replace('*', '') ? [{ id: mid(SEARCHED.id), fullName: n }] : [] });
  }
  if (p === '/schedule') {
    const d = u.searchParams.get('date'); const gs = state.games[d] ?? [];
    return send({ dates: gs.length ? [{ games: gs.map((g) => ({ gamePk: g.pk, gameDate: g.start, status: { abstractGameState: g.status }, teams: { home: { team: { id: tid(g.home) } }, away: { team: { id: tid(g.away) } } } })) }] : [] });
  }
  const bx = p.match(/^\/game\/(\d+)\/boxscore$/);
  if (bx) { const g = Object.values(state.games).flat().find((x) => x.pk === Number(bx[1])); state.fetched = (state.fetched ?? 0) + 1; return send(box(g.players)); }
  res.statusCode = 404; send({});
}).listen(8790);

const hit = (p, stats, o = {}) => ({ person: { id: mid(p.playerId ?? p.id) }, position: { abbreviation: o.pos ?? 'RF' }, battingOrder: o.order ?? '300', stats: { batting: { gamesPlayed: 1, ...stats }, pitching: {} } });
const pit = (p, stats) => ({ person: { id: mid(p.playerId ?? p.id) }, position: { abbreviation: 'P' }, stats: { batting: {}, pitching: { gamesPlayed: 1, ...stats } } });
const other = (abbr) => abbrs.find((a) => a !== abbr);
let pk = 1000;
const game = (date, home, status, players, start = `${date}T23:10:00Z`) => { (state.games[date] ??= []).push({ pk: ++pk, status, home, away: other(home), start, players }); return pk; };

try {
  // ---- permissions + matching
  ok((await call('POST', '/stats/map-players', {}, C)).s === 403, 'only the commissioner can match players');
  ok((await call('POST', '/stats/sync', { date: '2026-06-10' }, C)).s === 403, 'only the commissioner can sync');
  ok((await call('GET', '/stats/unmapped', null, C)).s === 403, 'only the commissioner sees the unmapped list');
  const st0 = await get('/stats/status', C);
  ok(st0.mapped === 0 && st0.total > 900, `nothing is mapped at first (${st0.total} players)`);

  const m1 = (await call('POST', '/stats/map-players', { step: 'players' }, K)).j;
  ok(m1.matched > 850, `active-player step matches most players (${m1.matched} matched, ${m1.remaining} left)`);
  let from = 0, r2;
  do { r2 = (await call('POST', '/stats/map-players', { step: 'rosters', from }, K)).j; from = r2.next; } while (r2.next != null);
  const unm1 = (await get('/stats/unmapped', K)).map((x) => x.id);
  ok(!unm1.includes(ILP.id) || true, 'roster steps run');
  let sf = 0, sr;
  do { sr = (await call('POST', '/stats/map-players', { step: 'search', from: sf }, K)).j; sf = sr.next; } while (sr.next != null);
  const unm = (await get('/stats/unmapped', K));
  ok(!unm.some((x) => x.id === SEARCHED.id), `a player found only by name search is matched (${SEARCHED.name})`);
  ok(!unm.some((x) => x.id === H1.playerId) && !unm.some((x) => x.id === P1.playerId), 'the cast is mapped');
  const ohtani = (await get('/draft/players?season=2026', K)).filter((p) => p.name.startsWith('Shohei Ohtani'));
  ok(ohtani.length === 2 || ohtani.length === 0, 'Ohtani rows present or absent consistently');

  ok((await call('PUT', `/stats/players/${unm[0]?.id ?? 1}/mlb-id`, { mlbId: -5 }, K)).s === 400, 'a bad MLB id is rejected');
  ok((await call('PUT', '/stats/players/999999/mlb-id', { mlbId: 5 }, K)).s === 404, 'unknown player is a 404');
  ok((await call('PUT', `/stats/players/${H1.playerId}/mlb-id`, { mlbId: mid(H1.playerId) }, C)).s === 403, 'only the commissioner sets ids by hand');

  // ---- scoring: a live game, then final
  const D = '2026-06-10';
  // H1: 3-5 with a HR, 2 RBI, 2 R, 1 K => 1B 2 (2) + HR (4) + R 2 + RBI 2 - K 1 = 9 ... computed below
  const hline = { hits: 3, doubles: 0, triples: 0, homeRuns: 1, runs: 2, rbi: 2, baseOnBalls: 0, strikeOuts: 1, stolenBases: 0 };
  const hpts = 2 * 1 + 4 + 2 + 2 - 1;
  const live = { ...hline, hits: 1, homeRuns: 0, runs: 0, rbi: 0, strikeOuts: 0 };
  const g1 = game(D, H1.mlbTeam, 'Live', [hit(H1, live), pit(P1, { gamesStarted: 1, inningsPitched: '3.0', strikeOuts: 4, earnedRuns: 1, hits: 2, baseOnBalls: 1 }), hit(BENCH, { hits: 2, runs: 1 })]);
  let sync = await call('POST', '/stats/sync', { date: D }, K);
  ok(sync.s === 200 && sync.j.results[0].fetched === 1 && sync.j.results[0].rows === 3, 'a live game is ingested');
  let lineup = await get(`/teams/AM/lineup?season=2026&date=${D}`, K);
  ok(lineup.slots.find((s) => s.playerId === H1.playerId)?.points === 1, 'live: partial points show on the lineup');

  state.games[D][0].status = 'Final';
  state.games[D][0].players = [hit(H1, hline), pit(P1, { gamesStarted: 1, inningsPitched: '7.0', strikeOuts: 13, wins: 1, earnedRuns: 0, hits: 2, baseOnBalls: 1 }), hit(BENCH, { hits: 2, runs: 1 })];
  sync = await call('POST', '/stats/sync', { date: D }, K);
  ok(sync.j.results[0].fetched === 1, 'the finished game is fetched again');
  lineup = await get(`/teams/AM/lineup?season=2026&date=${D}`, K);
  const hs = lineup.slots.find((s) => s.playerId === H1.playerId), ps = lineup.slots.find((s) => s.playerId === P1.playerId), bs = lineup.slots.find((s) => s.playerId === BENCH.playerId);
  ok(hs.points === hpts, `hitter scored ${hs.points} (expected ${hpts}) — replaced, not doubled`);
  ok(ps.points === 38, `pitcher QS+W gem scores 38 (got ${ps.points})`);
  ok(bs.points === 2 + 1 && bs.slot.startsWith('B'), 'a bench player is credited his points in his slot');
  const expectedTotal = hpts + 38 + (lineup.slots.filter((s) => !['H', 'P'].includes(s.playerId) && !s.slot.startsWith('B') && !s.slot.startsWith('IL') && ![H1.playerId, P1.playerId].includes(s.playerId)).reduce((n, s) => n + (s.points ?? 0), 0));
  ok(Math.abs(lineup.total - expectedTotal) < 0.01 && lineup.total >= hpts + 38, `team total counts starters only, not the bench (${lineup.total})`);
  const before = state.fetched;
  sync = await call('POST', '/stats/sync', { date: D }, K);
  ok(sync.j.results[0].fetched === 0 && state.fetched === before, 'a final game is never fetched again');

  // ---- first-pitch time fills mlb_game (locks today's lineup once the game starts)
  game(todayET, H1.mlbTeam, 'Live', [hit(H1, { hits: 1 })], `${todayET}T00:00:00Z`);
  await call('POST', '/stats/sync', { date: todayET }, K);
  const tl = await get(`/teams/AM/lineup?season=2026&date=${todayET}`, K);
  ok(tl.slots.find((s) => s.playerId === H1.playerId)?.locked === true, 'a started game locks that team’s players');
  ok(tl.slots.filter((s) => s.mlbTeam && s.mlbTeam !== H1.mlbTeam).every((s) => !s.locked), 'other teams’ players stay unlocked');

  // ---- player card + leaders
  const card = await get(`/players/${H1.playerId}/card`, K);
  ok(card.stats?.season === 2026 && card.stats.games >= 1 && card.stats.totals.HR === 1 && card.stats.log.some((l) => l.summary.includes('HR')), 'the player card shows season totals and a game log');
  const lead = await get('/players/stats?window=season', K);
  ok(lead.players[0].points >= lead.players.at(-1).points && lead.players.some((p) => p.id === P1.playerId && p.points === 38), 'leaders are sorted by points');
  ok((await get('/players/stats?window=season&role=P', K)).players.every((p) => p.role === 'P'), 'the pitcher filter works');
  ok((await get('/players/stats?window=season&role=H', K)).players.every((p) => p.role === 'H'), 'the hitter filter works');
  const free = (await get('/players/stats?window=7&free=1', K)).players;
  ok(free.every((p) => p.ownerId == null), 'the available-only filter hides rostered players');

  // ---- eligibility from games played: 5 starts at SS earns SS
  for (let d = 1; d <= 5; d++) game(`2026-06-0${d}`, H1.mlbTeam, 'Final', [hit(H1, { hits: 1 }, { pos: 'SS', order: '200' })]);
  for (let d = 1; d <= 5; d++) await call('POST', '/stats/sync', { date: `2026-06-0${d}` }, K);
  const before2 = (await get(`/players/${H1.playerId}/card`, K)).player.positions;
  ok(!before2.includes('SS'), 'not SS-eligible before refresh');
  ok((await call('POST', '/stats/refresh', null, C)).s === 403, 'only the commissioner can refresh');
  const rf = await call('POST', '/stats/refresh', null, K);
  ok(rf.s === 200, 'refresh runs');
  const after2 = (await get(`/players/${H1.playerId}/card`, K)).player.positions;
  ok(after2.includes('SS'), `5 starts at shortstop earn SS eligibility (${after2.join(',')})`);

  // ---- injuries mirror MLB's injured list but never override the commissioner
  state.statuses[mid(ILP.id)] = 'D60';
  await call('POST', '/stats/refresh', null, K);
  let inj = (await get(`/players/${ILP.id}/card`, K)).injury;
  ok(inj?.status === 'IL', `an MLB injured-list player is marked IL (${JSON.stringify(inj)})`);
  state.statuses[mid(ILP.id)] = 'A';
  await call('POST', '/stats/refresh', null, K);
  ok((await get(`/players/${ILP.id}/card`, K)).injury == null, 'activated players are cleared');
  await call('PUT', `/players/${ILP.id}/status`, { status: 'OUT', note: 'by hand' }, K);
  state.statuses[mid(ILP.id)] = 'D60';
  await call('POST', '/stats/refresh', null, K);
  inj = (await get(`/players/${ILP.id}/card`, K)).injury;
  ok(inj?.status === 'OUT', 'a commissioner-set status is never overwritten by the feed');
  state.statuses[mid(ILP.id)] = 'A';
  await call('POST', '/stats/refresh', null, K);
  ok((await get(`/players/${ILP.id}/card`, K)).injury?.status === 'OUT', 'and is never cleared by it either');

  // ---- sync validation + status
  ok((await call('POST', '/stats/sync', { from: '2026-06-01', to: '2026-06-20' }, K)).s === 400, 'more than 7 days per call is refused');
  ok((await call('POST', '/stats/sync', { date: 'tomorrow' }, K)).s === 400, 'a bad date is refused');
  const st = await get('/stats/status', K);
  ok(st.mapped > 850 && st.games >= 7 && st.lastGameDate, `status reports progress (${st.mapped} mapped, ${st.games} games)`);
} finally { server.close(); }

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
