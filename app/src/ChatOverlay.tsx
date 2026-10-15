import { useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeMention, completeMention, splitMentions } from '@pennant/domain';
import { api, chatImageUrl, type ChatMessage } from './api';
import { useAuth } from './auth';
import { useChat, type Scope } from './chat';
import { pickImage, shrinkForChat } from './images';
import { TeamAvatar } from './TeamAvatar';
import { useTeams } from './teams';
import { FONT, useTheme } from './theme';
import { Body, Display } from './ui';

const MAX = 500;
const clock = (ms: number) => {
  const d = new Date(ms), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

export function ChatOverlay() {
  const c = useChat();
  const { t } = useTheme();
  const { byId, teams } = useTeams();
  const insets = useSafeAreaInsets();
  const name = (id: string) => byId.get(id)?.name ?? id;
  const tab = (key: 'league' | 'dms', label: string, badge: number) => {
    const on = key === 'league' ? c.view.kind === 'league' : c.view.kind !== 'league';
    return (
      <Pressable onPress={() => c.setView(key === 'league' ? { kind: 'league' } : { kind: 'dms' })}
        style={{ flex: 1, paddingVertical: 9, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: on ? t.red : 'transparent', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <Display style={{ fontSize: 15, color: on ? t.text : t.dim }}>{label}</Display>
        {badge > 0 && <View style={{ backgroundColor: t.red, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Body style={{ color: '#fff', fontFamily: FONT.bodyBold, fontSize: 11 }}>{badge}</Body></View>}
      </Pressable>
    );
  };
  const inDm = c.view.kind === 'dm' ? c.view.team : null;

  return (
    <Modal visible={c.open} animationType="slide" onRequestClose={() => c.setOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6, backgroundColor: t.panel, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {inDm && <Pressable onPress={() => c.setView({ kind: 'dms' })} hitSlop={12}><Display style={{ fontSize: 26 }}>‹</Display></Pressable>}
          {inDm && byId.get(inDm) && <TeamAvatar id={inDm} color={byId.get(inDm)!.color} logoKey={byId.get(inDm)!.logoKey} size={30} />}
          <View style={{ flex: 1 }}>
            <Display style={{ fontSize: 21 }} numberOfLines={1}>{inDm ? name(inDm) : c.view.kind === 'dms' ? 'Direct Messages' : 'League Chat'}</Display>
            <Body style={{ color: c.connected ? t.green : t.dim2, fontSize: 11 }}>{c.connected ? '● Live' : 'Reconnecting…'}{inDm ? ' · only you two can see this' : ''}</Body>
          </View>
          <Pressable onPress={() => c.setOpen(false)} hitSlop={12}><Display style={{ fontSize: 15, color: t.red }}>CLOSE</Display></Pressable>
        </View>
        {!inDm && (
          <View style={{ flexDirection: 'row', backgroundColor: t.panel, borderBottomColor: t.line, borderBottomWidth: 1 }}>
            {tab('league', 'League', c.unread.league)}
            {tab('dms', 'Direct', c.unread.dm)}
          </View>
        )}
        {inDm && <View style={{ height: 1, backgroundColor: t.line }} />}

        {c.view.kind === 'dms' ? (
          <ScrollView contentContainerStyle={{ padding: 12 }}>
            {c.convs.length > 0 && <Display style={{ fontSize: 12, letterSpacing: 1.5, color: t.dim, margin: 4 }}>CONVERSATIONS</Display>}
            {c.convs.map((cv) => (
              <Pressable key={cv.team} onPress={() => c.setView({ kind: 'dm', team: cv.team })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: t.radius.card, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, marginBottom: 8 }}>
                <TeamAvatar id={cv.team} color={byId.get(cv.team)?.color ?? t.dim2} logoKey={byId.get(cv.team)?.logoKey} size={40} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: cv.unread ? FONT.bodyBold : FONT.bodySemi, fontSize: 15 }} numberOfLines={1}>{name(cv.team)}</Body>
                  <Body style={{ color: cv.unread ? t.text : t.dim, fontSize: 13 }} numberOfLines={1}>
                    {cv.last.fromMe ? 'You: ' : ''}{cv.last.hasImage && !cv.last.body ? '📷 Photo' : cv.last.body}
                  </Body>
                </View>
                {cv.unread > 0 && <View style={{ backgroundColor: t.red, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Body style={{ color: '#fff', fontFamily: FONT.bodyBold, fontSize: 12 }}>{cv.unread}</Body></View>}
              </Pressable>
            ))}
            <Display style={{ fontSize: 12, letterSpacing: 1.5, color: t.dim, margin: 4, marginTop: 14 }}>NEW MESSAGE</Display>
            {teams.filter((x) => x.id !== c.myTeam && !c.convs.some((cv) => cv.team === x.id)).map((x) => (
              <Pressable key={x.id} onPress={() => c.setView({ kind: 'dm', team: x.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                <TeamAvatar id={x.id} color={x.color} logoKey={x.logoKey} size={32} />
                <Body style={{ fontFamily: FONT.bodySemi, fontSize: 15 }}>{x.name}</Body>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Conversation key={c.view.kind === 'dm' ? c.view.team : 'league'} scope={c.view.kind === 'dm' ? c.view.team : 'league'} />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------

function Conversation({ scope }: { scope: Scope }) {
  const c = useChat();
  const { me } = useAuth();
  const { t } = useTheme();
  const { byId } = useTeams();
  const insets = useSafeAreaInsets();
  const thread = scope === 'league' ? c.league : c.threads[scope] ?? { messages: [], hasMore: false, loaded: false };
  const pinned = scope === 'league' ? c.league.pinned : null;
  const mine = me?.user.teamId ?? null;
  const commissioner = !!me?.user.isCommissioner;
  const name = (id: string) => byId.get(id)?.name ?? id;

  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [image, setImage] = useState<{ uri: string; key: string | null; uploading: boolean } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const stick = useRef(true);

  const act = (fn: () => Promise<unknown>) => fn().catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  const mention = scope === 'league' ? activeMention(text) : null;
  const suggestions = mention === null ? [] : [...byId.values()].filter((x) => x.id !== mine && (x.id.toLowerCase().startsWith(mention.toLowerCase()) || x.name.toLowerCase().includes(mention.toLowerCase()))).slice(0, 5);

  const attach = async () => {
    setErr('');
    try {
      const picked = await pickImage();
      if (!picked) return;
      const small = await shrinkForChat(picked);
      setImage({ uri: small.uri, key: null, uploading: true });
      const { imageKey } = await api.chatUpload(small.blob);
      setImage({ uri: small.uri, key: imageKey, uploading: false });
    } catch (e) { setImage(null); setErr(e instanceof Error ? e.message : 'Could not attach that image'); }
  };

  const submit = async () => {
    const body = text.trim();
    if ((!body && !image?.key) || busy || image?.uploading) return;
    setBusy(true); setErr('');
    try {
      if (editing) await c.edit(editing.id, body);
      else await c.send(scope, { body, replyTo: replyTo?.id, imageKey: image?.key ?? undefined });
      setText(''); setReplyTo(null); setEditing(null); setImage(null); stick.current = true;
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send'); }
    finally { setBusy(false); }
  };

  const typers = c.typingIn(scope).filter((id) => id !== mine);
  const typingText = typers.length === 0 ? '' : typers.length === 1 ? `${name(typers[0])} is typing…` : `${typers.length} teams are typing…`;

  const Quote = ({ r, small }: { r: NonNullable<ChatMessage['replyTo']>; small?: boolean }) => (
    <View style={{ borderLeftWidth: 3, borderLeftColor: r.teamId ? byId.get(r.teamId)?.color ?? t.dim2 : t.dim2, paddingLeft: 8, marginBottom: 4, opacity: 0.9 }}>
      <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: small ? 11 : 12 }}>↩ {r.deleted ? 'Original message' : name(r.teamId ?? '')}</Body>
      <Body style={{ color: t.dim, fontSize: small ? 12 : 13 }} numberOfLines={2}>
        {r.deleted ? 'was deleted' : r.body
          ? splitMentions(r.body, [...byId.keys()]).map((seg) => ('mention' in seg ? `@${name(seg.mention)}` : seg.text)).join('')
          : r.hasImage ? '📷 Photo' : ''}
      </Body>
    </View>
  );

  const RichText = ({ body, mentions }: { body: string; mentions: string[] }) => (
    <Body style={{ fontSize: 15, lineHeight: 21 }}>
      {splitMentions(body, [...byId.keys()]).map((seg, i) => 'mention' in seg
        ? <Body key={i} style={{ color: t.gold, fontFamily: FONT.bodyBold, fontSize: 15, backgroundColor: mine && seg.mention === mine && mentions.includes(mine) ? 'rgba(209,154,31,0.25)' : undefined }}>@{name(seg.mention)}</Body>
        : <Body key={i} style={{ fontSize: 15, lineHeight: 21 }}>{seg.text}</Body>)}
    </Body>
  );

  return (
    <View style={{ flex: 1 }}>
      {pinned && (
        <View style={{ backgroundColor: 'rgba(209,154,31,0.14)', borderBottomColor: 'rgba(209,154,31,0.35)', borderBottomWidth: 1, padding: 12 }}>
          <Body style={{ color: t.gold, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>📌 COMMISSIONER ANNOUNCEMENT</Body>
          <Body style={{ marginTop: 3, fontSize: 14 }}>{pinned.body}</Body>
        </View>
      )}

      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 6 }} scrollEventThrottle={64}
        onScroll={(e) => { const n = e.nativeEvent; stick.current = n.contentSize.height - n.layoutMeasurement.height - n.contentOffset.y < 80; }}
        onContentSizeChange={() => { if (stick.current) scroller.current?.scrollToEnd({ animated: false }); }}>
        {(c.loading && scope === 'league') || (scope !== 'league' && !thread.loaded) ? <ActivityIndicator color={t.red} style={{ margin: 20 }} /> : null}
        {thread.hasMore && (
          <Pressable onPress={() => { stick.current = false; act(() => c.loadOlder(scope)); }} style={{ alignItems: 'center', padding: 10 }}>
            <Body style={{ color: t.red, fontFamily: FONT.bodyBold }}>Load earlier messages</Body>
          </Pressable>
        )}
        {thread.loaded && thread.messages.length === 0 && (
          <Body style={{ color: t.dim, textAlign: 'center', padding: 30 }}>{scope === 'league' ? 'No messages yet. Say something!' : `Start a conversation with ${name(scope)}.`}</Body>
        )}
        {thread.messages.map((m) => {
          const tm = byId.get(m.teamId);
          const isMine = m.teamId === mine;
          const imgUrl = chatImageUrl(m.imageKey);
          const reactions = Object.entries(m.reactions);
          return (
            <View key={m.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <TeamAvatar id={m.teamId} color={tm?.color ?? t.dim2} logoKey={tm?.logoKey} size={34} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Body style={{ fontFamily: FONT.bodyBold, fontSize: 13, color: isMine ? t.text : tm?.color ?? t.text }} numberOfLines={1}>{name(m.teamId)}</Body>
                  <Body style={{ color: t.dim2, fontSize: 11 }}>{clock(m.createdAt)}</Body>
                  {m.editedAt && <Body style={{ color: t.dim2, fontSize: 11 }}>(edited)</Body>}
                  {m.pinned && <Body style={{ fontSize: 11 }}>📌</Body>}
                </View>
                {m.replyTo && <Quote r={m.replyTo} />}
                {!!m.body && <RichText body={m.body} mentions={m.mentions} />}
                {imgUrl && (
                  <Pressable onPress={() => setLightbox(imgUrl)} style={{ marginTop: 6 }}>
                    <Image source={{ uri: imgUrl }} resizeMode="cover" style={{ width: 230, height: 172, borderRadius: 10, backgroundColor: t.card2 }} />
                  </Pressable>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {reactions.map(([e, who]) => {
                    const on = !!mine && who.includes(mine);
                    return (
                      <Pressable key={e} onPress={() => act(() => c.react(m.id, e))}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.card2 : 'transparent' }}>
                        <Body style={{ fontSize: 13 }}>{e}</Body>
                        <Body style={{ fontFamily: FONT.num, fontSize: 12, color: on ? t.text : t.dim }}>{who.length}</Body>
                      </Pressable>
                    );
                  })}
                  <Pressable onPress={() => setMenuFor(menuFor === m.id ? null : m.id)} hitSlop={6} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: t.line }}>
                    <Body style={{ fontSize: 12, color: t.dim }}>＋ ⋯</Body>
                  </Pressable>
                </View>
                {menuFor === m.id && (
                  <View style={{ marginTop: 8, padding: 8, borderRadius: t.radius.card, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, gap: 8 }}>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {c.emoji.map((e) => <Pressable key={e} onPress={() => { setMenuFor(null); act(() => c.react(m.id, e)); }} style={{ padding: 6 }}><Body style={{ fontSize: 22 }}>{e}</Body></Pressable>)}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
                      <Pressable onPress={() => { setMenuFor(null); setEditing(null); setReplyTo(m); }}><Body style={{ color: t.text, fontFamily: FONT.bodyBold, fontSize: 13 }}>↩ Reply</Body></Pressable>
                      {isMine && <Pressable onPress={() => { setMenuFor(null); setReplyTo(null); setEditing(m); setText(m.body); setImage(null); }}><Body style={{ color: t.text, fontFamily: FONT.bodyBold, fontSize: 13 }}>✎ Edit</Body></Pressable>}
                      {commissioner && scope === 'league' && <Pressable onPress={() => { setMenuFor(null); act(() => c.pin(m.id, !m.pinned)); }}><Body style={{ color: t.gold, fontFamily: FONT.bodyBold, fontSize: 13 }}>{m.pinned ? 'Unpin' : '📌 Pin as announcement'}</Body></Pressable>}
                      {(isMine || (commissioner && scope === 'league')) && <Pressable onPress={() => { setMenuFor(null); act(() => c.remove(m.id)); }}><Body style={{ color: t.loss, fontFamily: FONT.bodyBold, fontSize: 13 }}>Delete</Body></Pressable>}
                    </View>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {!!typingText && <Body style={{ color: t.dim, fontSize: 12, fontStyle: 'italic', paddingHorizontal: 16, paddingBottom: 4 }}>{typingText}</Body>}
      {!!err && <Body style={{ color: t.loss, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 }}>{err}</Body>}

      {suggestions.length > 0 && (
        <View style={{ marginHorizontal: 10, marginBottom: 4, borderRadius: t.radius.card, backgroundColor: t.panel, borderColor: t.line, borderWidth: 1 }}>
          {suggestions.map((x) => (
            <Pressable key={x.id} onPress={() => setText(completeMention(text, x.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 }}>
              <TeamAvatar id={x.id} color={x.color} logoKey={x.logoKey} size={24} />
              <Body style={{ fontFamily: FONT.bodySemi }}>{x.name}</Body>
              <Body style={{ color: t.dim2, fontSize: 12 }}>@{x.id}</Body>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ backgroundColor: t.panel, borderTopColor: t.line, borderTopWidth: 1, paddingBottom: Math.max(insets.bottom, 10) }}>
        {(replyTo || editing) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
            <View style={{ flex: 1 }}>
              {editing ? <Body style={{ color: t.gold, fontFamily: FONT.bodyBold, fontSize: 12 }}>✎ Editing your message</Body>
                : <Quote r={{ id: replyTo!.id, teamId: replyTo!.teamId, body: replyTo!.body, hasImage: !!replyTo!.imageKey }} small />}
            </View>
            <Pressable onPress={() => { setReplyTo(null); setEditing(null); if (editing) setText(''); }} hitSlop={10}><Body style={{ fontSize: 18, color: t.dim }}>✕</Body></Pressable>
          </View>
        )}
        {image && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 8 }}>
            <Image source={{ uri: image.uri }} style={{ width: 56, height: 56, borderRadius: 8, opacity: image.uploading ? 0.5 : 1 }} />
            <Body style={{ flex: 1, color: t.dim, fontSize: 12 }}>{image.uploading ? 'Uploading…' : 'Photo ready to send'}</Body>
            <Pressable onPress={() => setImage(null)} hitSlop={10}><Body style={{ fontSize: 18, color: t.dim }}>✕</Body></Pressable>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, paddingBottom: 0 }}>
          {!editing && <Pressable onPress={attach} hitSlop={8} style={{ paddingVertical: 8 }}><Body style={{ fontSize: 24 }}>📎</Body></Pressable>}
          <TextInput value={text} placeholder={scope === 'league' ? 'Message the league — @ to mention a team' : `Message ${name(scope)}`} placeholderTextColor={t.dim2}
            onChangeText={(v) => { setText(v); if (err) setErr(''); if (v.trim()) c.sendTyping(scope); }}
            multiline maxLength={MAX} onSubmitEditing={submit} blurOnSubmit={false}
            onKeyPress={(e) => { const k = e.nativeEvent as unknown as { key?: string; shiftKey?: boolean }; if (Platform.OS === 'web' && k.key === 'Enter' && !k.shiftKey) { (e as unknown as { preventDefault?: () => void }).preventDefault?.(); submit(); } }}
            style={{ flex: 1, maxHeight: 110, color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontFamily: FONT.body, fontSize: 15 }} />
          <Pressable onPress={submit} disabled={busy || image?.uploading || (!text.trim() && !image?.key)} style={{ backgroundColor: t.red, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10, opacity: busy || image?.uploading || (!text.trim() && !image?.key) ? 0.5 : 1 }}>
            <Display style={{ color: '#fff', fontSize: 14 }}>{editing ? 'SAVE' : 'SEND'}</Display>
          </Pressable>
        </View>
      </View>

      <Modal transparent visible={!!lightbox} animationType="fade" onRequestClose={() => setLightbox(null)}>
        <Pressable onPress={() => setLightbox(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          {lightbox && <Image source={{ uri: lightbox }} resizeMode="contain" style={{ width: '94%', height: '80%' }} />}
        </Pressable>
      </Modal>
    </View>
  );
}
