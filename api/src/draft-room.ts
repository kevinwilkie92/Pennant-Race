// One Durable Object per league. It fans events out over WebSockets so every client stays in sync
// (draft sales, hat draws, keepers, chat, team changes) and relays typing indicators.
// D1 remains the source of truth; the DO only broadcasts. Each socket is tagged with its team id so
// private events (direct messages) reach only the people they concern.

/** A chat message as sent to clients. `reactions` maps an emoji to the team ids that reacted with it. */
export type ChatMessage = {
  id: number; teamId: string; toTeam: string | null; groupId: number | null; body: string; createdAt: number; editedAt: number | null; pinned: boolean;
  reactions: Record<string, string[]>; imageKey: string | null; mentions: string[];
  replyTo: { id: number; teamId?: string; body?: string; hasImage?: boolean; deleted?: boolean } | null;
};

/** The player currently "on the block" in the auction, and the live leading bid if the commissioner is tracking one. */
export type Nomination = {
  playerId: number; name: string; mlbTeam: string | null; positions: string[];
  teamId: string | null; bid: number | null; at: number;
};

export type DraftEvent =
  | { type: 'sale'; season: number; playerId: number; teamId: string; price: number; seq: number }
  | { type: 'undo'; season: number; seq: number }
  | { type: 'keepers'; season: number }
  | { type: 'team'; id: string }                    // a team's name or logo changed
  | { type: 'hat'; mlbTeam: string | null }
  | { type: 'nomination'; nomination: Nomination | null }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat-edit'; message: ChatMessage }
  | { type: 'chat-react'; id: number; reactions: Record<string, string[]> }
  | { type: 'chat-pin'; pinned: ChatMessage | null }
  | { type: 'chat-delete'; id: number }
  | { type: 'league' }                                // league settings or commissioners changed
  | { type: 'chat-read'; scope: 'dm' | 'group'; group?: number; teamId: string; lastId: number; at: number }   // someone read up to lastId
  | { type: 'chat-group'; id: number }              // a group was created, renamed, or its members changed
  | { type: 'typing'; teamId: string; scope: 'league' | 'dm' | 'group'; group?: number };

const TYPING_MIN_GAP_MS = 800;

export class DraftRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const team = req.headers.get('x-team-id') ?? '';          // set by the Worker after checking the token — clients can't choose it
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], team ? [team] : []);  // hibernation API: the socket survives DO eviction
      pair[1].serializeAttachment({ team, lastTyping: 0 });
      const hat = (await this.state.storage.get<string | null>('hat')) ?? null;
      pair[1].send(JSON.stringify({ type: 'hat', mlbTeam: hat } satisfies DraftEvent));
      const nom = (await this.state.storage.get<Nomination | null>('nomination')) ?? null;
      if (nom) pair[1].send(JSON.stringify({ type: 'nomination', nomination: nom } satisfies DraftEvent));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // The Worker tells us who is in each group so typing signals reach only its members (we can't see the database).
    if (url.pathname === '/group-members' && req.method === 'POST') {
      const { id, teams } = (await req.json()) as { id: number; teams: string[] | null };
      if (teams) await this.state.storage.put(`grp:${id}`, teams); else await this.state.storage.delete(`grp:${id}`);
      return new Response('ok');
    }

    if (url.pathname === '/broadcast' && req.method === 'POST') {
      const { ev, to } = (await req.json()) as { ev: DraftEvent; to?: string[] };
      if (ev.type === 'hat') await this.state.storage.put('hat', ev.mlbTeam);
      if (ev.type === 'nomination') await this.state.storage.put('nomination', ev.nomination);
      const msg = JSON.stringify(ev);
      // `to` limits delivery to sockets tagged with those teams (direct messages). No `to` means everyone.
      const targets = to ? [...new Set(to.flatMap((t) => this.state.getWebSockets(t)))] : this.state.getWebSockets();
      for (const ws of targets) {
        try { ws.send(msg); } catch { /* closed; the runtime cleans up */ }
      }
      return new Response('ok');
    }

    if (url.pathname === '/nomination') {
      return Response.json({ nomination: (await this.state.storage.get<Nomination | null>('nomination')) ?? null });
    }

    if (url.pathname === '/hat') {
      return Response.json({ mlbTeam: (await this.state.storage.get<string | null>('hat')) ?? null });
    }
    return new Response('Not found', { status: 404 });
  }

  // Clients are listeners; the only thing they may send is a typing signal. Everything else goes through the
  // authenticated REST API.
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 200) return;
    let m: { type?: string; scope?: string };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type !== 'typing' || typeof m.scope !== 'string' || !/^(league|group:\d{1,9}|[A-Za-z0-9]{1,8})$/.test(m.scope)) return;

    const att = (ws.deserializeAttachment() ?? {}) as { team?: string; lastTyping?: number };
    if (!att.team) return;
    const now = Date.now();
    if (now - (att.lastTyping ?? 0) < TYPING_MIN_GAP_MS) return;     // cheap flood protection
    ws.serializeAttachment({ ...att, lastTyping: now });

    if (m.scope.startsWith('group:')) {
      const id = Number(m.scope.slice(6));
      const members = (await this.state.storage.get<string[]>(`grp:${id}`)) ?? [];
      if (!members.includes(att.team)) return;                            // only members can signal, and only to members
      const gev: DraftEvent = { type: 'typing', teamId: att.team, scope: 'group', group: id };
      for (const t of new Set(members.flatMap((x) => this.state.getWebSockets(x)))) {
        if (t === ws) continue;
        try { t.send(JSON.stringify(gev)); } catch { /* closed */ }
      }
      return;
    }

    const league = m.scope === 'league';
    const ev: DraftEvent = { type: 'typing', teamId: att.team, scope: league ? 'league' : 'dm' };
    // league typing goes to everyone else; a DM typing signal goes only to the person it is addressed to
    const targets = league ? this.state.getWebSockets() : this.state.getWebSockets(m.scope);
    for (const t of targets) {
      if (t === ws) continue;
      try { t.send(JSON.stringify(ev)); } catch { /* closed */ }
    }
  }

  webSocketClose(ws: WebSocket) { try { ws.close(); } catch { /* already closed */ } }
}
