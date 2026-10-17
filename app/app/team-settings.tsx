import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { CropModal } from '../src/CropModal';
import { cropToSquare, pickImage, type Picked } from '../src/images';
import { useAuth } from '../src/auth';
import { NotificationsCard } from '../src/NotificationsCard';
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
  const [cropping, setCropping] = useState<Picked | null>(null);
  if (!team) return <Body style={{ padding: 20, color: t.dim }}>Your account isn't linked to a team yet.</Body>;

  const run = async (kind: 'logo' | 'name', okText: string, fn: () => Promise<unknown>) => {
    setBusy(kind); setMsg(null);
    try { await fn(); await refresh(); setMsg({ ok: true, text: okText }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' }); }
    finally { setBusy(null); }
  };

  // 1) pick a photo, 2) position it in the crop window, 3) shrink and upload
  const choose = async () => {
    setMsg(null);
    try { const img = await pickImage(); if (img) setCropping(img); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not open your photos' }); }
  };
  const finishCrop = (rect: { originX: number; originY: number; size: number }) => {
    const img = cropping!;
    setCropping(null);
    run('logo', 'Logo updated.', async () => api.uploadLogo(team.id, await cropToSquare(img, rect, LOGO_PX)));
  };

  const dirty = name.trim() !== team.name;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()}><Body style={{ color: t.red, marginBottom: 8 }}>‹ Back</Body></Pressable>
      <Display style={{ fontSize: 28, marginBottom: 14 }}>Team settings</Display>

      <Card style={{ padding: 16, marginBottom: 14, alignItems: 'center', gap: 12 }}>
        <TeamAvatar id={team.id} color={team.color} logoKey={team.logo_key} size={104} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={choose} disabled={busy !== null} style={{ backgroundColor: t.red, borderRadius: t.radius.button, paddingHorizontal: 18, paddingVertical: 11, opacity: busy ? 0.6 : 1 }}>
            <Display style={{ color: '#fff', fontSize: 15 }}>{busy === 'logo' ? 'UPLOADING…' : team.logo_key ? 'CHANGE LOGO' : 'UPLOAD LOGO'}</Display>
          </Pressable>
          {team.logo_key && (
            <Pressable onPress={() => run('logo', 'Logo removed.', () => api.removeLogo(team.id))} disabled={busy !== null} style={{ borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 16, paddingVertical: 11 }}>
              <Display style={{ color: t.dim, fontSize: 15 }}>REMOVE</Display>
            </Pressable>
          )}
        </View>
        <Body style={{ color: t.dim2, fontSize: 11, textAlign: 'center' }}>PNG, JPEG or WebP. You choose the square; it's shrunk to {LOGO_PX}px.</Body>
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

      <NotificationsCard />
      <Pressable onPress={() => router.push('/league-settings')} style={{ borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, padding: 14, marginBottom: 12 }}>
        <Display style={{ fontSize: 15 }}>League settings ›</Display>
        <Body style={{ color: t.dim, fontSize: 12 }}>{me?.user.isCommissioner ? 'League name, commissioners, sign-ups and join code, waivers, season tools.' : 'Who the commissioners are, the waiver period and the rules.'}</Body>
      </Pressable>
      {me?.user.isCommissioner && (
        <Pressable onPress={() => router.push('/stats-feed')} style={{ borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, padding: 14, marginBottom: 12 }}>
          <Display style={{ fontSize: 15 }}>MLB stats feed ›</Display>
          <Body style={{ color: t.dim, fontSize: 12 }}>Commissioner: match players, pull scores, refresh injuries.</Body>
        </Pressable>
      )}
      <CropModal image={cropping} onCancel={() => setCropping(null)} onDone={finishCrop} />
      {busy && <ActivityIndicator color={t.red} />}
      {msg && <Body style={{ color: msg.ok ? t.green : t.loss, fontFamily: FONT.bodyMedium }}>{msg.text}</Body>}
    </ScrollView>
  );
}

export default function TeamSettings() {
  return <RequireAuth><Settings /></RequireAuth>;
}
