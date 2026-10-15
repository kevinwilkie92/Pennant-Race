import type { Context, Hono } from 'hono';
import { MAX_PAYLOAD, encryptPayload, validEndpoint, vapidAuthorization } from '@pennant/domain';
import { requireAuth } from './auth';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;

export type PushKind = 'dm' | 'group' | 'mention' | 'trade' | 'waiver';
export type Notice = { kind: PushKind; title: string; body: string; url: string; tag?: string };
const PREF_COL: Record<PushKind, string> = { dm: 'dm', group: 'grp', mention: 'mention', trade: 'trade', waiver: 'waiver' };
const MAX_DEVICES = 10;
const DROP_AFTER_FAILS = 8;
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const clip = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);

type Sub = { id: number; kind: 'web' | 'expo'; endpoint: string; p256dh: string | null; auth: string | null };
type Prefs = { dm: number; grp: number; mention: number; trade: number; waiver: number; preview: number };
const DEFAULT_PREFS: Prefs = { dm: 1, grp: 1, mention: 1, trade: 1, waiver: 1, preview: 1 };

const vapid = (env: Env) => (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' } : null);

/** Runs `p` after the response without making the request wait for it. Never throws. */
export function later(c: Context<{ Bindings: Env; Variables: AppVars }>, p: Promise<unknown>) {
  const safe = p.catch((e) => console.log('push failed', e instanceof Error ? e.message : e));
  try { c.executionCtx.waitUntil(safe); } catch { /* no execution context (tests): it simply runs */ }
}

async function deliver(env: Env, sub: Sub, payload: Notice & { preview: boolean }): Promise<'ok' | 'gone' | 'fail'> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    if (sub.kind === 'expo') {
      const r = await fetch(env.EXPO_PUSH_URL || EXPO_URL, {
        method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify([{ to: sub.endpoint, title: payload.title, body: payload.body, data: { url: payload.url, kind: payload.kind }, sound: 'default', channelId: 'default' }]),
      });
      if (!r.ok) return 'fail';
      const ticket = ((await r.json().catch(() => ({}))) as { data?: { status?: string; details?: { error?: string } }[] }).data?.[0];
      if (ticket?.status === 'error') return ticket.details?.error === 'DeviceNotRegistered' ? 'gone' : 'fail';
      return 'ok';
    }
    const v = vapid(env);
    if (!v || !sub.p256dh || !sub.auth) return 'fail';
    const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: payload.tag, kind: payload.kind });
    if (new TextEncoder().encode(body).length > MAX_PAYLOAD) return 'fail';
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: ctl.signal,
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, v), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String(60 * 60 * 24), Urgency: payload.kind === 'trade' || payload.kind === 'dm' ? 'high' : 'normal',
      },
      body: await encryptPayload({ p256dh: sub.p256dh, auth: sub.auth }, new TextEncoder().encode(body)),
    });
    if (r.status === 404 || r.status === 410) return 'gone';        // the browser unsubscribed or the subscription expired
    return r.ok ? 'ok' : 'fail';
  } catch { return 'fail'; }
  finally { clearTimeout(timer); }
}

async function sendTo(env: Env, userIds: string[], notice: Notice, opts: { ignorePrefs?: boolean } = {}) {
  if (!userIds.length) return 0;
  const ph = userIds.map(() => '?').join(',');
  const prefs = new Map((await env.DB.prepare(`SELECT * FROM push_prefs WHERE user_id IN (${ph})`).bind(...userIds).all<Prefs & { user_id: string }>()).results.map((p) => [p.user_id, p]));
  const subs = (await env.DB.prepare(`SELECT user_id AS userId, id, kind, endpoint, p256dh, auth FROM push_subscription WHERE user_id IN (${ph})`).bind(...userIds).all<Sub & { userId: string }>()).results;
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    const p = prefs.get(s.userId) ?? DEFAULT_PREFS;
    if (!opts.ignorePrefs && !p[PREF_COL[notice.kind] as keyof Prefs]) return;
    const preview = !!p.preview;
    const out = await deliver(env, s, { ...notice, body: preview ? notice.body : 'Open Pennant Race to read it', preview });
    if (out === 'ok') { sent++; await env.DB.prepare('UPDATE push_subscription SET fails = 0 WHERE id = ?').bind(s.id).run(); }
    else if (out === 'gone') await env.DB.prepare('DELETE FROM push_subscription WHERE id = ?').bind(s.id).run();
    else await env.DB.prepare(`UPDATE push_subscription SET fails = fails + 1 WHERE id = ?`).bind(s.id).run()
      .then(() => env.DB.prepare('DELETE FROM push_subscription WHERE id = ? AND fails >= ?').bind(s.id, DROP_AFTER_FAILS).run());
  }));
  return sent;
}

/** Notifies the owners of these teams (each respecting their own preferences). */
export async function notifyTeams(env: Env, teams: string[], notice: Notice) {
  if (!teams.length) return 0;
  const ph = teams.map(() => '?').join(',');
  const users = (await env.DB.prepare(`SELECT id FROM user WHERE team_id IN (${ph})`).bind(...teams).all<{ id: string }>()).results.map((u) => u.id);
  return sendTo(env, users, notice);
}

/** Text for a notification: a message body trimmed for a lock screen. */
export const snippet = (body: string, hasImage = false) => clip(body.trim() || (hasImage ? '📷 Photo' : ''), 110);

const PREF_KEYS = ['dm', 'group', 'mention', 'trade', 'waiver', 'preview'] as const;
const prefsOut = (p: Prefs) => ({ dm: !!p.dm, group: !!p.grp, mention: !!p.mention, trade: !!p.trade, waiver: !!p.waiver, preview: !!p.preview });

export function registerPush(app: App) {
  const allowLocal = (env: Env) => env.PUSH_ALLOW_LOCAL === '1';

  // What this server can do, and the public key a browser needs to subscribe.
  app.get('/push/config', requireAuth, (c) => c.json({ web: vapid(c.env)?.publicKey ?? null, expo: true }));

  app.post('/push/subscribe', requireAuth, async (c) => {
    const u = c.get('user');
    const b = await c.req.json<{ kind?: string; endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>().catch(() => ({} as { kind?: string; endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }));
    let endpoint: string, p256dh: string | null = null, auth: string | null = null;
    if (b.kind === 'web') {
      if (!vapid(c.env)) return c.json({ error: 'Browser notifications are not set up on this server' }, 501);
      if (!validEndpoint(b.endpoint, allowLocal(c.env))) return c.json({ error: 'That is not a valid push address' }, 400);
      if (typeof b.keys?.p256dh !== 'string' || typeof b.keys?.auth !== 'string' || b.keys.p256dh.length > 200 || b.keys.auth.length > 50) return c.json({ error: 'Missing subscription keys' }, 400);
      endpoint = b.endpoint; p256dh = b.keys.p256dh; auth = b.keys.auth;
    } else if (b.kind === 'expo') {
      if (typeof b.endpoint !== 'string' || !/^Expo(nent)?PushToken\[[\w-]{10,60}\]$/.test(b.endpoint)) return c.json({ error: 'That is not a valid device token' }, 400);
      endpoint = b.endpoint;
    } else return c.json({ error: 'Unknown device type' }, 400);

    const mine = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscription WHERE user_id = ? AND endpoint != ?').bind(u.id, endpoint).first<{ n: number }>())?.n ?? 0;
    if (mine >= MAX_DEVICES) return c.json({ error: `You can have up to ${MAX_DEVICES} devices; remove one first` }, 400);
    // A device belongs to whoever signed in on it last.
    await c.env.DB.prepare(
      `INSERT INTO push_subscription (user_id, kind, endpoint, p256dh, auth, created_at, fails) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, kind = excluded.kind, p256dh = excluded.p256dh, auth = excluded.auth, fails = 0`,
    ).bind(u.id, b.kind, endpoint, p256dh, auth, Date.now()).run();
    return c.json({ ok: true }, 201);
  });

  app.delete('/push/subscribe', requireAuth, async (c) => {
    const { endpoint } = await c.req.json<{ endpoint?: unknown }>().catch(() => ({} as { endpoint?: unknown }));
    if (typeof endpoint !== 'string') return c.json({ error: 'Missing endpoint' }, 400);
    await c.env.DB.prepare('DELETE FROM push_subscription WHERE endpoint = ? AND user_id = ?').bind(endpoint, c.get('user').id).run();
    return c.json({ ok: true });
  });

  app.get('/push/devices', requireAuth, async (c) => {
    const { results } = await c.env.DB.prepare('SELECT kind, endpoint FROM push_subscription WHERE user_id = ? ORDER BY id').bind(c.get('user').id).all<{ kind: string; endpoint: string }>();
    return c.json({ devices: results });
  });

  app.get('/push/prefs', requireAuth, async (c) => {
    const p = await c.env.DB.prepare('SELECT * FROM push_prefs WHERE user_id = ?').bind(c.get('user').id).first<Prefs>();
    return c.json(prefsOut(p ?? DEFAULT_PREFS));
  });
  app.put('/push/prefs', requireAuth, async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const keys = Object.keys(b);
    if (!keys.length || keys.some((k) => !(PREF_KEYS as readonly string[]).includes(k) || typeof b[k] !== 'boolean')) return c.json({ error: 'Send any of dm, group, mention, trade, waiver, preview as true/false' }, 400);
    const id = c.get('user').id;
    await c.env.DB.prepare('INSERT OR IGNORE INTO push_prefs (user_id) VALUES (?)').bind(id).run();
    for (const k of keys) await c.env.DB.prepare(`UPDATE push_prefs SET ${k === 'group' ? 'grp' : k} = ? WHERE user_id = ?`).bind(b[k] ? 1 : 0, id).run();
    const p = (await c.env.DB.prepare('SELECT * FROM push_prefs WHERE user_id = ?').bind(id).first<Prefs>())!;
    return c.json(prefsOut(p));
  });

  // "Send me a test": goes to your own devices whatever your preferences say. One every few seconds.
  const lastTest = new Map<string, number>();
  app.post('/push/test', requireAuth, async (c) => {
    const id = c.get('user').id;
    if (Date.now() - (lastTest.get(id) ?? 0) < 5000) return c.json({ error: 'One test at a time — wait a few seconds' }, 429);
    lastTest.set(id, Date.now());
    const sent = await sendTo(c.env, [id], { kind: 'dm', title: 'Pennant Race', body: 'Notifications are working on this device.', url: '/team', tag: 'test' }, { ignorePrefs: true });
    return c.json({ sent });
  });
}
