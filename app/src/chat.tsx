import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ChatMessage, type DmConversation } from './api';
import { ChatOverlay } from './ChatOverlay';
import { useAuth } from './auth';
import { useRealtime } from './realtime';
import { useTeams } from './teams';

export type Scope = 'league' | string;                       // 'league', or the other team's id for a direct-message thread
export type View = { kind: 'league' } | { kind: 'dms' } | { kind: 'dm'; team: string };
export type Thread = { messages: ChatMessage[]; hasMore: boolean; loaded: boolean };
const EMPTY: Thread = { messages: [], hasMore: false, loaded: false };
const TYPING_TTL = 4000, TYPING_SEND_GAP = 2500;

export type ChatState = {
  open: boolean; setOpen: (v: boolean) => void; view: View; setView: (v: View) => void;
  unread: { league: number; mentions: number; dm: number; total: number };
  league: Thread & { pinned: ChatMessage | null }; threads: Record<string, Thread>; convs: DmConversation[];
  emoji: string[]; connected: boolean; loading: boolean; myTeam: string | null;
  typingIn: (scope: Scope) => string[];                      // team ids currently typing there
  send: (scope: Scope, b: { body?: string; replyTo?: number; imageKey?: string }) => Promise<void>;
  edit: (id: number, body: string) => Promise<void>;
  react: (id: number, emoji: string) => Promise<void>; pin: (id: number, pinned: boolean) => Promise<void>; remove: (id: number) => Promise<void>;
  loadOlder: (scope: Scope) => Promise<void>; ensureThread: (team: string) => Promise<void>; sendTyping: (scope: Scope) => void;
};
const Ctx = createContext<ChatState | null>(null);
export const useChat = () => useContext(Ctx)!;

const merge = (list: ChatMessage[], m: ChatMessage) => (list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const { subscribe, connected, send: wsSend } = useRealtime();
  useTeams();                                                // (keeps team names live for the overlay)
  const userId = me?.user.id ?? null;
  const myTeam = me?.user.teamId ?? null;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: 'league' });
  const [loading, setLoading] = useState(true);
  const [emoji, setEmoji] = useState<string[]>(['👍', '🔥', '😂', '😮', '❤️', '👀']);
  const [league, setLeague] = useState<Thread & { pinned: ChatMessage | null }>({ ...EMPTY, pinned: null });
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [convs, setConvs] = useState<DmConversation[]>([]);
  const [unread, setUnread] = useState({ league: 0, mentions: 0, dm: 0 });
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [, tick] = useState(0);
  const openRef = useRef(open), viewRef = useRef(view);
  openRef.current = open; viewRef.current = view;
  const threadsRef = useRef(threads); threadsRef.current = threads;
  const leagueRef = useRef(league); leagueRef.current = league;
  const lastTypingSent = useRef(0);

  const scopeOf = useCallback((m: ChatMessage): Scope => (m.toTeam ? (m.teamId === myTeam ? m.toTeam : m.teamId) : 'league'), [myTeam]);
  const watching = (scope: Scope) => openRef.current && (scope === 'league' ? viewRef.current.kind === 'league' : viewRef.current.kind === 'dm' && (viewRef.current as { team: string }).team === scope);

  const loadDms = useCallback(async () => {
    try { const r = await api.chatDms(); setConvs(r.conversations); setUnread((u) => ({ ...u, dm: r.totalUnread })); } catch { /* keep */ }
  }, []);

  const markRead = useCallback((scope: Scope, list: ChatMessage[]) => {
    const last = list.length ? list[list.length - 1].id : 0;
    if (!last) return;
    if (scope === 'league') { api.chatRead(last).catch(() => {}); setUnread((u) => ({ ...u, league: 0, mentions: 0 })); }
    else { api.chatDmRead(scope, last).then(loadDms).catch(() => {}); }
  }, [loadDms]);

  // Initial load (and reset on sign-out).
  useEffect(() => {
    if (!userId) { setLeague({ ...EMPTY, pinned: null }); setThreads({}); setConvs([]); setUnread({ league: 0, mentions: 0, dm: 0 }); setLoading(true); return; }
    setLoading(true);
    api.chatUnread().then((r) => setUnread({ league: r.count, mentions: r.mentions, dm: r.dm })).catch(() => {});
    loadDms();
    api.chat().then((r) => { setLeague({ messages: r.messages, hasMore: r.hasMore, loaded: true, pinned: r.pinned }); setEmoji(r.emoji); }).catch(() => {}).finally(() => setLoading(false));
  }, [userId, loadDms]);

  const ensureThread = useCallback(async (team: string) => {
    if (threadsRef.current[team]?.loaded) return;
    try { const r = await api.chatDm(team); setThreads((t) => ({ ...t, [team]: { messages: r.messages, hasMore: r.hasMore, loaded: true } })); } catch { /* shown empty */ }
  }, []);

  // Live events.
  useEffect(() => subscribe((ev) => {
    const applyAll = (fn: (m: ChatMessage) => ChatMessage) => {
      setLeague((l) => ({ ...l, messages: l.messages.map(fn), pinned: l.pinned ? fn(l.pinned) : null }));
      setThreads((t) => Object.fromEntries(Object.entries(t).map(([k, th]) => [k, { ...th, messages: th.messages.map(fn) }])));
    };
    if (ev.type === 'chat') {
      const m = ev.message as ChatMessage;
      const scope = scopeOf(m);
      if (scope === 'league') {
        setLeague((l) => ({ ...l, messages: merge(l.messages, m) }));
        if (m.teamId !== myTeam) {
          if (watching('league')) markRead('league', [...leagueRef.current.messages, m]);
          else setUnread((u) => ({ ...u, league: u.league + 1, mentions: u.mentions + (myTeam && m.mentions.includes(myTeam) ? 1 : 0) }));
        }
      } else {
        setThreads((t) => (t[scope]?.loaded ? { ...t, [scope]: { ...t[scope], messages: merge(t[scope].messages, m) } } : t));
        if (m.teamId !== myTeam && watching(scope)) markRead(scope, [...(threadsRef.current[scope]?.messages ?? []), m]);
        else loadDms();
      }
      setTyping((t) => { const k = scope; if (!t[k]?.[m.teamId]) return t; const { [m.teamId]: _x, ...rest } = t[k]; return { ...t, [k]: rest }; });
    } else if (ev.type === 'chat-edit') {
      const m = ev.message as ChatMessage;
      applyAll((x) => (x.id === m.id ? m : x));
      if (m.toTeam) loadDms();
    } else if (ev.type === 'chat-react') {
      applyAll((x) => (x.id === ev.id ? { ...x, reactions: ev.reactions as ChatMessage['reactions'] } : x));
    } else if (ev.type === 'chat-pin') {
      const pm = ev.pinned as ChatMessage | null;
      setLeague((l) => ({ ...l, pinned: pm, messages: l.messages.map((x) => ({ ...x, pinned: !!pm && x.id === pm.id })) }));
    } else if (ev.type === 'chat-delete') {
      setLeague((l) => ({ ...l, messages: l.messages.filter((x) => x.id !== ev.id), pinned: l.pinned && l.pinned.id === ev.id ? null : l.pinned }));
      setThreads((t) => Object.fromEntries(Object.entries(t).map(([k, th]) => [k, { ...th, messages: th.messages.filter((x) => x.id !== ev.id) }])));
      loadDms();
    } else if (ev.type === 'typing') {
      const scope = ev.scope === 'league' ? 'league' : (ev.teamId as string);
      setTyping((t) => ({ ...t, [scope]: { ...(t[scope] ?? {}), [ev.teamId as string]: Date.now() + TYPING_TTL } }));
    }
  }), [subscribe, myTeam, scopeOf, markRead, loadDms]);

  // Typing indicators expire on their own.
  const anyTyping = Object.values(typing).some((v) => Object.keys(v).length > 0);
  useEffect(() => {
    if (!anyTyping) return;
    const id = setInterval(() => {
      const now = Date.now();
      setTyping((t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, exp]) => exp > now))])));
      tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [anyTyping]);

  // Looking at a conversation reads it.
  useEffect(() => {
    if (!open) return;
    if (view.kind === 'league') markRead('league', leagueRef.current.messages);
    else if (view.kind === 'dm') ensureThread(view.team).then(() => markRead(view.team, threadsRef.current[view.team]?.messages ?? []));
    else loadDms();
  }, [open, view.kind === 'dm' ? view.team : view.kind]);

  const state = useMemo<ChatState>(() => ({
    open, setOpen, view, setView, league, threads, convs, emoji, connected, loading, myTeam,
    unread: { ...unread, total: unread.league + unread.dm },
    typingIn: (scope) => Object.entries(typing[scope] ?? {}).filter(([, exp]) => exp > Date.now()).map(([id]) => id),
    send: async (scope, b) => {
      const m = await api.chatSend({ ...b, toTeam: scope === 'league' ? undefined : scope });
      if (scope === 'league') setLeague((l) => ({ ...l, messages: merge(l.messages, m) }));
      else { setThreads((t) => ({ ...t, [scope]: { ...(t[scope] ?? EMPTY), loaded: true, messages: merge(t[scope]?.messages ?? [], m) } })); loadDms(); }
    },
    edit: async (id, body) => {
      const m = await api.chatEdit(id, body);
      setLeague((l) => ({ ...l, messages: l.messages.map((x) => (x.id === id ? m : x)), pinned: l.pinned?.id === id ? m : l.pinned }));
      setThreads((t) => Object.fromEntries(Object.entries(t).map(([k, th]) => [k, { ...th, messages: th.messages.map((x) => (x.id === id ? m : x)) }])));
    },
    react: async (id, e) => { await api.chatReact(id, e); },
    pin: async (id, p) => { await api.chatPin(id, p); },
    remove: async (id) => { await api.chatDelete(id); },
    loadOlder: async (scope) => {
      if (scope === 'league') {
        const first = leagueRef.current.messages[0]; if (!first) return;
        const r = await api.chat(first.id);
        setLeague((l) => ({ ...l, messages: [...r.messages, ...l.messages], hasMore: r.hasMore }));
      } else {
        const first = threadsRef.current[scope]?.messages[0]; if (!first) return;
        const r = await api.chatDm(scope, first.id);
        setThreads((t) => ({ ...t, [scope]: { ...t[scope], messages: [...r.messages, ...t[scope].messages], hasMore: r.hasMore } }));
      }
    },
    ensureThread,
    sendTyping: (scope) => {
      const now = Date.now();
      if (now - lastTypingSent.current < TYPING_SEND_GAP) return;
      lastTypingSent.current = now;
      wsSend({ type: 'typing', scope });
    },
  }), [open, view, league, threads, convs, emoji, connected, loading, myTeam, unread, typing, ensureThread, wsSend, loadDms]);

  return <Ctx.Provider value={state}>{children}<ChatOverlay /></Ctx.Provider>;
}
