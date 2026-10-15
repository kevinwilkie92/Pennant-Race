import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type LineupSlot } from '../../src/api';
import { useAuth } from '../../src/auth';
import { Lineup } from '../../src/Lineup';
import { useTheme } from '../../src/theme';
import { Body, Display } from '../../src/ui';
import { RequireAuth } from '../../src/RequireAuth';

function TeamRosterInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const [slots, setSlots] = useState<LineupSlot[] | null>(null);
  const [live, setLive] = useState(false);
  useEffect(() => { api.lineup(id).then((r) => { setSlots(r.slots); setLive(r.season != null); }).catch(() => setSlots([])); }, [id]);
  const canTrade = live && !!me?.user.teamId && me.user.teamId !== id;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12 }}>
      <Pressable onPress={() => router.back()}><Body style={{ color: t.red, marginBottom: 8 }}>‹ Back</Body></Pressable>
      <Display style={{ fontSize: 26, marginBottom: 12 }}>Roster · {id}</Display>
      {canTrade && <Body style={{ color: t.dim, fontSize: 12, marginBottom: 8 }}>Tap a player to propose a trade for him.</Body>}
      {slots ? <Lineup slots={slots} onPress={canTrade ? (p) => router.push({ pathname: '/trade', params: { team: id, player: String(p.playerId) } }) : undefined} /> : <ActivityIndicator color={t.red} />}
    </ScrollView>
  );
}

export default function TeamRoster() {
  return (
    <RequireAuth>
      <TeamRosterInner />
    </RequireAuth>
  );
}
