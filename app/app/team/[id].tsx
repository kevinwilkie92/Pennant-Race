import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type RosterSlot } from '../../src/api';
import { Lineup } from '../../src/Lineup';
import { useTheme } from '../../src/theme';
import { Body, Display } from '../../src/ui';

export default function TeamRoster() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [slots, setSlots] = useState<RosterSlot[] | null>(null);
  useEffect(() => { api.roster(id).then((r) => setSlots(r.slots)).catch(() => setSlots([])); }, [id]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12 }}>
      <Pressable onPress={() => router.back()}><Body style={{ color: t.red, marginBottom: 8 }}>‹ Back</Body></Pressable>
      <Display style={{ fontSize: 26, marginBottom: 12 }}>Roster · {id}</Display>
      {slots ? <Lineup slots={slots} /> : <ActivityIndicator color={t.red} />}
    </ScrollView>
  );
}
