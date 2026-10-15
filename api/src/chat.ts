import type { Hono } from 'hono';
import { parseMentions } from '@pennant/domain';
import { requireAuth, requireCommissioner } from './auth';
import type { ChatMessage } from './draft-room';
import { broadcast } from './realtime';
import { sniffImage } from './teams';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;

export const MAX_BODY = 500;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const EMOJI = ['👍', '🔥', '😂', '😮', '❤️', '👀'] as const;
const RATE_LIMIT = { count: 5, windowMs: 10_000 };
const UPLOAD_LIMIT = { count: 10, windowMs: 60_000 };
const SNIPPET = 140;

type Row = {
  id: number; teamId: string; toTeam: string | null; body: string; createdAt: number; editedAt: number | null; pinned: number;
  reactions: string; imageKey: string | null; mentions: string; replyId: number | null;
  rId: number | null; rTeam: string | null; rBody: string | null; rImage: string | null;
};
const COLS = `m.id, m.team_id AS teamId, m.to_team AS toTeam, m.body, m.created_at AS createdAt, m.edited_at AS editedAt, m.pinned,
  m.reactions_json AS reactions, m.image_key AS imageKey, m.mentions_json AS mentions, m.reply_to AS replyId,
  r.id AS rId, r.team_id AS rTeam, r.body AS rBody, r.image_key AS rImage`;
const FROM = 'chat_message m LEFT JOIN chat_message r ON r.id = m.reply_to';

const json = <T>(s: string, fallback: T): T => { try { return JSON.parse(s || ''); } catch { return fallback; } };
const toMessage = (r: Row): ChatMessage => ({
  id: r.id, teamId: r.teamId, toTeam: r.toTeam, body: r.body, createdAt: r.createdAt, editedAt: r.editedAt, pinned: !!r.pinned,
  reactions: json(r.reactions, {}), imageKey: r.imageKey, mentions: json(r.mentions, []),
  replyTo: r.replyId == null ? null
    : r.rId == null ? { id: r.replyId, deleted: true }
    : { id: r.rId, teamId: r.rTeam ?? undefined, body: (r.rBody ?? '').slice(0, SNIPPET), hasImage: !!r.rImage },
});

const one = async (env: Env, id: number) => {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM ${FROM} WHERE m.id = ?`).bind(id).first<Row>();
  return r ? toMessage(r) : null;
};
/** Who may see a message: everyone for the league room, only the two teams for a direct message. */
const audience = (m: Pick<ChatMessage, 'teamId' | 'toTeam'>) => (m.toTeam ? [m.teamId, m.toTeam] : undefined);
const canSee = (m: Pick<ChatMessage, 'teamId' | 'toTeam'>, team: string | null) => !m.toTeam || m.teamId === team || m.toTeam === team;
const allTeamIds = async (env: Env) => (await env.DB.prepare('SELECT id FROM team').all<{ id: string }>()).results.map((t) => t.id);

export function registerChat(app: App) {
  const page = async (c: { req: { query: (k: string) => string | undefined }; env: Env }, where: string, binds: unknown[]) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100);
    const before = Number(c.req.query('before') ?? 0);
    const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM ${FROM} WHERE ${where} AND (?${binds.length + 1} = 0 OR m.id < ?${binds.length + 1}) ORDER BY m.id DESC LIMIT ?${binds.length + 2}`)
      .bind(...binds, before, limit + 1).all<Row>();
    return { messages: results.slice(0, limit).reverse().map(toMessage), hasMore: results.length > limit };
  };

  // ------------------------------------------------------------------ league room
  // Newest page by default; `before` pages backwards. Returned oldest → newest so the client can just render them.
  app.get('/chat', requireAuth, async (c) => {
    const p = await page(c, 'm.to_team IS NULL', []);
    const pinned = await c.env.DB.prepare(`SELECT ${COLS} FROM ${FROM} WHERE m.pinned = 1 AND m.to_team IS NULL ORDER BY m.id DESC LIMIT 1`).first<Row>();
    return c.json({ ...p, pinned: pinned ? toMessage(pinned) : null, emoji: EMOJI });
  });

  // ------------------------------------------------------------------ direct messages
  app.get('/chat/dms', requireAuth, async (c) => {
    const me = c.get('user');
    if (!me.teamId) return c.json({ conversations: [], totalUnread: 0 });
    const { results: partners } = await c.env.DB.prepare(
      `SELECT CASE WHEN team_id = ?1 THEN to_team ELSE team_id END AS partner, MAX(id) AS lastId
         FROM chat_message WHERE to_team IS NOT NULL AND (team_id = ?1 OR to_team = ?1) GROUP BY partner ORDER BY lastId DESC`,
    ).bind(me.teamId).all<{ partner: string; lastId: number }>();
    const reads = new Map((await c.env.DB.prepare('SELECT partner, last_id AS lastId FROM dm_read WHERE user_id = ?').bind(me.id).all<{ partner: string; lastId: number }>()).results.map((r) => [r.partner, r.lastId]));
    const conversations = [];
    let totalUnread = 0;
    for (const p of partners) {
      const last = (await one(c.env, p.lastId))!;
      const unread = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE to_team = ? AND team_id = ? AND id > ?').bind(me.teamId, p.partner, reads.get(p.partner) ?? 0).first<{ n: number }>())?.n ?? 0;
      totalUnread += unread;
      conversations.push({ team: p.partner, unread, last: { id: last.id, fromMe: last.teamId === me.teamId, body: last.body.slice(0, 80), hasImage: !!last.imageKey, createdAt: last.createdAt } });
    }
    return c.json({ conversations, totalUnread });
  });

  app.get('/chat/dm/:team', requireAuth, async (c) => {
    const me = c.get('user').teamId, other = c.req.param('team') as string;
    if (!me) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    if (other === me || !(await allTeamIds(c.env)).includes(other)) return c.json({ error: 'Unknown team' }, 400);
    const p = await page(c, '((m.team_id = ?1 AND m.to_team = ?2) OR (m.team_id = ?2 AND m.to_team = ?1))', [me, other]);
    return c.json({ ...p, emoji: EMOJI });
  });

  app.post('/chat/dm-read', requireAuth, async (c) => {
    const { team, lastId } = await c.req.json<{ team: string; lastId: number }>();
    if (typeof team !== 'string' || !Number.isInteger(lastId) || lastId < 0) return c.json({ error: 'Bad request' }, 400);
    await c.env.DB.prepare('INSERT INTO dm_read (user_id, partner, last_id) VALUES (?, ?, ?) ON CONFLICT(user_id, partner) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)').bind(c.get('user').id, team, lastId).run();
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------ unread
  app.get('/chat/unread', requireAuth, async (c) => {
    const u = c.get('user');
    const last = (await c.env.DB.prepare('SELECT last_id AS id FROM chat_read WHERE user_id = ?').bind(u.id).first<{ id: number }>())?.id ?? 0;
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(EXISTS (SELECT 1 FROM json_each(mentions_json) WHERE value = ?2)), 0) AS mentions
         FROM chat_message WHERE id > ?1 AND team_id != ?2 AND to_team IS NULL`,
    ).bind(last, u.teamId ?? '').first<{ n: number; mentions: number }>();
    const dm = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM chat_message m WHERE m.to_team = ?1 AND m.id > COALESCE((SELECT last_id FROM dm_read WHERE user_id = ?2 AND partner = m.team_id), 0)`,
    ).bind(u.teamId ?? '', u.id).first<{ n: number }>();
    return c.json({ count: row?.n ?? 0, mentions: row?.mentions ?? 0, dm: dm?.n ?? 0 });
  });

  app.post('/chat/read', requireAuth, async (c) => {
    const { lastId } = await c.req.json<{ lastId: number }>();
    if (!Number.isInteger(lastId) || lastId < 0) return c.json({ error: 'Bad id' }, 400);
    // The marker only moves forward.
    await c.env.DB.prepare('INSERT INTO chat_read (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)').bind(c.get('user').id, lastId).run();
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------ images
  // Upload first (raw bytes), then send a message that names the returned key. The bytes decide the type, not the label.
  app.post('/chat/image', requireAuth, async (c) => {
    const team = c.get('user').teamId;
    if (!team) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_upload WHERE team_id = ? AND created_at > ?').bind(team, Date.now() - UPLOAD_LIMIT.windowMs).first<{ n: number }>();
    if ((recent?.n ?? 0) >= UPLOAD_LIMIT.count) return c.json({ error: 'Too many uploads — wait a moment' }, 429);
    if (Number(c.req.header('content-length') ?? 0) > MAX_IMAGE_BYTES) return c.json({ error: 'That image is too large (2 MB max)' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return c.json({ error: 'That image is too large (2 MB max)' }, 413);
    if (!bytes.length) return c.json({ error: 'No image received' }, 400);
    const kind = sniffImage(bytes);
    if (!kind) return c.json({ error: 'Use a PNG, JPEG or WebP image' }, 415);
    const key = `${crypto.randomUUID()}.${kind.ext}`;
    await c.env.LOGOS.put(`chat/${key}`, bytes, { httpMetadata: { contentType: kind.type } });
    await c.env.DB.prepare('INSERT INTO chat_upload (key, team_id, created_at, used) VALUES (?, ?, ?, 0)').bind(key, team, Date.now()).run();
    return c.json({ imageKey: key });
  });

  // Public, like logos: <img> can't send credentials. Names are random and only ever sent to the people in the conversation.
  app.get('/chat-images/:file', async (c) => {
    const file = c.req.param('file') as string;
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(file)) return c.text('Not found', 404);
    const obj = await c.env.LOGOS.get(`chat/${file}`);
    if (!obj) return c.text('Not found', 404);
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'cross-origin',
        'access-control-allow-origin': '*',
      },
    });
  });

  // ------------------------------------------------------------------ send / edit
  const cleanText = (body: unknown) => (typeof body === 'string' ? body : '').replace(/\r\n/g, '\n').trim();

  app.post('/chat', requireAuth, async (c) => {
    const u = c.get('user');
    if (!u.teamId) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    const b = await c.req.json<{ body?: string; replyTo?: number; toTeam?: string; imageKey?: string }>().catch(() => ({} as { body?: string }));
    const text = cleanText(b.body);
    const { replyTo, toTeam, imageKey } = b as { replyTo?: number; toTeam?: string; imageKey?: string };
    if (!text && !imageKey) return c.json({ error: 'Write something first' }, 400);
    if ([...text].length > MAX_BODY) return c.json({ error: `Messages are limited to ${MAX_BODY} characters` }, 400);

    const teams = await allTeamIds(c.env);
    if (toTeam != null && (toTeam === u.teamId || !teams.includes(toTeam))) return c.json({ error: 'Pick another team to message' }, 400);

    if (replyTo != null) {
      const orig = await one(c.env, Number(replyTo));
      const sameThread = orig && (toTeam ? orig.toTeam && ((orig.teamId === u.teamId && orig.toTeam === toTeam) || (orig.teamId === toTeam && orig.toTeam === u.teamId)) : !orig.toTeam);
      if (!sameThread) return c.json({ error: 'You can only reply within the same conversation' }, 400);
    }
    if (imageKey) {
      const up = await c.env.DB.prepare('SELECT 1 FROM chat_upload WHERE key = ? AND team_id = ? AND used = 0').bind(imageKey, u.teamId).first();
      if (!up) return c.json({ error: 'That image upload isn’t available' }, 400);
    }

    const now = Date.now();
    const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE team_id = ? AND created_at > ?').bind(u.teamId, now - RATE_LIMIT.windowMs).first<{ n: number }>();
    if ((recent?.n ?? 0) >= RATE_LIMIT.count) return c.json({ error: 'Slow down — too many messages at once' }, 429);

    const mentions = toTeam ? [] : parseMentions(text, teams, u.teamId);       // @mentions are for the league room
    const stmts = [
      c.env.DB.prepare('INSERT INTO chat_message (team_id, to_team, body, pinned, reactions_json, created_at, reply_to, image_key, mentions_json) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)')
        .bind(u.teamId, toTeam ?? null, text, '{}', now, replyTo ?? null, imageKey ?? null, JSON.stringify(mentions)),
      ...(imageKey ? [c.env.DB.prepare('UPDATE chat_upload SET used = 1 WHERE key = ?').bind(imageKey)] : []),
    ];
    const res = await c.env.DB.batch(stmts);
    const message = (await one(c.env, Number(res[0].meta.last_row_id)))!;
    await broadcast(c.env, { type: 'chat', message }, audience(message));
    return c.json(message, 201);
  });

  app.patch('/chat/:id', requireAuth, async (c) => {
    const u = c.get('user');
    const msg = await one(c.env, Number(c.req.param('id')));
    if (!msg || !canSee(msg, u.teamId)) return c.json({ error: 'Message not found' }, 404);
    if (msg.teamId !== u.teamId) return c.json({ error: 'You can only edit your own messages' }, 403);   // not even the commissioner
    const text = cleanText((await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }))).body);
    if (!text && !msg.imageKey) return c.json({ error: 'A message needs some text (or delete it)' }, 400);
    if ([...text].length > MAX_BODY) return c.json({ error: `Messages are limited to ${MAX_BODY} characters` }, 400);
    const mentions = msg.toTeam ? [] : parseMentions(text, await allTeamIds(c.env), u.teamId);
    if (text === msg.body) return c.json(msg);                                                          // nothing changed: don't mark it edited
    await c.env.DB.prepare('UPDATE chat_message SET body = ?, mentions_json = ?, edited_at = ? WHERE id = ?').bind(text, JSON.stringify(mentions), Date.now(), msg.id).run();
    const message = (await one(c.env, msg.id))!;
    await broadcast(c.env, { type: 'chat-edit', message }, audience(message));
    return c.json(message);
  });

  // ------------------------------------------------------------------ react / pin / delete
  // Toggle your team's reaction (one per emoji per team).
  app.post('/chat/:id/react', requireAuth, async (c) => {
    const u = c.get('user');
    if (!u.teamId) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    const { emoji } = await c.req.json<{ emoji: string }>();
    if (!(EMOJI as readonly string[]).includes(emoji)) return c.json({ error: 'That reaction isn’t available' }, 400);
    const msg = await one(c.env, Number(c.req.param('id')));
    if (!msg || !canSee(msg, u.teamId)) return c.json({ error: 'Message not found' }, 404);
    const set = new Set(msg.reactions[emoji] ?? []);
    if (set.has(u.teamId)) set.delete(u.teamId); else set.add(u.teamId);
    const reactions = { ...msg.reactions };
    if (set.size) reactions[emoji] = [...set]; else delete reactions[emoji];
    await c.env.DB.prepare('UPDATE chat_message SET reactions_json = ? WHERE id = ?').bind(JSON.stringify(reactions), msg.id).run();
    await broadcast(c.env, { type: 'chat-react', id: msg.id, reactions }, audience(msg));
    return c.json({ reactions });
  });

  // The pinned message is the commissioner's announcement for the league room; only one at a time.
  app.put('/chat/:id/pin', requireAuth, requireCommissioner, async (c) => {
    const id = Number(c.req.param('id'));
    const { pinned } = await c.req.json<{ pinned: boolean }>();
    const msg = await one(c.env, id);
    if (!msg || msg.toTeam) return c.json({ error: 'Message not found' }, 404);          // a direct message can't be pinned
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE chat_message SET pinned = 0 WHERE pinned = 1'),
      ...(pinned ? [c.env.DB.prepare('UPDATE chat_message SET pinned = 1 WHERE id = ?').bind(id)] : []),
    ]);
    const now = pinned ? await one(c.env, id) : null;
    await broadcast(c.env, { type: 'chat-pin', pinned: now });
    return c.json({ pinned: now });
  });

  // Authors delete their own; the commissioner can also delete league-room messages (never direct messages — they can't see them).
  app.delete('/chat/:id', requireAuth, async (c) => {
    const u = c.get('user');
    const id = Number(c.req.param('id'));
    const msg = await one(c.env, id);
    if (!msg || !canSee(msg, u.teamId)) return c.json({ error: 'Message not found' }, 404);
    const allowed = msg.teamId === u.teamId || (u.isCommissioner && !msg.toTeam);
    if (!allowed) return c.json({ error: 'You can only delete your own messages' }, 403);
    await c.env.DB.prepare('DELETE FROM chat_message WHERE id = ?').bind(id).run();
    if (msg.imageKey) {
      await c.env.DB.prepare('DELETE FROM chat_upload WHERE key = ?').bind(msg.imageKey).run();
      await c.env.LOGOS.delete(`chat/${msg.imageKey}`).catch(() => {});
    }
    await broadcast(c.env, { type: 'chat-delete', id }, audience(msg));
    return c.json({ ok: true });
  });
}
