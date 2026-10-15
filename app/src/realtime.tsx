import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_URL, getToken } from './api';

type Handler = (event: { type: string; [k: string]: unknown }) => void;
const Ctx = createContext<{ subscribe: (h: Handler) => () => void; connected: boolean }>({ subscribe: () => () => {}, connected: false });

/** One live connection to the league room, shared by anything that wants events (chat, and later more). Reconnects on its own. */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const handlers = useRef(new Set<Handler>());
  const [connected, setConnected] = useState(false);
  const subscribe = useCallback((h: Handler) => { handlers.current.add(h); return () => { handlers.current.delete(h); }; }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/draft/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        try { const ev = JSON.parse(String(m.data)); handlers.current.forEach((h) => h(ev)); } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => { setConnected(false); if (!closed) retry = setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, []);

  return <Ctx.Provider value={{ subscribe, connected }}>{children}</Ctx.Provider>;
}
export const useRealtime = () => useContext(Ctx);
