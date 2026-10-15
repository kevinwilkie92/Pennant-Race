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
