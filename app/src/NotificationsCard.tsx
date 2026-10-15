import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, View } from 'react-native';
import { api, type PushPrefs } from './api';
import { disablePush, enablePush, getPushState, type PushState } from './push';
import { FONT, useTheme } from './theme';
import { Body, Card, Display } from './ui';

const KINDS: { key: keyof PushPrefs; label: string; hint: string }[] = [
  { key: 'dm', label: 'Direct messages', hint: 'When another team messages you.' },
  { key: 'group', label: 'Group chats', hint: 'New messages in groups you are in.' },
  { key: 'mention', label: '@mentions', hint: 'When someone mentions your team in the league room.' },
  { key: 'trade', label: 'Trades', hint: 'Offers to you, and answers to your offers.' },
  { key: 'waiver', label: 'Waiver results', hint: 'Whether each claim won or failed.' },
  { key: 'preview', label: 'Show message text', hint: 'Off: notifications just say there is something new.' },
];

/** Turn notifications on for this device, choose what to hear about, and send a test. */
export function NotificationsCard() {
  const { t } = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setState(await getPushState().catch(() => null));
    setPrefs(await api.pushPrefs().catch(() => null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' }); }
    await load(); setBusy(false);
  };
  const toggleDevice = (on: boolean) => run(on ? enablePush : disablePush, on ? 'Notifications are on for this device.' : 'Notifications are off for this device.');
  const setPref = (key: keyof PushPrefs, v: boolean) => { setPrefs((p) => (p ? { ...p, [key]: v } : p)); run(() => api.setPushPrefs({ [key]: v }).then(setPrefs)); };

  return (
    <Card style={{ padding: 14, marginBottom: 12 }}>
      <Display style={{ fontSize: 18 }}>Notifications</Display>
      {!state ? <ActivityIndicator color={t.red} style={{ marginTop: 10 }} /> : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontFamily: FONT.bodySemi }}>This device</Body>
              <Body style={{ color: t.dim, fontSize: 12 }}>
                {!state.supported ? state.reason : !state.configured ? (state.reason ?? 'Not set up on the server yet: the commissioner needs to add the notification keys (see SETUP.md).')
                  : state.permission === 'denied' ? 'Blocked in your browser or phone settings. Allow notifications there, then come back.'
                  : state.enabled ? 'On: you will be notified here, even when the app is closed.' : 'Off. Turn on to hear about messages, trades and waivers.'}
              </Body>
            </View>
            <Switch value={state.enabled} disabled={busy || !state.supported || !state.configured || state.permission === 'denied'} onValueChange={toggleDevice} trackColor={{ true: t.red }} />
          </View>
          {state.enabled && prefs && (
            <>
              <View style={{ height: 1, backgroundColor: t.line, marginVertical: 10 }} />
              {KINDS.map((k) => (
                <View key={k.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontFamily: FONT.bodySemi, fontSize: 14 }}>{k.label}</Body>
                    <Body style={{ color: t.dim, fontSize: 12 }}>{k.hint}</Body>
                  </View>
                  <Switch value={prefs[k.key]} disabled={busy} onValueChange={(v) => setPref(k.key, v)} trackColor={{ true: t.red }} />
                </View>
              ))}
              <Pressable onPress={() => run(async () => { const r = await api.pushTest(); if (!r.sent) throw new Error('Nothing was delivered. Try turning notifications off and on again.'); }, 'Test sent. It should appear in a moment.')} disabled={busy}
                style={{ borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingVertical: 10, alignItems: 'center', marginTop: 10, opacity: busy ? 0.6 : 1 }}>
                <Display style={{ fontSize: 14 }}>SEND ME A TEST</Display>
              </Pressable>
            </>
          )}
          {msg && <Body style={{ color: msg.ok ? t.green : t.loss, fontSize: 12, marginTop: 8 }}>{msg.text}</Body>}
        </>
      )}
    </Card>
  );
}
