// Chat text rules shared by the API (who was mentioned) and the app (how a message is drawn).

/** Team ids named as `@XX` in a message — each once, never yourself, only teams that exist. Case-insensitive. */
export function parseMentions(text: string, teamIds: string[], self?: string): string[] {
  const byLower = new Map(teamIds.map((id) => [id.toLowerCase(), id]));
  const found = new Set<string>();
  for (const m of text.matchAll(/(^|[^A-Za-z0-9])@([A-Za-z0-9]{1,8})(?![A-Za-z0-9])/g)) {
    const id = byLower.get(m[2].toLowerCase());
    if (id && id !== self) found.add(id);
  }
  return [...found];
}

export type Segment = { text: string } | { mention: string };

/** Splits a message into plain text and mentions, so the app can show `@RC` as the team's current name. */
export function splitMentions(text: string, teamIds: string[]): Segment[] {
  const byLower = new Map(teamIds.map((id) => [id.toLowerCase(), id]));
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(/(^|[^A-Za-z0-9])@([A-Za-z0-9]{1,8})(?![A-Za-z0-9])/g)) {
    const id = byLower.get(m[2].toLowerCase());
    if (!id) continue;
    const start = (m.index ?? 0) + m[1].length;               // position of the '@'
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ mention: id });
    last = start + 1 + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/** The `@` word being typed at the end of the text (for the suggestion list), or null. */
export function activeMention(text: string): string | null {
  const m = text.match(/(?:^|[^A-Za-z0-9])@([A-Za-z0-9]{0,8})$/);
  return m ? m[1] : null;
}

/** Replaces the unfinished `@word` at the end with a completed `@ID `. */
export function completeMention(text: string, id: string): string {
  return text.replace(/@([A-Za-z0-9]{0,8})$/, `@${id} `);
}

// ------------------------------------------------------------------ crop

export type CropInput = {
  /** natural image size in pixels */ width: number; height: number;
  /** side of the square preview window, in screen units */ view: number;
  /** 1 = the shorter side just fills the window; larger zooms in */ zoom: number;
  /** image top-left relative to the window's top-left, in screen units (<= 0) */ x: number; y: number;
};

/** Screen scale at a given zoom: the shorter image side fills the window at zoom 1. */
export const cropScale = (c: Pick<CropInput, 'width' | 'height' | 'view' | 'zoom'>) => (c.view / Math.min(c.width, c.height)) * Math.max(1, c.zoom);

/** Keeps the image covering the whole window (no empty edges) while dragging or zooming. */
export function clampOffset(c: CropInput): { x: number; y: number } {
  const s = cropScale(c);
  const minX = Math.min(0, c.view - c.width * s), minY = Math.min(0, c.view - c.height * s);
  return { x: Math.max(minX, Math.min(0, c.x)), y: Math.max(minY, Math.min(0, c.y)) };
}

/** The square region of the original image the window is showing, in source pixels. */
export function cropRect(c: CropInput): { originX: number; originY: number; size: number } {
  const s = cropScale(c);
  const { x, y } = clampOffset(c);
  const size = Math.min(c.view / s, c.width, c.height);
  return {
    originX: Math.max(0, Math.min(c.width - size, Math.round(-x / s))),
    originY: Math.max(0, Math.min(c.height - size, Math.round(-y / s))),
    size: Math.round(size),
  };
}

/** After changing zoom, keep whatever is at the window's centre in place. */
export function zoomAround(c: CropInput, nextZoom: number): { zoom: number; x: number; y: number } {
  const z = Math.max(1, Math.min(8, nextZoom));
  const s0 = cropScale(c), s1 = cropScale({ ...c, zoom: z });
  const cx = (c.view / 2 - c.x) / s0, cy = (c.view / 2 - c.y) / s0;       // source point under the centre
  const o = clampOffset({ ...c, zoom: z, x: c.view / 2 - cx * s1, y: c.view / 2 - cy * s1 });
  return { zoom: z, ...o };
}

// ------------------------------------------------------------ group conversations

export const MIN_GROUP = 3;        // fewer than 3 teams is just a direct message
export const MAX_GROUP = 8;
export const MAX_GROUP_NAME = 40;

/** Stable identity of a set of teams, for finding "the group with exactly these teams". */
export const memberKey = (teams: string[]) => [...new Set(teams)].sort().join(',');

export type GroupCheck = { ok: true; members: string[] } | { ok: false; reason: string };

/** The creator plus the teams they picked: known teams only, no repeats, between MIN_GROUP and MAX_GROUP in all. */
export function validateGroup(creator: string, others: unknown, allTeams: string[]): GroupCheck {
  if (!Array.isArray(others) || others.some((x) => typeof x !== 'string')) return { ok: false, reason: 'Pick the teams to include' };
  const members = [...new Set([creator, ...(others as string[])])];
  if (members.some((t) => !allTeams.includes(t))) return { ok: false, reason: 'Unknown team' };
  if (members.length < MIN_GROUP) return { ok: false, reason: `A group needs at least ${MIN_GROUP} teams (including yours). Use a direct message for two.` };
  if (members.length > MAX_GROUP) return { ok: false, reason: `A group can have at most ${MAX_GROUP} teams` };
  return { ok: true, members };
}

/** A group's display name: its own name, else the other teams' names ("Rally Cats, Hogan's Heroes +2"). */
export function groupTitle(name: string | null | undefined, otherNames: string[]): string {
  const own = name?.trim();
  if (own) return own;
  const shown = otherNames.slice(0, 2).join(', ');
  return otherNames.length > 2 ? `${shown} +${otherNames.length - 2}` : shown || 'Group';
}

/** Trims and bounds a group name; empty clears it. */
export function cleanGroupName(raw: unknown): { ok: true; name: string | null } | { ok: false; reason: string } {
  if (raw === null || raw === undefined) return { ok: true, name: null };
  if (typeof raw !== 'string') return { ok: false, reason: 'Name must be text' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if ([...name].length > MAX_GROUP_NAME) return { ok: false, reason: `Names are limited to ${MAX_GROUP_NAME} characters` };
  return { ok: true, name: name || null };
}

// ------------------------------------------------------------ read receipts

export type Receipt = { teamId: string; lastId: number; at: number | null };

/** The id of the newest message `team` has sent in this list (messages are oldest → newest). */
export function lastSentBy(messages: { id: number; teamId: string }[], team: string | null): number | null {
  if (!team) return null;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].teamId === team) return messages[i].id;
  return null;
}

/** Who has read message `id`, out of everyone else in the conversation. */
export function seenBy(id: number, receipts: Receipt[], others: number): { teams: string[]; at: number | null; all: boolean } {
  const seen = receipts.filter((r) => r.lastId >= id);
  return { teams: seen.map((r) => r.teamId), at: seen.reduce<number | null>((t, r) => (r.at != null && (t == null || r.at > t) ? r.at : t), null), all: others > 0 && seen.length === others };
}

/** "Seen", "Seen by RC, MJ", or "Seen by everyone" for a group; null if nobody has. */
export function seenLabel(s: { teams: string[]; all: boolean }, name: (t: string) => string, group: boolean): string | null {
  if (s.teams.length === 0) return null;
  if (!group) return 'Seen';
  return s.all ? 'Seen by everyone' : `Seen by ${s.teams.map(name).join(', ')}`;
}
