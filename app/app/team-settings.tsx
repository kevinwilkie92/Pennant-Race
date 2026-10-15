import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { RequireAuth } from '../src/RequireAuth';
import { TeamAvatar } from '../src/TeamAvatar';
import { FONT, useTheme } from '../src/theme';
import { Body, Card, Display } from '../src/ui';

const LOGO_PX = 256;

function Settings() {
  const { me, refresh } = useAuth();
  const { t } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const team = me?.team;
  const [name, setName] = useState(team?.name ?? '');
  const [busy, setBusy] = useState<'logo' | 'name' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!team) return <Body style={{ padding: 20, color: t.dim }}>Your account isn't linked to a team yet.</Body>;

  const run = async (kind: 'logo' | 'name', okText: string, fn: () => Promise<unknown>) => {
    setBusy(kind); setMsg(null);
    try { await fn(); await refresh(); setMsg({ ok: true, text: okText }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' }); }
    finally { setBusy(null); }
  };

  const chooseLogo = () => run('logo', 'Logo updated.', async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (picked.canceled) throw new Error('No image chosen');
    const a = picked.assets[0];
    // Centre-crop to a square and shrink, so uploads are small whatever the photo. PNG keeps transparency.
    const side = Math.min(a.width, a.height);
    const ctx = ImageManipulator.manipulate(a.uri)
      .crop({ originX: Math.floor((a.width - side) / 2), originY: Math.floor((a.height - side) / 2), width: side, height: side })
      .resize({ width: LOGO_PX, height: LOGO_PX });
    const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.PNG });
    const blob = await (await fetch(out.uri)).blob();
    await api.uploadLogo(team.id, blob);
  });

  const dirty = name.trim() !== team.name;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()}><Body style={{ color: t.red, marginBottom: 8 }}>‹ Back</Body></Pressable>
      <Display style={{ fontSize: 28, marginBottom: 14 }}>Team settings</Display>

      <Card style={{ padding: 16, marginBottom: 14, alignItems: 'center', gap: 12 }}>
        <TeamAvatar id={team.id} color={team.color} logoKey={team.logo_key} size={104} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={chooseLogo} disabled={busy !== null} style={{ backgroundColor: t.red, borderRadius: t.radius.button, paddingHorizontal: 18, paddingVertical: 11, opacity: busy ? 0.6 : 1 }}>
            <Display style={{ color: '#fff', fontSize: 15 }}>{busy === 'logo' ? 'UPLOADING…' : team.logo_key ? 'CHANGE LOGO' : 'UPLOAD LOGO'}</Display>
          </Pressable>
          {team.logo_key && (
            <Pressable onPress={() => run('logo', 'Logo removed.', () => api.removeLogo(team.id))} disabled={busy !== null} style={{ borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 16, paddingVertical: 11 }}>
              <Display style={{ color: t.dim, fontSize: 15 }}>REMOVE</Display>
            </Pressable>
          )}
        </View>
        <Body style={{ color: t.dim2, fontSize: 11, textAlign: 'center' }}>PNG, JPEG or WebP. It's cropped to a square and shrunk to {LOGO_PX}px.</Body>
      </Card>

      <Card style={{ padding: 16, marginBottom: 14 }}>
        <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>TEAM NAME</Body>
        <TextInput value={name} onChangeText={(v) => { setName(v); setMsg(null); }} maxLength={40} placeholder="Team name" placeholderTextColor={t.dim2}
          style={{ color: t.text, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 12, paddingVertical: 11, fontFamily: FONT.bodySemi, fontSize: 17 }} />
        <Pressable onPress={() => run('name', 'Name saved.', async () => { const r = await api.renameTeam(team.id, name); setName(r.name); })} disabled={!dirty || busy !== null}
          style={{ marginTop: 12, backgroundColor: t.red, borderRadius: t.radius.button, paddingVertical: 12, alignItems: 'center', opacity: !dirty || busy ? 0.5 : 1 }}>
          <Display style={{ color: '#fff', fontSize: 15 }}>SAVE NAME</Display>
        </Pressable>
      </Card>

      {busy && <ActivityIndicator color={t.red} />}
      {msg && <Body style={{ color: msg.ok ? t.green : t.loss, fontFamily: FONT.bodyMedium }}>{msg.text}</Body>}
    </ScrollView>
  );
}

export default function TeamSettings() {
  return <RequireAuth><Settings /></RequireAuth>;
}
