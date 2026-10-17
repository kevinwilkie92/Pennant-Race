// End-to-end check of league settings and multiple commissioners: who can see/change what, the league name, sign-ups
// open/closed, join code rotation, waiver period, promoting and demoting commissioners (and the guard rails), and the audit trail.
// Run against a FRESH local API (see keepers-e2e.mjs header), then:  node api/scripts/leaguesettings-e2e.mjs
const B = 'http://localhost:8787';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, p, body, tok) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const get = async (p, t) => (await call('GET', p, null, t)).j;
const signup = (email, teamId, joinCode) => call('POST', '/auth/register', { email, password: 'password1', teamId, joinCode });
const K = (await signup('k@x.com', 'AM', 'testcode')).j.token, C = (await signup('c@x.com', 'RC', 'testcode')).j.token, M = (await signup('m@x.com', 'MJ', 'testcode')).j.token;
if (![K, C, M].every(Boolean)) { console.log('FAIL could not register the test users (is the database fresh?)'); process.exit(1); }

const events = [];
const ws = new WebSocket(`ws://localhost:8787/draft/ws?token=${K}`);
ws.onmessage = (m) => events.push(JSON.parse(m.data));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const sawLeague = async (since) => { for (let i = 0; i < 40; i++) { if (events.filter((e) => e.type === 'league').length > since) return true; await sleep(50); } return false; };
const leagueEvents = () => events.filter((e) => e.type === 'league').length;
const put = (b, t = K) => call('PUT', '/league/settings', b, t);

try {
  // ---- public + permissions
  const pub = (await call('GET', '/public/league')).j;
  ok(pub.name === 'Carrollton All Stars' && pub.signupsOpen === true, 'the login screen can read the league name without signing in');
  const mine = await get('/league/settings', C);
  ok(mine.name === 'Carrollton All Stars' && mine.waiverDays === 2 && Array.isArray(mine.commissioners), 'any manager can view the settings');
  ok(mine.joinCode === undefined && mine.audit === undefined, 'but only commissioners see the join code and the change history');
  ok((await put({ name: 'Hacked' }, C)).s === 403 && (await call('POST', '/league/join-code', {}, C)).s === 403 && (await call('DELETE', '/league/join-code', null, C)).s === 403 && (await call('PUT', '/league/commissioners/RC', { commissioner: true }, C)).s === 403, 'a non-commissioner cannot change anything');
  ok((await call('GET', '/league/settings')).s === 401, 'settings need a login');
  const k = await get('/league/settings', K);
  ok(k.joinCode === 'testcode' && k.joinCodeSource === 'server', 'a commissioner sees the join code (the server’s, at first)');
  ok(k.commissioners.find((t) => t.teamId === 'AM').isCommissioner === true && k.commissioners.filter((t) => t.isCommissioner).length === 1, 'AM is the only commissioner');
  ok(k.commissioners.find((t) => t.teamId === 'RC').hasAccount === true && k.commissioners.find((t) => t.teamId === 'DB').hasAccount === false, 'it shows which teams have a manager signed up');
  ok(k.schedule.created === false, 'no schedule yet');

  // ---- name
  ok((await put({})).s === 400 && (await put({ name: 'x' })).s === 400 && (await put({ name: 'x'.repeat(41) })).s === 400 && (await put({ name: 5 })).s === 400, 'bad names and empty updates are refused');
  let n = leagueEvents();
  ok((await put({ name: '  Deadline   League ' })).j.name === 'Deadline League', 'rename the league (whitespace tidied)');
  ok((await call('GET', '/public/league')).j.name === 'Deadline League', 'the login screen shows the new name');
  ok(await sawLeague(n), 'everyone is told live');

  // ---- waiver period
  ok((await put({ waiverDays: 15 })).s === 400 && (await put({ waiverDays: 1.5 })).s === 400 && (await put({ waiverDays: 'x' })).s === 400, 'waiver days must be a whole number from 0 to 14');
  ok((await put({ waiverDays: 5 })).j.waiverDays === 5 && (await get('/league/settings', M)).waiverDays === 5, 'change the waiver period');

  // ---- sign-ups open / closed
  ok((await put({ signupsOpen: 'no' })).s === 400, 'signupsOpen must be true or false');
  await put({ signupsOpen: false });
  ok((await call('GET', '/public/league')).j.signupsOpen === false, 'the login screen knows sign-ups are closed');
  const closed = await signup('db@x.com', 'DB', 'testcode');
  ok(closed.s === 403 && /closed/i.test(closed.j.error), 'a new manager cannot sign up while it is closed (even with the code)');
  ok((await call('POST', '/auth/login', { email: 'c@x.com', password: 'password1' })).s === 200, 'existing managers still sign in');
  await put({ signupsOpen: true });
  const dbSignup = await signup('db@x.com', 'DB', 'testcode');
  ok(dbSignup.s === 201, 'and reopening lets them in');

  // ---- join code
  ok((await call('POST', '/league/join-code', { code: 'ab' }, K)).s === 400 && (await call('POST', '/league/join-code', { code: 'bad!!code' }, K)).s === 400, 'a short or odd custom code is refused');
  const fresh = (await call('POST', '/league/join-code', {}, K)).j;
  ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(fresh.code) && fresh.source === 'app', `a fresh random code is made (${fresh.code})`);
  ok((await get('/league/settings', K)).joinCode === fresh.code && (await get('/league/settings', K)).joinCodeSource === 'app', 'commissioners see it');
  ok((await signup('x1@x.com', 'KS', 'testcode')).s === 403, 'the old code stops working immediately');
  ok((await signup('x1@x.com', 'KS', fresh.code.toLowerCase().replace('-', ' '))).s === 201, 'the new code works regardless of case, spaces or the hyphen');
  ok((await call('POST', '/league/join-code', { code: 'Spring 2027' }, K)).j.code === 'Spring 2027' && (await signup('x2@x.com', 'WW', 'spring2027')).s === 201, 'a custom code works too');
  ok((await call('DELETE', '/league/join-code', null, K)).j.code === 'testcode' && (await signup('x3@x.com', 'HH', 'testcode')).s === 201, 'resetting goes back to the server’s code');

  // ---- commissioners
  ok((await call('PUT', '/league/commissioners/RC', { commissioner: 'yes' }, K)).s === 400, 'the flag must be true or false');
  ok((await call('PUT', '/league/commissioners/NOPE', { commissioner: true }, K)).s === 404, 'unknown team is a 404');
  ok((await call('PUT', '/league/commissioners/OZ', { commissioner: true }, K)).s === 400, 'a team nobody has signed up for cannot be made commissioner');
  ok((await call('PUT', '/league/commissioners/AM', { commissioner: false }, K)).s === 400, 'the only commissioner cannot step down');
  ok((await call('PUT', '/league/commissioners/RC', { commissioner: true }, K)).j.changed === true, 'AM makes RC a commissioner');
  ok((await get('/me', C)).user.isCommissioner === true, 'RC is a commissioner at once (no new login)');
  ok((await put({ waiverDays: 3 }, C)).s === 200 && (await call('PUT', '/league/commissioners/MJ', { commissioner: true }, C)).j.changed === true, 'and can use commissioner powers, including adding another');
  ok((await call('PUT', '/league/commissioners/RC', { commissioner: true }, K)).j.changed === false, 'making someone who already is one is a harmless no-op');
  ok((await get('/league/settings', M)).commissioners.filter((t) => t.isCommissioner).map((t) => t.teamId).sort().join() === 'AM,MJ,RC', 'everyone can see who the commissioners are');
  ok((await call('PUT', '/league/commissioners/AM', { commissioner: false }, K)).j.changed === true, 'a commissioner can step down while others remain');
  ok((await put({ name: 'Nope' }, K)).s === 403 && (await get('/me', K)).user.isCommissioner === false, 'and loses the powers immediately');
  ok((await call('PUT', '/league/commissioners/MJ', { commissioner: false }, C)).j.changed === true, 'a commissioner can remove another');
  ok((await call('PUT', '/league/commissioners/RC', { commissioner: false }, C)).s === 400, 'the last commissioner cannot step down');
  ok((await call('PUT', '/league/commissioners/AM', { commissioner: true }, C)).j.changed === true, 'RC gives AM the role back');

  // ---- audit trail
  const log = (await get('/league/settings', C)).audit.map((a) => a.detail);
  ok(log.some((d) => /renamed from “Carrollton All Stars” to “Deadline League”/.test(d)) && log.some((d) => /Sign-ups closed/.test(d)) && log.some((d) => /Join code changed/.test(d)), 'the change history records settings changes');
  ok(log.some((d) => /was made a commissioner by/.test(d)) && log.some((d) => /stepped down|no longer a commissioner/.test(d)), 'and commissioner changes, with who made them');
  ok(!log.some((d) => d.includes(fresh.code) || d.includes('Spring')), 'but never the join codes themselves');
} finally { ws.close(); }

console.log(fails ? `FAILED (${fails})` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
