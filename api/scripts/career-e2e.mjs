// End-to-end check of career stats against a fake MLB server on port 8790 (run-e2e.sh points MLB_API_BASE at it):
// season rows, traded players, league-rules points, quality starts counted from game logs, caching, stale fallback,
// two-way players, and the error cases.
// Run against a FRESH local API started with the vars in run-e2e.sh, then:  node api/scripts/career-e2e.mjs
import http from 'node:http';
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
const sql = (q) => { writeFileSync('/tmp/career.sql', q); execFileSync('npx', ['wrangler', 'd1', 'execute', 'pennant-race', '--local', '--file', '/tmp/career.sql'], { cwd: apiDir, stdio: 'pipe' }); };
const K = await reg('k@x.com', 'AM'), C = await reg('c@x.com', 'RC');

const pool = await get('/draft/players?season=2026', K);
const hitter = pool.find((p) => p.positions[0] === 'OF' && p.mlbTeam), pitcher = pool.find((p) => p.positions[0] === 'SP' && p.mlbTeam), unmatched = pool.find((p) => p.positions[0] === '1B' && p.mlbTeam);
const ohtB = pool.find((p) => p.name === 'Shohei Ohtani (Batter)'), ohtP = pool.find((p) => p.name === 'Shohei Ohtani (Pitcher)');
const MH = 810001, MP = 810002, MO = 810003, MBAD = 810004;
const gl = (gs, ip, er) => ({ stat: { gamesStarted: gs, inningsPitched: ip, earnedRuns: er } });
const calls = { yby: 0, log: 0 };
let down = false;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const send = (o, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (down && u.pathname !== '/teams') return send({ error: 'down' }, 503);
  if (u.pathname === '/teams') return send({ teams: [{ id: 111, abbreviation: 'BOS' }, { id: 147, abbreviation: 'NYY' }, { id: 119, abbreviation: 'LAD' }] });
  const m = u.pathname.match(/^\/people\/(\d+)\/stats$/);
  if (!m) return send({}, 404);
  const id = Number(m[1]), kind = u.searchParams.get('stats'), group = u.searchParams.get('group');
  if (kind === 'yearByYear') {
    calls.yby++;
    if (id === MBAD) return send({ stats: [{ splits: [] }] });
    if (group === 'hitting' && (id === MH || id === MO)) return send({ stats: [{ splits: [
      { season: '2024', team: { id: 111 }, stat: { gamesPlayed: 100, atBats: 400, hits: 120, doubles: 20, triples: 2, homeRuns: 30, runs: 80, rbi: 90, stolenBases: 5, baseOnBalls: 50, intentionalWalks: 5, strikeOuts: 100 } },
      { season: '2025', team: { id: 111 }, stat: { gamesPlayed: 60, atBats: 200, hits: 50, doubles: 10, triples: 0, homeRuns: 10, runs: 30, rbi: 35, stolenBases: 2, baseOnBalls: 20, intentionalWalks: 0, strikeOuts: 60 } },
      { season: '2025', team: { id: 147 }, stat: { gamesPlayed: 50, atBats: 190, hits: 60, doubles: 12, triples: 1, homeRuns: 15, runs: 35, rbi: 40, stolenBases: 3, baseOnBalls: 25, intentionalWalks: 1, strikeOuts: 50 } },
      { season: '2025', numTeams: 2, stat: { gamesPlayed: 110, atBats: 390, hits: 110, doubles: 22, triples: 1, homeRuns: 25, runs: 65, rbi: 75, stolenBases: 5, baseOnBalls: 45, intentionalWalks: 1, strikeOuts: 110 } },
    ] }] });
    if (group === 'pitching' && (id === MP || id === MO)) return send({ stats: [{ splits: [
      { season: '2024', team: { id: 119 }, stat: { gamesPlayed: 30, gamesStarted: 30, inningsPitched: '180.1', wins: 14, losses: 8, strikeOuts: 190, earnedRuns: 65, hits: 150, baseOnBalls: 40, completeGames: 1, shutouts: 1, saves: 0, holds: 0 } },
      { season: '2025', team: { id: 119 }, stat: { gamesPlayed: 12, gamesStarted: 12, inningsPitched: '66.2', wins: 5, losses: 3, strikeOuts: 70, earnedRuns: 20, hits: 55, baseOnBalls: 15, completeGames: 0, shutouts: 0, saves: 0, holds: 0 } },
    ] }] });
    return send({ stats: [{ splits: [] }] });
  }
  if (kind === 'gameLog') {
    calls.log++;
    const season = u.searchParams.get('season');
    const logs = season === '2024' ? [gl(1, '7.0', 2), gl(1, '6.0', 3), gl(1, '6.0', 4), gl(1, '8.0', 0), gl(0, '7.0', 0)] : [gl(1, '6.1', 1), gl(1, '5.0', 0)];
    return send({ stats: [{ splits: logs }] });
  }
  send({}, 404);
}).listen(8790);

const career = async (id, t = K) => call('GET', `/players/${id}/career`, null, t);
try {
  // map by hand (the matching itself is covered by stats-e2e)
  for (const [p, m] of [[hitter, MH], [pitcher, MP], [ohtB, MO], [ohtP, MO], [unmatched, MBAD]]) await call('PUT', `/stats/players/${p.id}/mlb-id`, { mlbId: m }, K);
  await call('PUT', `/stats/players/${unmatched.id}/mlb-id`, { mlbId: null }, K);

  ok((await call('GET', `/players/${hitter.id}/career`)).s === 401, 'career needs a login');
  ok((await career(999999)).s === 404, 'unknown player is a 404');
  const un = (await career(unmatched.id)).j;
  ok(un.available === false && /not been matched/.test(un.reason) && un.seasons.length === 0, 'a player not matched to MLB says so');

  // ---- a hitter who was traded mid-2025
  const h = (await career(hitter.id)).j;
  ok(h.available && h.role === 'H' && h.seasons.map((x) => x.season).join() === '2024,2025', 'a hitter’s seasons are listed oldest first, one row each');
  ok(h.seasons[0].teams.join() === 'BOS' && h.seasons[1].teams.join() === 'BOS,NYY', 'a traded season shows both teams');
  ok(h.seasons[1].stats.g === 110 && h.seasons[1].stats.hr === 25, 'and uses the all-teams total, not one stint');
  // 2024: singles 120-20-2-30=68; 2B 40; 3B 6; HR 120; BB 45 + IBB 5; R 80; RBI 90; SB 10; SO -100  => 68+40+6+120+45+5+80+90+10-100
  ok(h.seasons[0].points === 68 + 40 + 6 + 120 + 45 + 5 + 80 + 90 + 10 - 100, `2024 fantasy points follow the league rules (${h.seasons[0].points})`);
  ok(Math.abs(h.totals.points - (h.seasons[0].points + h.seasons[1].points)) < 0.01 && h.totals.stats.g === 210 && h.totals.stats.hr === 55, 'career totals add up the seasons');

  // ---- a pitcher: quality starts come from the game log
  const p = (await career(pitcher.id)).j;
  ok(p.role === 'P' && p.seasons[0].stats.qs === 3 && p.seasons[1].stats.qs === 1, `quality starts are counted from game logs (${p.seasons.map((s) => s.stats.qs).join(',')})`);
  ok(p.seasons[0].stats.outs === 541 && p.seasons[0].stats.k === 190, 'innings are kept as outs (180.1 IP = 541 outs)');
  const ip = 541 / 3;
  ok(Math.abs(p.seasons[0].points - (ip * 3 + 190 + 28 + 15 + 3 + 3 - 130 - 150 - 40)) < 0.01, `2024 pitching points include the +5 per quality start (${p.seasons[0].points})`);
  ok(calls.log === 2, 'one game-log request per season');

  // ---- caching
  const before = { ...calls };
  const again = (await career(pitcher.id)).j;
  ok(JSON.stringify(again.seasons) === JSON.stringify(p.seasons) && calls.yby === before.yby && calls.log === before.log, 'a second view is served from the cache (no MLB calls)');
  sql(`UPDATE career_cache SET fetched_at = 0;`);
  const refreshed = (await career(pitcher.id)).j;
  ok(calls.yby === before.yby + 1 && calls.log === before.log && refreshed.seasons[0].stats.qs === 3, 'an expired copy re-reads the totals but not the finished seasons’ game logs');

  // ---- MLB unreachable
  sql(`UPDATE career_cache SET fetched_at = 0;`);
  down = true;
  const stale = (await career(hitter.id)).j;
  ok(stale.available && stale.stale === true && stale.seasons.length === 2, 'when MLB is down the last good copy is served, marked stale');
  sql(`DELETE FROM career_cache;`);
  ok((await career(hitter.id)).s === 502, 'with no copy and MLB down it is a clear 502');
  down = false;

  // ---- no MLB history, and two-way players
  await call('PUT', `/stats/players/${unmatched.id}/mlb-id`, { mlbId: MBAD }, K);
  const none = (await career(unmatched.id)).j;
  ok(none.available === false && /No major-league stats/.test(none.reason), 'a matched player with no MLB seasons says so');
  const ob = (await career(ohtB.id)).j, op = (await career(ohtP.id)).j;
  ok(ob.role === 'H' && ob.seasons[0].stats.hr === 30 && op.role === 'P' && op.seasons[0].stats.k === 190, 'Ohtani’s batter and pitcher rows each get their own side of the career');
} finally { server.close(); }

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
