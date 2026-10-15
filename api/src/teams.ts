import type { Hono } from 'hono';
import { requireAuth } from './auth';
import { broadcast } from './realtime';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const NAME_MIN = 2, NAME_MAX = 40;

/**
 * What an upload really is, from its first bytes — never from the declared Content-Type or filename.
 * SVG is deliberately not accepted: it can carry scripts.
 */
export function sniffImage(b: Uint8Array): { ext: 'png' | 'jpg' | 'webp'; type: string } | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: 'png', type: 'image/png' };
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return { ext: 'jpg', type: 'image/jpeg' };
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: 'webp', type: 'image/webp' };
  return null;
}

export function registerTeams(app: App) {
  const canEdit = (u: AppVars['user'], teamId: string) => u.isCommissioner || u.teamId === teamId;

  // Upload (raw image bytes in the body). Replaces any existing logo.
  app.put('/teams/:id/logo', requireAuth, async (c) => {
    const teamId = c.req.param('id') as string;
    if (!canEdit(c.get('user'), teamId)) return c.json({ error: 'You can only change your own team’s logo' }, 403);
    const team = await c.env.DB.prepare('SELECT logo_key AS logoKey FROM team WHERE id = ?').bind(teamId).first<{ logoKey: string | null }>();
    if (!team) return c.json({ error: 'Team not found' }, 404);

    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_LOGO_BYTES) return c.json({ error: 'That image is too large (2 MB max)' }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_LOGO_BYTES) return c.json({ error: 'That image is too large (2 MB max)' }, 413);
    if (bytes.length === 0) return c.json({ error: 'No image received' }, 400);
    const kind = sniffImage(bytes);
    if (!kind) return c.json({ error: 'Use a PNG, JPEG or WebP image' }, 415);

    const key = `${teamId}-${crypto.randomUUID()}.${kind.ext}`;
    await c.env.LOGOS.put(`logos/${key}`, bytes, { httpMetadata: { contentType: kind.type } });
    await c.env.DB.prepare('UPDATE team SET logo_key = ? WHERE id = ?').bind(key, teamId).run();
    if (team.logoKey) await c.env.LOGOS.delete(`logos/${team.logoKey}`).catch(() => {});   // best effort; the old file is unreferenced either way
    await broadcast(c.env, { type: 'team', id: teamId });
    return c.json({ logoKey: key });
  });

  app.delete('/teams/:id/logo', requireAuth, async (c) => {
    const teamId = c.req.param('id') as string;
    if (!canEdit(c.get('user'), teamId)) return c.json({ error: 'You can only change your own team’s logo' }, 403);
    const team = await c.env.DB.prepare('SELECT logo_key AS logoKey FROM team WHERE id = ?').bind(teamId).first<{ logoKey: string | null }>();
    if (!team) return c.json({ error: 'Team not found' }, 404);
    await c.env.DB.prepare('UPDATE team SET logo_key = NULL WHERE id = ?').bind(teamId).run();
    if (team.logoKey) await c.env.LOGOS.delete(`logos/${team.logoKey}`).catch(() => {});
    await broadcast(c.env, { type: 'team', id: teamId });
    return c.json({ logoKey: null });
  });

  // Logos are public: <img> tags can't send an Authorization header, and the file names are random and unguessable.
  app.get('/logos/:file', async (c) => {
    const file = c.req.param('file') as string;
    if (!/^[A-Za-z0-9]{1,8}-[0-9a-f-]{36}\.(png|jpg|webp)$/.test(file)) return c.text('Not found', 404);
    const obj = await c.env.LOGOS.get(`logos/${file}`);
    if (!obj) return c.text('Not found', 404);
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',   // a new upload gets a new name, so this is safe
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'cross-origin',
        'access-control-allow-origin': '*',
      },
    });
  });

  app.patch('/teams/:id', requireAuth, async (c) => {
    const teamId = c.req.param('id') as string;
    if (!canEdit(c.get('user'), teamId)) return c.json({ error: 'You can only rename your own team' }, 403);
    const b = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
    // eslint-disable-next-line no-control-regex
    const name = (b.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if ([...name].length < NAME_MIN || [...name].length > NAME_MAX) return c.json({ error: `Team names are ${NAME_MIN}–${NAME_MAX} characters` }, 400);
    const clash = await c.env.DB.prepare('SELECT 1 FROM team WHERE lower(name) = lower(?) AND id != ?').bind(name, teamId).first();
    if (clash) return c.json({ error: 'Another team already has that name' }, 409);
    const r = await c.env.DB.prepare('UPDATE team SET name = ? WHERE id = ?').bind(name, teamId).run();
    if (!r.meta.changes) return c.json({ error: 'Team not found' }, 404);
    await broadcast(c.env, { type: 'team', id: teamId });
    return c.json({ name });
  });
}
