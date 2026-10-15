import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_URL, getToken } from './api';
import { useAuth } from './auth';

type Handler = (event: { type: string; [k: string]: unknown }) => void;
const Ctx = createContext<{ subscribe: (h: Handler) => () => void; connected: boolean; send: (msg: object) => void }>({
  subscribe: () => () => {}, connected: false, send: () => {},
});

/**
 * One live connection to the league room, shared by everything that wants events (draft, chat, team changes).
 * It connects when you're signed in, drops when you sign out, and reconnects on its own.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const handlers = useRef(new Set<Handler>());
  const socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const subscribe = useCallback((h: Handler) => { handlers.current.add(h); return () => { handlers.current.delete(h); }; }, []);
  const send = useCallback((msg: object) => { if (socket.current?.readyState === 1) socket.current.send(JSON.stringify(msg)); }, []);
  const userId = me?.user.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/draft/ws?token=${encodeURIComponent(token)}`);
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        try { const ev = JSON.parse(String(m.data)); handlers.current.forEach((h) => h(ev)); } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => { setConnected(false); if (!closed) retry = setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); socket.current = null; setConnected(false); };
  }, [userId]);

  return <Ctx.Provider value={{ subscribe, connected, send }}>{children}</Ctx.Provider>;
}
export const useRealtime = () => useContext(Ctx);
