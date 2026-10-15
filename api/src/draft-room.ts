// One Durable Object per league. Holds the live hat-draw state and fans out events
// (sales, undo, hat draws, chat) over WebSockets so the TV board, commissioner and phones stay in sync.
// D1 remains the source of truth for sales; the DO only broadcasts.

export type DraftEvent =
  | { type: 'sale'; season: number; playerId: number; teamId: string; price: number; seq: number }
  | { type: 'undo'; season: number; seq: number }
  | { type: 'keepers'; season: number }
  | { type: 'hat'; mlbTeam: string | null }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat-react'; id: number; reactions: Record<string, string[]> }
  | { type: 'chat-pin'; pinned: ChatMessage | null }
  | { type: 'chat-delete'; id: number };

/** A chat message as sent to clients. `reactions` maps an emoji to the team ids that reacted with it. */
export type ChatMessage = {
  id: number; teamId: string; body: string; createdAt: number; pinned: boolean; reactions: Record<string, string[]>;
};

export class DraftRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]); // hibernation API: socket survives DO eviction
      const hat = (await this.state.storage.get<string | null>('hat')) ?? null;
      pair[1].send(JSON.stringify({ type: 'hat', mlbTeam: hat } satisfies DraftEvent));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === '/broadcast' && req.method === 'POST') {
      const ev = (await req.json()) as DraftEvent;
      if (ev.type === 'hat') await this.state.storage.put('hat', ev.mlbTeam);
      const msg = JSON.stringify(ev);
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(msg); } catch { /* closed; runtime cleans up */ }
      }
      return new Response('ok');
    }

    if (url.pathname === '/hat') {
      return Response.json({ mlbTeam: (await this.state.storage.get<string | null>('hat')) ?? null });
    }
    return new Response('Not found', { status: 404 });
  }

  // Clients are read-only listeners; ignore inbound messages (writes go through the authenticated REST API).
  webSocketMessage() {}
  webSocketClose(ws: WebSocket) { try { ws.close(); } catch { /* already closed */ } }
}
