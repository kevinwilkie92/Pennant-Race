import type { Hono } from 'hono';
import { MAX_GROUP, cleanGroupName, cleanQuery, likePattern, memberKey, parseMentions, validateGroup } from '@pennant/domain';
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
  id: number; teamId: string; toTeam: string | null; groupId: number | null; body: string; createdAt: number; editedAt: number | null; pinned: number;
  reactions: string; imageKey: string | null; mentions: string; replyId: number | null;
  rId: number | null; rTeam: string | null; rBody: string | null; rImage: string | null;
};
const COLS = `m.id, m.team_id AS teamId, m.to_team AS toTeam, m.group_id AS groupId, m.body, m.created_at AS createdAt, m.edited_at AS editedAt, m.pinned,
  m.reactions_json AS reactions, m.image_key AS imageKey, m.mentions_json AS mentions, m.reply_to AS replyId,
  r.id AS rId, r.team_id AS rTeam, r.body AS rBody, r.image_key AS rImage`;
const FROM = 'chat_message m LEFT JOIN chat_message r ON r.id = m.reply_to';

const json = <T>(s: string, fallback: T): T => { try { return JSON.parse(s || ''); } catch { return fallback; } };
const toMessage = (r: Row): ChatMessage => ({
  id: r.id, teamId: r.teamId, toTeam: r.toTeam, groupId: r.groupId, body: r.body, createdAt: r.createdAt, editedAt: r.editedAt, pinned: !!r.pinned,
  reactions: json(r.reactions, {}), imageKey: r.imageKey, mentions: json(r.mentions, []),
  replyTo: r.replyId == null ? null
    : r.rId == null ? { id: r.replyId, deleted: true }
    : { id: r.rId, teamId: r.rTeam ?? undefined, body: (r.rBody ?? '').slice(0, SNIPPET), hasImage: !!r.rImage },
});

const one = async (env: Env, id: number) => {
  const r = await env.DB.prepare(`SELECT ${COLS} FROM ${FROM} WHERE m.id = ?`).bind(id).first<Row>();
  return r ? toMessage(r) : null;
};
type Scoped = Pick<ChatMessage, 'id' | 'teamId' | 'toTeam' | 'groupId'>;
const groupMembers = async (env: Env, id: number) => (await env.DB.prepare('SELECT team_id AS t FROM chat_group_member WHERE group_id = ?').bind(id).all<{ t: string }>()).results.map((r) => r.t);
/** Who gets a message live: everyone for the league room, the two teams for a direct message, the members for a group. */
const audience = async (env: Env, m: Scoped) => (m.groupId ? groupMembers(env, m.groupId) : m.toTeam ? [m.teamId, m.toTeam] : undefined);
/** Who may read it: everyone for the league room, the two teams for a direct message, members for a group (from when they joined). */
async function canSee(env: Env, m: Scoped, team: string | null): Promise<boolean> {
  if (m.groupId) {
    if (!team) return false;
    const mem = await env.DB.prepare('SELECT from_id AS f FROM chat_group_member WHERE group_id = ? AND team_id = ?').bind(m.groupId, team).first<{ f: number }>();
    return !!mem && m.id > mem.f;
  }
  return !m.toTeam || m.teamId === team || m.toTeam === team;
}
const isPrivate = (m: Pick<ChatMessage, 'toTeam' | 'groupId'>) => !!m.toTeam || !!m.groupId;
/** Keeps the realtime room's copy of a group's members current (it uses it to route typing signals). */
const syncGroup = async (env: Env, id: number, teams: string[] | null) => { await env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName('league')).fetch('https://room/group-members', { method: 'POST', body: JSON.stringify({ id, teams }) }); };
const allTeamIds = async (env: Env) => (await env.DB.prepare('SELECT id FROM team').all<{ id: string }>()).results.map((t) => t.id);

type GroupInfo = { id: number; name: string | null; createdBy: string; members: string[] };
const groupInfo = async (env: Env, id: number): Promise<GroupInfo | null> => {
  const g = await env.DB.prepare('SELECT id, name, created_by AS createdBy FROM chat_group WHERE id = ?').bind(id).first<{ id: number; name: string | null; createdBy: string }>();
  return g ? { ...g, members: (await groupMembers(env, id)).sort() } : null;
};
const isMember = async (env: Env, id: number, team: string | null) => !!team && !!(await env.DB.prepare('SELECT 1 FROM chat_group_member WHERE group_id = ? AND team_id = ?').bind(id, team).first());
/** Messages in my groups from other teams that I haven't read (and joined before). */
async function groupUnread(env: Env, userId: string, team: string | null): Promise<number> {
  if (!team) return 0;
  return (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM chat_message m JOIN chat_group_member gm ON gm.group_id = m.group_id AND gm.team_id = ?1
      WHERE m.group_id IS NOT NULL AND m.team_id != ?1 AND m.id > gm.from_id
        AND m.id > COALESCE((SELECT last_id FROM group_read WHERE user_id = ?2 AND group_id = m.group_id), 0)`,
  ).bind(team, userId).first<{ n: number }>())?.n ?? 0;
}

/** Read receipts are reciprocal: your setting decides both whether you share yours and whether you see anyone's. */
const wantsReceipts = async (env: Env, userId: string) => (await env.DB.prepare('SELECT read_receipts AS r FROM user WHERE id = ?').bind(userId).first<{ r: number }>())?.r === 1;
const teamWantsReceipts = async (env: Env, team: string) => (await env.DB.prepare('SELECT read_receipts AS r FROM user WHERE team_id = ?').bind(team).first<{ r: number }>())?.r === 1;
type ReceiptRow = { teamId: string; lastId: number; at: number | null };

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
    const p = await page(c, 'm.to_team IS NULL AND m.group_id IS NULL', []);
    const pinned = await c.env.DB.prepare(`SELECT ${COLS} FROM ${FROM} WHERE m.pinned = 1 AND m.to_team IS NULL AND m.group_id IS NULL ORDER BY m.id DESC LIMIT 1`).first<Row>();
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
    // Has the other team read my messages? Only if we both share receipts.
    let receipts: ReceiptRow[] = [];
    if (await wantsReceipts(c.env, c.get('user').id)) {
      const r = await c.env.DB.prepare(
        `SELECT u.team_id AS teamId, d.shared_id AS lastId, d.read_at AS at FROM user u JOIN dm_read d ON d.user_id = u.id AND d.partner = ?2
          WHERE u.team_id = ?1 AND u.read_receipts = 1 AND d.shared_id > 0`,
      ).bind(other, me).first<ReceiptRow>();
      if (r) receipts = [r];
    }
    return c.json({ ...p, receipts, emoji: EMOJI });
  });

  app.post('/chat/dm-read', requireAuth, async (c) => {
    const { team, lastId } = await c.req.json<{ team: string; lastId: number }>();
    if (typeof team !== 'string' || !Number.isInteger(lastId) || lastId < 0) return c.json({ error: 'Bad request' }, 400);
    const u = c.get('user');
    if (!u.teamId || team === u.teamId || !(await allTeamIds(c.env)).includes(team)) return c.json({ error: 'Unknown team' }, 400);
    // A reader can't claim more than has actually been said in this conversation.
    const top = (await c.env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM chat_message WHERE (team_id = ?1 AND to_team = ?2) OR (team_id = ?2 AND to_team = ?1)').bind(u.teamId, team).first<{ m: number }>())?.m ?? 0;
    const upTo = Math.min(lastId, top);
    const prev = (await c.env.DB.prepare('SELECT shared_id AS l FROM dm_read WHERE user_id = ? AND partner = ?').bind(u.id, team).first<{ l: number }>())?.l ?? 0;
    const share = await wantsReceipts(c.env, u.id);
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO dm_read (user_id, partner, last_id, shared_id, read_at) VALUES (?1, ?2, ?3, ?5, ?4)
       ON CONFLICT(user_id, partner) DO UPDATE SET last_id = MAX(last_id, excluded.last_id),
         read_at = CASE WHEN ?5 > shared_id THEN ?4 ELSE read_at END, shared_id = MAX(shared_id, ?5)`,
    ).bind(u.id, team, upTo, now, share ? upTo : 0).run();
    // Reciprocal: the other team only hears about it if they share their own receipts too.
    if (share && upTo > prev && (await teamWantsReceipts(c.env, team))) await broadcast(c.env, { type: 'chat-read', scope: 'dm', teamId: u.teamId, lastId: upTo, at: now }, [team]);
    return c.json({ ok: true });
  });


  // ------------------------------------------------------------------ group conversations
  // Three to eight teams. Only members can read or write; the commissioner has no special view. Someone added later sees
  // only what is said after they join. Creating a group with exactly the same teams as an existing one opens that one.
  app.post('/chat/groups', requireAuth, async (c) => {
    const u = c.get('user');
    if (!u.teamId) return c.json({ error: 'Your account isn’t linked to a team' }, 403);
    const b = await c.req.json<{ teamIds?: unknown; name?: unknown }>().catch(() => ({} as { teamIds?: unknown; name?: unknown }));
    const check = validateGroup(u.teamId, b.teamIds, await allTeamIds(c.env));
    if (!check.ok) return c.json({ error: check.reason }, 400);
    const nm = cleanGroupName(b.name);
    if (!nm.ok) return c.json({ error: nm.reason }, 400);

    const key = memberKey(check.members);
    const existing = await c.env.DB.prepare('SELECT id FROM chat_group WHERE member_key = ?').bind(key).first<{ id: number }>();
    if (existing) return c.json({ group: await groupInfo(c.env, existing.id), existing: true });

    const made = await c.env.DB.prepare('INSERT INTO chat_group (name, created_by, created_at, member_key) VALUES (?, ?, ?, ?)').bind(nm.name, u.teamId, Date.now(), key).run();
    const id = Number(made.meta.last_row_id);
    await c.env.DB.batch(check.members.map((t) => c.env.DB.prepare('INSERT INTO chat_group_member (group_id, team_id, from_id) VALUES (?, ?, 0)').bind(id, t)));
    await syncGroup(c.env, id, check.members);
    const group = (await groupInfo(c.env, id))!;
    await broadcast(c.env, { type: 'chat-group', id }, group.members);
    return c.json({ group, existing: false }, 201);
  });

  app.get('/chat/groups', requireAuth, async (c) => {
    const u = c.get('user');
    if (!u.teamId) return c.json({ groups: [] });
    const { results } = await c.env.DB.prepare(
      `SELECT gm.group_id AS id, gm.from_id AS fromId,
              (SELECT MAX(m.id) FROM chat_message m WHERE m.group_id = gm.group_id AND m.id > gm.from_id) AS lastId
         FROM chat_group_member gm WHERE gm.team_id = ?`,
    ).bind(u.teamId).all<{ id: number; fromId: number; lastId: number | null }>();
    const reads = new Map((await c.env.DB.prepare('SELECT group_id AS id, last_id AS lastId FROM group_read WHERE user_id = ?').bind(u.id).all<{ id: number; lastId: number }>()).results.map((r) => [r.id, r.lastId]));
    const groups = [];
    for (const r of results) {
      const info = (await groupInfo(c.env, r.id))!;
      const last = r.lastId ? await one(c.env, r.lastId) : null;
      const unread = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE group_id = ? AND team_id != ? AND id > ?').bind(r.id, u.teamId, Math.max(r.fromId, reads.get(r.id) ?? 0)).first<{ n: number }>())?.n ?? 0;
      groups.push({ ...info, unread, last: last ? { id: last.id, teamId: last.teamId, fromMe: last.teamId === u.teamId, body: last.body.slice(0, 80), hasImage: !!last.imageKey, createdAt: last.createdAt } : null, sortKey: last?.createdAt ?? 0 });
    }
    groups.sort((a, b) => b.sortKey - a.sortKey || b.id - a.id);
    return c.json({ groups: groups.map(({ sortKey: _k, ...g }) => g), totalUnread: groups.reduce((n, g) => n + g.unread, 0) });
  });

  app.get('/chat/groups/:id', requireAuth, async (c) => {
    const id = Number(c.req.param('id')), team = c.get('user').teamId;
    const mem = team ? await c.env.DB.prepare('SELECT from_id AS f FROM chat_group_member WHERE group_id = ? AND team_id = ?').bind(id, team).first<{ f: number }>() : null;
    if (!mem) return c.json({ error: 'Group not found' }, 404);
    const p = await page(c, 'm.group_id = ?1 AND m.id > ?2', [id, mem.f]);
    let receipts: ReceiptRow[] = [];
    if (await wantsReceipts(c.env, c.get('user').id)) {
      receipts = (await c.env.DB.prepare(
        `SELECT u.team_id AS teamId, gr.shared_id AS lastId, gr.read_at AS at
           FROM chat_group_member gm JOIN user u ON u.team_id = gm.team_id AND u.read_receipts = 1
           JOIN group_read gr ON gr.user_id = u.id AND gr.group_id = gm.group_id
          WHERE gm.group_id = ?1 AND gm.team_id != ?2 AND gr.shared_id > 0`,
      ).bind(id, team).all<ReceiptRow>()).results;
    }
    return c.json({ group: await groupInfo(c.env, id), ...p, receipts, emoji: EMOJI });
  });

  app.patch('/chat/groups/:id', requireAuth, async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await isMember(c.env, id, c.get('user').teamId))) return c.json({ error: 'Group not found' }, 404);
    const nm = cleanGroupName((await c.req.json<{ name?: unknown }>().catch(() => ({} as { name?: unknown }))).name);
    if (!nm.ok) return c.json({ error: nm.reason }, 400);
    await c.env.DB.prepare('UPDATE chat_group SET name = ? WHERE id = ?').bind(nm.name, id).run();
    const group = (await groupInfo(c.env, id))!;
    await broadcast(c.env, { type: 'chat-group', id }, group.members);
    return c.json({ group });
  });

  app.post('/chat/groups/:id/members', requireAuth, async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await isMember(c.env, id, c.get('user').teamId))) return c.json({ error: 'Group not found' }, 404);
    const { teamId } = await c.req.json<{ teamId?: string }>().catch(() => ({} as { teamId?: string }));
    if (typeof teamId !== 'string' || !(await allTeamIds(c.env)).includes(teamId)) return c.json({ error: 'Unknown team' }, 400);
    const members = await groupMembers(c.env, id);
    if (members.includes(teamId)) return c.json({ error: 'Already in the group' }, 409);
    if (members.length >= MAX_GROUP) return c.json({ error: `A group can have at most ${MAX_GROUP} teams` }, 400);
    const now = (await c.env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM chat_message').first<{ m: number }>())?.m ?? 0;
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO chat_group_member (group_id, team_id, from_id) VALUES (?, ?, ?)').bind(id, teamId, now),
      c.env.DB.prepare('UPDATE chat_group SET member_key = ? WHERE id = ?').bind(memberKey([...members, teamId]), id),
    ]);
    await syncGroup(c.env, id, [...members, teamId]);
    const group = (await groupInfo(c.env, id))!;
    await broadcast(c.env, { type: 'chat-group', id }, group.members);
    return c.json({ group });
  });

  // Leave a group. When the last team leaves, the group and its messages are deleted.
  app.delete('/chat/groups/:id/members/me', requireAuth, async (c) => {
    const id = Number(c.req.param('id')), team = c.get('user').teamId;
    if (!team || !(await isMember(c.env, id, team))) return c.json({ error: 'Group not found' }, 404);
    const before = await groupMembers(c.env, id);
    const rest = before.filter((t) => t !== team);
    if (rest.length === 0) {
      const imgs = (await c.env.DB.prepare('SELECT image_key AS k FROM chat_message WHERE group_id = ? AND image_key IS NOT NULL').bind(id).all<{ k: string }>()).results;
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM chat_message WHERE group_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM chat_group WHERE id = ?').bind(id),     // members and read markers cascade
        ...imgs.map((i) => c.env.DB.prepare('DELETE FROM chat_upload WHERE key = ?').bind(i.k)),
      ]);
      for (const i of imgs) await c.env.LOGOS.delete(`chat/${i.k}`).catch(() => {});
      await syncGroup(c.env, id, null);
    } else {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM chat_group_member WHERE group_id = ? AND team_id = ?').bind(id, team),
        c.env.DB.prepare('UPDATE chat_group SET member_key = ? WHERE id = ?').bind(memberKey(rest), id),
      ]);
      await syncGroup(c.env, id, rest);
    }
    await broadcast(c.env, { type: 'chat-group', id }, before);       // everyone (including the leaver) refreshes their list
    return c.json({ ok: true });
  });

  app.post('/chat/group-read', requireAuth, async (c) => {
    const u = c.get('user');
    const { groupId, lastId } = await c.req.json<{ groupId: number; lastId: number }>().catch(() => ({} as { groupId: number; lastId: number }));
    if (!Number.isInteger(groupId) || !Number.isInteger(lastId) || lastId < 0) return c.json({ error: 'Bad request' }, 400);
    if (!(await isMember(c.env, groupId, u.teamId))) return c.json({ error: 'Group not found' }, 404);
    const top = (await c.env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM chat_message WHERE group_id = ?').bind(groupId).first<{ m: number }>())?.m ?? 0;
    const upTo = Math.min(lastId, top);
    const prev = (await c.env.DB.prepare('SELECT shared_id AS l FROM group_read WHERE user_id = ? AND group_id = ?').bind(u.id, groupId).first<{ l: number }>())?.l ?? 0;
    const share = await wantsReceipts(c.env, u.id);
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO group_read (user_id, group_id, last_id, shared_id, read_at) VALUES (?1, ?2, ?3, ?5, ?4)
       ON CONFLICT(user_id, group_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id),
         read_at = CASE WHEN ?5 > shared_id THEN ?4 ELSE read_at END, shared_id = MAX(shared_id, ?5)`,
    ).bind(u.id, groupId, upTo, now, share ? upTo : 0).run();
    if (share && upTo > prev) {
      const listeners: string[] = [];
      for (const t of await groupMembers(c.env, groupId)) if (t !== u.teamId && (await teamWantsReceipts(c.env, t))) listeners.push(t);
      if (listeners.length) await broadcast(c.env, { type: 'chat-read', scope: 'group', group: groupId, teamId: u.teamId!, lastId: upTo, at: now }, listeners);
    }
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------ search
  // Searches only what you are allowed to read: the league room, your own direct messages, and the groups you are in
  // (from when you joined). `scope` narrows it: all | league | private | dm:<team> | group:<id>. Newest first; `before` pages back.
  app.get('/chat/search', requireAuth, async (c) => {
    const team = c.get('user').teamId ?? '';
    const q = cleanQuery(c.req.query('q'));
    if (!q) return c.json({ error: 'Type at least 2 characters to search' }, 400);
    const scope = c.req.query('scope') ?? 'all';
    const from = c.req.query('from');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30), 1), 50);
    const before = Number(c.req.query('before') ?? 0);

    const league = '(m.to_team IS NULL AND m.group_id IS NULL)';
    const dm = '(m.to_team IS NOT NULL AND (m.team_id = ?2 OR m.to_team = ?2))';
    const grp = '(m.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM chat_group_member gm WHERE gm.group_id = m.group_id AND gm.team_id = ?2 AND m.id > gm.from_id))';
    let where: string, extra: unknown[] = [];
    if (scope === 'league') where = league;
    else if (scope === 'private') where = `(${dm} OR ${grp})`;
    else if (scope.startsWith('dm:')) { where = `(${dm} AND (m.team_id = ?5 OR m.to_team = ?5))`; extra = [scope.slice(3)]; }
    else if (scope.startsWith('group:')) { where = `(${grp} AND m.group_id = ?5)`; extra = [Number(scope.slice(6))]; }
    else where = `(${league} OR ${dm} OR ${grp})`;

    const { results } = await c.env.DB.prepare(
      `SELECT ${COLS} FROM ${FROM}
        WHERE m.body LIKE ?1 ESCAPE '\\' AND ${where} AND (?3 IS NULL OR m.team_id = ?3) AND (?4 = 0 OR m.id < ?4)
        ORDER BY m.id DESC LIMIT ${limit + 1}`,
    ).bind(likePattern(q), team, from ?? null, before, ...extra).all<Row>();
    const hits = results.slice(0, limit).map(toMessage);
    const out = hits.map((m) => ({
      message: m,
      where: m.groupId ? { kind: 'group' as const, id: m.groupId } : m.toTeam ? { kind: 'dm' as const, team: m.teamId === team ? m.toTeam : m.teamId } : { kind: 'league' as const },
    }));
    return c.json({ q, results: out, hasMore: results.length > limit });
  });

  // ------------------------------------------------------------------ settings
  app.get('/chat/settings', requireAuth, async (c) => c.json({ readReceipts: await wantsReceipts(c.env, c.get('user').id) }));
  app.put('/chat/settings', requireAuth, async (c) => {
    const { readReceipts } = await c.req.json<{ readReceipts?: unknown }>().catch(() => ({} as { readReceipts?: unknown }));
    if (typeof readReceipts !== 'boolean') return c.json({ error: 'readReceipts must be true or false' }, 400);
    await c.env.DB.prepare('UPDATE user SET read_receipts = ? WHERE id = ?').bind(readReceipts ? 1 : 0, c.get('user').id).run();
    return c.json({ readReceipts });
  });

  // ------------------------------------------------------------------ unread
  app.get('/chat/unread', requireAuth, async (c) => {
    const u = c.get('user');
    const last = (await c.env.DB.prepare('SELECT last_id AS id FROM chat_read WHERE user_id = ?').bind(u.id).first<{ id: number }>())?.id ?? 0;
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(EXISTS (SELECT 1 FROM json_each(mentions_json) WHERE value = ?2)), 0) AS mentions
         FROM chat_message WHERE id > ?1 AND team_id != ?2 AND to_team IS NULL AND group_id IS NULL`,
    ).bind(last, u.teamId ?? '').first<{ n: number; mentions: number }>();
    const dm = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM chat_message m WHERE m.to_team = ?1 AND m.id > COALESCE((SELECT last_id FROM dm_read WHERE user_id = ?2 AND partner = m.team_id), 0)`,
    ).bind(u.teamId ?? '', u.id).first<{ n: number }>();
    const grp = await groupUnread(c.env, u.id, u.teamId);
    // "dm" is every private conversation: one-to-one and group.
    return c.json({ count: row?.n ?? 0, mentions: row?.mentions ?? 0, dm: (dm?.n ?? 0) + grp });
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
    const b = await c.req.json<{ body?: string; replyTo?: number; toTeam?: string; groupId?: number; imageKey?: string }>().catch(() => ({} as { body?: string }));
    const text = cleanText(b.body);
    const { replyTo, toTeam, imageKey } = b as { replyTo?: number; toTeam?: string; imageKey?: string };
    const groupId = (b as { groupId?: number }).groupId;
    if (!text && !imageKey) return c.json({ error: 'Write something first' }, 400);
    if ([...text].length > MAX_BODY) return c.json({ error: `Messages are limited to ${MAX_BODY} characters` }, 400);

    const teams = await allTeamIds(c.env);
    if (toTeam != null && (toTeam === u.teamId || !teams.includes(toTeam))) return c.json({ error: 'Pick another team to message' }, 400);

    if (groupId != null) {
      if (toTeam != null || !Number.isInteger(groupId)) return c.json({ error: 'Pick one conversation' }, 400);
      if (!(await c.env.DB.prepare('SELECT 1 FROM chat_group_member WHERE group_id = ? AND team_id = ?').bind(groupId, u.teamId).first())) return c.json({ error: 'You aren’t in that group' }, 403);
    }
    if (replyTo != null) {
      const orig = await one(c.env, Number(replyTo));
      const sameThread = orig && (groupId != null ? orig.groupId === groupId
        : toTeam ? orig.toTeam && !orig.groupId && ((orig.teamId === u.teamId && orig.toTeam === toTeam) || (orig.teamId === toTeam && orig.toTeam === u.teamId)) : !orig.toTeam && !orig.groupId);
      if (!sameThread) return c.json({ error: 'You can only reply within the same conversation' }, 400);
    }
    if (imageKey) {
      const up = await c.env.DB.prepare('SELECT 1 FROM chat_upload WHERE key = ? AND team_id = ? AND used = 0').bind(imageKey, u.teamId).first();
      if (!up) return c.json({ error: 'That image upload isn’t available' }, 400);
    }

    const now = Date.now();
    const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE team_id = ? AND created_at > ?').bind(u.teamId, now - RATE_LIMIT.windowMs).first<{ n: number }>();
    if ((recent?.n ?? 0) >= RATE_LIMIT.count) return c.json({ error: 'Slow down — too many messages at once' }, 429);

    const mentions = toTeam || groupId != null ? [] : parseMentions(text, teams, u.teamId);       // @mentions are for the league room
    const stmts = [
      c.env.DB.prepare('INSERT INTO chat_message (team_id, to_team, group_id, body, pinned, reactions_json, created_at, reply_to, image_key, mentions_json) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)')
        .bind(u.teamId, toTeam ?? null, groupId ?? null, text, '{}', now, replyTo ?? null, imageKey ?? null, JSON.stringify(mentions)),
      ...(imageKey ? [c.env.DB.prepare('UPDATE chat_upload SET used = 1 WHERE key = ?').bind(imageKey)] : []),
    ];
    const res = await c.env.DB.batch(stmts);
    const message = (await one(c.env, Number(res[0].meta.last_row_id)))!;
    await broadcast(c.env, { type: 'chat', message }, await audience(c.env, message));
    return c.json(message, 201);
  });

  app.patch('/chat/:id', requireAuth, async (c) => {
    const u = c.get('user');
    const msg = await one(c.env, Number(c.req.param('id')));
    if (!msg || !(await canSee(c.env, msg, u.teamId))) return c.json({ error: 'Message not found' }, 404);
    if (msg.teamId !== u.teamId) return c.json({ error: 'You can only edit your own messages' }, 403);   // not even the commissioner
    const text = cleanText((await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }))).body);
    if (!text && !msg.imageKey) return c.json({ error: 'A message needs some text (or delete it)' }, 400);
    if ([...text].length > MAX_BODY) return c.json({ error: `Messages are limited to ${MAX_BODY} characters` }, 400);
    const mentions = isPrivate(msg) ? [] : parseMentions(text, await allTeamIds(c.env), u.teamId);
    if (text === msg.body) return c.json(msg);                                                          // nothing changed: don't mark it edited
    await c.env.DB.prepare('UPDATE chat_message SET body = ?, mentions_json = ?, edited_at = ? WHERE id = ?').bind(text, JSON.stringify(mentions), Date.now(), msg.id).run();
    const message = (await one(c.env, msg.id))!;
    await broadcast(c.env, { type: 'chat-edit', message }, await audience(c.env, message));
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
    if (!msg || !(await canSee(c.env, msg, u.teamId))) return c.json({ error: 'Message not found' }, 404);
    const set = new Set(msg.reactions[emoji] ?? []);
    if (set.has(u.teamId)) set.delete(u.teamId); else set.add(u.teamId);
    const reactions = { ...msg.reactions };
    if (set.size) reactions[emoji] = [...set]; else delete reactions[emoji];
    await c.env.DB.prepare('UPDATE chat_message SET reactions_json = ? WHERE id = ?').bind(JSON.stringify(reactions), msg.id).run();
    await broadcast(c.env, { type: 'chat-react', id: msg.id, reactions }, await audience(c.env, msg));
    return c.json({ reactions });
  });

  // The pinned message is the commissioner's announcement for the league room; only one at a time.
  app.put('/chat/:id/pin', requireAuth, requireCommissioner, async (c) => {
    const id = Number(c.req.param('id'));
    const { pinned } = await c.req.json<{ pinned: boolean }>();
    const msg = await one(c.env, id);
    if (!msg || isPrivate(msg)) return c.json({ error: 'Message not found' }, 404);          // a private message can't be pinned
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
    if (!msg || !(await canSee(c.env, msg, u.teamId))) return c.json({ error: 'Message not found' }, 404);
    const allowed = msg.teamId === u.teamId || (u.isCommissioner && !isPrivate(msg));
    if (!allowed) return c.json({ error: 'You can only delete your own messages' }, 403);
    await c.env.DB.prepare('DELETE FROM chat_message WHERE id = ?').bind(id).run();
    if (msg.imageKey) {
      await c.env.DB.prepare('DELETE FROM chat_upload WHERE key = ?').bind(msg.imageKey).run();
      await c.env.LOGOS.delete(`chat/${msg.imageKey}`).catch(() => {});
    }
    await broadcast(c.env, { type: 'chat-delete', id }, await audience(c.env, msg));
    return c.json({ ok: true });
  });
}
