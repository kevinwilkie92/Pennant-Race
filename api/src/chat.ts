import type { Hono } from 'hono';
import { requireAuth, requireCommissioner } from './auth';
import type { ChatMessage } from './draft-room';
import { broadcast } from './realtime';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;

export const MAX_BODY = 500;
export const EMOJI = ['👍', '🔥', '😂', '😮', '❤️', '👀'] as const;
const RATE_LIMIT = { count: 5, windowMs: 10_000 };

type Row = { id: number; teamId: string; body: string; createdAt: number; pinned: number; reactions: string };
const COLS = 'id, team_id AS teamId, body, created_at AS createdAt, pinned, reactions_json AS reactions';
const toMessage = (r: Row): ChatMessage => ({
  id: r.id, teamId: r.teamId, body: r.body, createdAt: r.createdAt, pinned: !!r.pinned,
  reactions: (() => { try { return JSON.parse(r.reactions || '{}'); } catch { return {}; } })(),
});

const one = async (env: Env, id: number) => {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM chat_message WHERE id = ?`).bind(id).first<Row>();
  return r ? toMessage(r) : null;
};

export function registerChat(app: App) {
  // Newest page by default; `before` pages backwards. Returned oldest → newest so the client can just render them.
  app.get('/chat', requireAuth, async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100);
    const before = Number(c.req.query('before') ?? 0);
    const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM chat_message WHERE (?1 = 0 OR id < ?1) ORDER BY id DESC LIMIT ?2`)
      .bind(before, limit + 1).all<Row>();
    const hasMore = results.length > limit;
    const page = results.slice(0, limit).reverse().map(toMessage);
    const pinned = await c.env.DB.prepare(`SELECT ${COLS} FROM chat_message WHERE pinned = 1 ORDER BY id DESC LIMIT 1`).first<Row>();
    return c.json({ messages: page, hasMore, pinned: pinned ? toMessage(pinned) : null, emoji: EMOJI });
  });

  // Messages from other teams newer than this user's read marker.
  app.get('/chat/unread', requireAuth, async (c) => {
    const u = c.get('user');
    const last = (await c.env.DB.prepare('SELECT last_id AS id FROM chat_read WHERE user_id = ?').bind(u.id).first<{ id: number }>())?.id ?? 0;
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE id > ? AND team_id != ?').bind(last, u.teamId ?? '').first<{ n: number }>();
    return c.json({ count: row?.n ?? 0 });
  });

  app.post('/chat/read', requireAuth, async (c) => {
    const { lastId } = await c.req.json<{ lastId: number }>();
    if (!Number.isInteger(lastId) || lastId < 0) return c.json({ error: 'Bad id' }, 400);
    // The marker only moves forward.
    await c.env.DB.prepare('INSERT INTO chat_read (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)').bind(c.get('user').id, lastId).run();
    return c.json({ ok: true });
  });

  app.post('/chat', requireAuth, async (c) => {
    const u = c.get('user');
    if (!u.teamId) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    const { body } = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
    const text = (body ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) return c.json({ error: 'Write something first' }, 400);
    if ([...text].length > MAX_BODY) return c.json({ error: `Messages are limited to ${MAX_BODY} characters` }, 400);
    const now = Date.now();
    const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE team_id = ? AND created_at > ?').bind(u.teamId, now - RATE_LIMIT.windowMs).first<{ n: number }>();
    if ((recent?.n ?? 0) >= RATE_LIMIT.count) return c.json({ error: 'Slow down — too many messages at once' }, 429);
    const r = await c.env.DB.prepare('INSERT INTO chat_message (team_id, body, pinned, reactions_json, created_at) VALUES (?, ?, 0, ?, ?)').bind(u.teamId, text, '{}', now).run();
    const message = (await one(c.env, Number(r.meta.last_row_id)))!;
    await broadcast(c.env, { type: 'chat', message });
    return c.json(message, 201);
  });

  // Toggle your team's reaction (one per emoji per team).
  app.post('/chat/:id/react', requireAuth, async (c) => {
    const u = c.get('user');
    if (!u.teamId) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    const { emoji } = await c.req.json<{ emoji: string }>();
    if (!(EMOJI as readonly string[]).includes(emoji)) return c.json({ error: 'That reaction isn’t available' }, 400);
    const msg = await one(c.env, Number(c.req.param('id')));
    if (!msg) return c.json({ error: 'Message not found' }, 404);
    const set = new Set(msg.reactions[emoji] ?? []);
    if (set.has(u.teamId)) set.delete(u.teamId); else set.add(u.teamId);
    const reactions = { ...msg.reactions };
    if (set.size) reactions[emoji] = [...set]; else delete reactions[emoji];
    await c.env.DB.prepare('UPDATE chat_message SET reactions_json = ? WHERE id = ?').bind(JSON.stringify(reactions), msg.id).run();
    await broadcast(c.env, { type: 'chat-react', id: msg.id, reactions });
    return c.json({ reactions });
  });

  // The pinned message is the commissioner's announcement; only one at a time.
  app.put('/chat/:id/pin', requireAuth, requireCommissioner, async (c) => {
    const id = Number(c.req.param('id'));
    const { pinned } = await c.req.json<{ pinned: boolean }>();
    if (!(await one(c.env, id))) return c.json({ error: 'Message not found' }, 404);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE chat_message SET pinned = 0 WHERE pinned = 1'),
      ...(pinned ? [c.env.DB.prepare('UPDATE chat_message SET pinned = 1 WHERE id = ?').bind(id)] : []),
    ]);
    const now = pinned ? await one(c.env, id) : null;
    await broadcast(c.env, { type: 'chat-pin', pinned: now });
    return c.json({ pinned: now });
  });

  app.delete('/chat/:id', requireAuth, async (c) => {
    const u = c.get('user');
    const id = Number(c.req.param('id'));
    const msg = await one(c.env, id);
    if (!msg) return c.json({ error: 'Message not found' }, 404);
    if (!u.isCommissioner && u.teamId !== msg.teamId) return c.json({ error: 'You can only delete your own messages' }, 403);
    await c.env.DB.prepare('DELETE FROM chat_message WHERE id = ?').bind(id).run();
    await broadcast(c.env, { type: 'chat-delete', id });
    return c.json({ ok: true });
  });
}
