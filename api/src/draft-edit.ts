import type { Hono } from 'hono';
import { placePlayer, validateBid } from '@pennant/domain';
import { requireAuth, requireCommissioner } from './auth';
import { broadcast } from './realtime';
import { loadRoster } from './roster';
import type { AppVars, Env } from './types';

type App = Hono<{ Bindings: Env; Variables: AppVars }>;

/**
 * Corrections to an archived season's draft (commissioner only): change a price, give the player to another
 * team, or remove the sale. The live draft has its own undo, and a keeper sale is owned by the keepers screen,
 * so neither can be edited here. A player who was kept into a later season is locked, because that keeper's
 * cost and team were derived from this record.
 */
export function registerDraftEdit(app: App) {
  async function target(env: Env, yr: number, playerId: number) {
    const status = await env.DB.prepare('SELECT status FROM season WHERE year = ?').bind(yr).first<{ status: string }>();
    if (!status) return { error: 'No such season', code: 404 as const };
    if (status.status !== 'archived') return { error: 'Only archived drafts are edited here; use undo for the live draft', code: 409 as const };
    const sale = await env.DB.prepare('SELECT team_id AS teamId, price, is_keeper AS isKeeper FROM draft_sale WHERE season = ? AND player_id = ?')
      .bind(yr, playerId).first<{ teamId: string; price: number; isKeeper: number }>();
    if (!sale) return { error: 'That player was not drafted that season', code: 404 as const };
    if (sale.isKeeper) return { error: 'Keeper sales are changed on the keepers screen', code: 409 as const };
    const later = await env.DB.prepare('SELECT season FROM keeper WHERE player_id = ? AND season > ? LIMIT 1').bind(playerId, yr).first<{ season: number }>();
    if (later) return { error: `He was kept in ${later.season}, so this sale is locked`, code: 409 as const };
    return { sale };
  }

  const money = (env: Env, yr: number, teamId: string, exceptPlayer: number) =>
    env.DB.prepare('SELECT COALESCE(SUM(price), 0) AS spent, COUNT(*) AS filled FROM draft_sale WHERE season = ? AND team_id = ? AND player_id != ?')
      .bind(yr, teamId, exceptPlayer).first<{ spent: number; filled: number }>();

  app.patch('/draft/archive/:season/sales/:playerId', requireAuth, requireCommissioner, async (c) => {
    const yr = Number(c.req.param('season')), playerId = Number(c.req.param('playerId'));
    const b = await c.req.json<{ price?: number; teamId?: string }>().catch(() => ({} as { price?: number; teamId?: string }));
    if (b.price === undefined && b.teamId === undefined) return c.json({ error: 'Nothing to change' }, 400);
    const t = await target(c.env, yr, playerId);
    if ('error' in t) return c.json({ error: t.error }, t.code);

    const teamId = b.teamId ?? t.sale.teamId;
    const price = b.price ?? t.sale.price;
    if (!(await c.env.DB.prepare('SELECT 1 FROM team WHERE id = ?').bind(teamId).first())) return c.json({ error: 'Unknown team' }, 400);
    const m = await money(c.env, yr, teamId, playerId);
    const check = validateBid(price, m?.spent ?? 0, m?.filled ?? 0);
    if (!check.ok) return c.json({ error: check.reason }, 400);

    const stmts: D1PreparedStatement[] = [];
    if (teamId !== t.sale.teamId) {
      // If he is still on the old team's frozen roster, he moves to the new team's roster too (if there is room).
      const onOld = await c.env.DB.prepare('SELECT slot FROM roster_slot WHERE season = ? AND team_id = ? AND player_id = ?').bind(yr, t.sale.teamId, playerId).first<{ slot: string }>();
      if (onOld) {
        const dest = await loadRoster(c.env, yr, teamId);
        const stored = !!(await c.env.DB.prepare('SELECT 1 FROM roster_slot WHERE season = ? AND team_id = ? LIMIT 1').bind(yr, teamId).first());
        const me = (await loadRoster(c.env, yr, t.sale.teamId)).find((e) => e.playerId === playerId)!;
        const seated = dest.map((e) => ({ playerId: e.playerId, positions: e.positions, slot: e.slot }));
        const plan = placePlayer(seated, { playerId, positions: me.positions });
        if (!plan) return c.json({ error: 'That team has no roster spot he can fill' }, 409);
        stmts.push(c.env.DB.prepare('DELETE FROM roster_slot WHERE season = ? AND player_id = ?').bind(yr, playerId));
        const moved = (pid: number) => pid === playerId || !stored || seated.find((x) => x.playerId === pid)?.slot !== plan.get(pid);
        for (const e of dest) if (moved(e.playerId)) stmts.push(c.env.DB.prepare('DELETE FROM roster_slot WHERE season = ? AND player_id = ?').bind(yr, e.playerId));
        for (const [pid, slot] of plan) if (moved(pid)) {
          stmts.push(c.env.DB.prepare('INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (?, ?, ?, ?)').bind(yr, teamId, pid, slot));
        }
      }
    }
    stmts.push(c.env.DB.prepare('UPDATE draft_sale SET team_id = ?, price = ? WHERE season = ? AND player_id = ?').bind(teamId, price, yr, playerId));
    await c.env.DB.batch(stmts);
    await broadcast(c.env, { type: 'keepers', season: yr });   // open boards refetch
    return c.json({ ok: true, teamId, price });
  });

  app.delete('/draft/archive/:season/sales/:playerId', requireAuth, requireCommissioner, async (c) => {
    const yr = Number(c.req.param('season')), playerId = Number(c.req.param('playerId'));
    const t = await target(c.env, yr, playerId);
    if ('error' in t) return c.json({ error: t.error }, t.code);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM roster_slot WHERE season = ? AND team_id = ? AND player_id = ?').bind(yr, t.sale.teamId, playerId),
      c.env.DB.prepare('DELETE FROM draft_sale WHERE season = ? AND player_id = ?').bind(yr, playerId),
    ]);
    await broadcast(c.env, { type: 'keepers', season: yr });
    return c.json({ ok: true });
  });
}
