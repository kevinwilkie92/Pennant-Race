import type { DraftEvent } from './draft-room';
import type { Env } from './types';

/** The one Durable Object that fans events out to every connected client (draft, keepers, chat). */
export const room = (env: Env) => env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName('league'));
export const broadcast = (env: Env, ev: DraftEvent) =>
  room(env).fetch('https://room/broadcast', { method: 'POST', body: JSON.stringify(ev) });
