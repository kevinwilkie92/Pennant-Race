import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type ChatMessage, type Team } from './api';
import { useAuth } from './auth';
import { useRealtime } from './realtime';
import { FONT, useTheme } from './theme';
import { TeamAvatar } from './TeamAvatar';
import { Body, Display } from './ui';

const MAX = 500;
type ChatState = {
  open: boolean; setOpen: (v: boolean) => void; unread: number;
  messages: ChatMessage[]; pinned: ChatMessage | null; hasMore: boolean; loading: boolean; emoji: string[];
  teams: Map<string, Team>; connected: boolean;
  send: (body: string) => Promise<void>; react: (id: number, emoji: string) => Promise<void>;
  pin: (id: number, pinned: boolean) => Promise<void>; remove: (id: number) => Promise<void>; loadOlder: () => Promise<void>;
};
const Ctx = createContext<ChatState | null>(null);
export const useChat = () => useContext(Ctx)!;

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { me, refresh } = useAuth();
  const { subscribe, connected } = useRealtime();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pinned, setPinned] = useState<ChatMessage | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [emoji, setEmoji] = useState<string[]>(['👍', '🔥', '😂', '😮', '❤️', '👀']);
  const [teams, setTeams] = useState<Map<string, Team>>(new Map());
  const openRef = useRef(open);
  openRef.current = open;
  const myTeam = me?.user.teamId ?? null;

  const markRead = useCallback((list: ChatMessage[]) => {
    const last = list.length ? list[list.length - 1].id : 0;
    if (last) api.chatRead(last).catch(() => {});
    setUnread(0);
  }, []);

  useEffect(() => {
    api.teams().then((t) => setTeams(new Map(t.map((x) => [x.id, x])))).catch(() => {});
    api.chatUnread().then((r) => setUnread(r.count)).catch(() => {});
    api.chat().then((r) => { setMessages(r.messages); setPinned(r.pinned); setHasMore(r.hasMore); setEmoji(r.emoji); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Live updates.
  useEffect(() => subscribe((ev) => {
    if (ev.type === 'chat') {
      const m = ev.message as ChatMessage;
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        const next = [...prev, m];
        if (openRef.current) markRead(next);
        return next;
      });
      if (!openRef.current && m.teamId !== myTeam) setUnread((n) => n + 1);
    } else if (ev.type === 'chat-react') {
      setMessages((prev) => prev.map((x) => (x.id === ev.id ? { ...x, reactions: ev.reactions as ChatMessage['reactions'] } : x)));
      setPinned((p) => (p && p.id === ev.id ? { ...p, reactions: ev.reactions as ChatMessage['reactions'] } : p));
    } else if (ev.type === 'chat-pin') {
      const pm = ev.pinned as ChatMessage | null;
      setPinned(pm);
      setMessages((prev) => prev.map((x) => ({ ...x, pinned: !!pm && x.id === pm.id })));
    } else if (ev.type === 'team') {
      // someone changed their team name or logo
      api.teams().then((t) => setTeams(new Map(t.map((x) => [x.id, x])))).catch(() => {});
      if (ev.id === myTeam) refresh();
    } else if (ev.type === 'chat-delete') {
      setMessages((prev) => prev.filter((x) => x.id !== ev.id));
      setPinned((p) => (p && p.id === ev.id ? null : p));
    }
  }), [subscribe, myTeam, markRead]);

  // Opening the overlay reads everything.
  useEffect(() => { if (open) markRead(messages); }, [open]);

  const state = useMemo<ChatState>(() => ({
    open, setOpen, unread, messages, pinned, hasMore, loading, emoji, teams, connected,
    send: async (body) => {
      const m = await api.chatSend(body);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));   // the live event may arrive first
    },
    react: async (id, e) => { await api.chatReact(id, e); },                             // the broadcast updates everyone, including us
    pin: async (id, p) => { await api.chatPin(id, p); },
    remove: async (id) => { await api.chatDelete(id); },
    loadOlder: async () => {
      if (!messages.length) return;
      const r = await api.chat(messages[0].id);
      setMessages((prev) => [...r.messages, ...prev]);
      setHasMore(r.hasMore);
    },
  }), [open, unread, messages, pinned, hasMore, loading, emoji, teams, connected]);

  return <Ctx.Provider value={state}>{children}<ChatOverlay /></Ctx.Provider>;
}

const clock = (ms: number) => {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

function ChatOverlay() {
  const c = useChat();
  const { me } = useAuth();
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);      // which message has its reaction picker / actions open
  const scroller = useRef<ScrollView>(null);
  const stick = useRef(true);
  const mine = me?.user.teamId ?? null;
  const commissioner = !!me?.user.isCommissioner;

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr('');
    try { await c.send(body); setText(''); stick.current = true; }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not send'); }
    finally { setBusy(false); }
  };
  const act = (fn: () => Promise<unknown>) => fn().catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  const avatar = (teamId: string, size = 34) => {
    const tm = c.teams.get(teamId);
    return <TeamAvatar id={teamId} color={tm?.color ?? t.dim2} logoKey={tm?.logoKey} size={size} />;
  };

  const Reactions = ({ m }: { m: ChatMessage }) => {
    const entries = Object.entries(m.reactions);
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {entries.map(([e, who]) => {
          const on = !!mine && who.includes(mine);
          return (
            <Pressable key={e} onPress={() => act(() => c.react(m.id, e))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.card2 : 'transparent' }}>
              <Body style={{ fontSize: 13 }}>{e}</Body>
              <Body style={{ fontFamily: FONT.num, fontSize: 12, color: on ? t.text : t.dim }}>{who.length}</Body>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setMenuFor(menuFor === m.id ? null : m.id)} hitSlop={6}
          style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: t.line }}>
          <Body style={{ fontSize: 12, color: t.dim }}>＋ ⋯</Body>
        </Pressable>
      </View>
    );
  };

  return (
    <Modal visible={c.open} animationType="slide" onRequestClose={() => c.setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: t.panel, borderBottomColor: t.line, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Display style={{ fontSize: 22 }}>League Chat</Display>
            <Body style={{ color: c.connected ? t.green : t.dim2, fontSize: 11 }}>{c.connected ? '● Live' : 'Reconnecting…'}</Body>
          </View>
          <Pressable onPress={() => c.setOpen(false)} hitSlop={12}><Display style={{ fontSize: 15, color: t.red }}>CLOSE</Display></Pressable>
        </View>

        {c.pinned && (
          <View style={{ backgroundColor: 'rgba(209,154,31,0.14)', borderBottomColor: 'rgba(209,154,31,0.35)', borderBottomWidth: 1, padding: 12 }}>
            <Body style={{ color: t.gold, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>📌 COMMISSIONER ANNOUNCEMENT</Body>
            <Body style={{ marginTop: 3, fontSize: 14 }}>{c.pinned.body}</Body>
          </View>
        )}

        <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 6 }}
          scrollEventThrottle={64}
          onScroll={(e) => { const n = e.nativeEvent; stick.current = n.contentSize.height - n.layoutMeasurement.height - n.contentOffset.y < 80; }}
          onContentSizeChange={() => { if (stick.current) scroller.current?.scrollToEnd({ animated: false }); }}>
          {c.loading && <ActivityIndicator color={t.red} style={{ margin: 20 }} />}
          {c.hasMore && (
            <Pressable onPress={() => { stick.current = false; act(c.loadOlder); }} style={{ alignItems: 'center', padding: 10 }}>
              <Body style={{ color: t.red, fontFamily: FONT.bodyBold }}>Load earlier messages</Body>
            </Pressable>
          )}
          {!c.loading && c.messages.length === 0 && <Body style={{ color: t.dim, textAlign: 'center', padding: 30 }}>No messages yet. Say something!</Body>}
          {c.messages.map((m) => {
            const tm = c.teams.get(m.teamId);
            const isMine = m.teamId === mine;
            return (
              <View key={m.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                {avatar(m.teamId)}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Body style={{ fontFamily: FONT.bodyBold, fontSize: 13, color: isMine ? t.text : tm?.color ?? t.text }} numberOfLines={1}>{tm?.name ?? m.teamId}</Body>
                    <Body style={{ color: t.dim2, fontSize: 11 }}>{clock(m.createdAt)}</Body>
                    {m.pinned && <Body style={{ fontSize: 11 }}>📌</Body>}
                  </View>
                  <Body style={{ fontSize: 15, lineHeight: 21 }}>{m.body}</Body>
                  <Reactions m={m} />
                  {menuFor === m.id && (
                    <View style={{ marginTop: 8, padding: 8, borderRadius: t.radius.card, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, gap: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        {c.emoji.map((e) => (
                          <Pressable key={e} onPress={() => { setMenuFor(null); act(() => c.react(m.id, e)); }} style={{ padding: 6 }}><Body style={{ fontSize: 22 }}>{e}</Body></Pressable>
                        ))}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 16 }}>
                        {commissioner && (
                          <Pressable onPress={() => { setMenuFor(null); act(() => c.pin(m.id, !m.pinned)); }}>
                            <Body style={{ color: t.gold, fontFamily: FONT.bodyBold, fontSize: 13 }}>{m.pinned ? 'Unpin' : '📌 Pin as announcement'}</Body>
                          </Pressable>
                        )}
                        {(isMine || commissioner) && (
                          <Pressable onPress={() => { setMenuFor(null); act(() => c.remove(m.id)); }}>
                            <Body style={{ color: t.loss, fontFamily: FONT.bodyBold, fontSize: 13 }}>Delete</Body>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>

        {!!err && <Body style={{ color: t.loss, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 }}>{err}</Body>}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, paddingBottom: Math.max(insets.bottom, 10), backgroundColor: t.panel, borderTopColor: t.line, borderTopWidth: 1 }}>
          <TextInput value={text} onChangeText={(v) => { setText(v); if (err) setErr(''); }} placeholder="Message the league" placeholderTextColor={t.dim2}
            multiline maxLength={MAX} onSubmitEditing={submit} blurOnSubmit={false}
            onKeyPress={(e) => { const k = e.nativeEvent as unknown as { key?: string; shiftKey?: boolean }; if (Platform.OS === 'web' && k.key === 'Enter' && !k.shiftKey) { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); submit(); } }}
            style={{ flex: 1, maxHeight: 110, color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontFamily: FONT.body, fontSize: 15 }} />
          <Pressable onPress={submit} disabled={busy || !text.trim()} style={{ backgroundColor: t.red, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10, opacity: busy || !text.trim() ? 0.5 : 1 }}>
            <Display style={{ color: '#fff', fontSize: 14 }}>SEND</Display>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
