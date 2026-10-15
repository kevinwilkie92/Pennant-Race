import type { DraftEvent } from './draft-room';
import type { Env } from './types';

/** The one Durable Object that fans events out to every connected client (draft, keepers, chat, team changes). */
export const room = (env: Env) => env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName('league'));

/** Sends an event to everyone, or — with `to` — only to the listed teams (used for direct messages). */
export const broadcast = (env: Env, ev: DraftEvent, to?: string[]) =>
  room(env).fetch('https://room/broadcast', { method: 'POST', body: JSON.stringify({ ev, to }) });
