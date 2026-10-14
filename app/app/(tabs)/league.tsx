import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, type Team } from '../../src/api';
import { useTheme } from '../../src/theme';
import { Body, Card, Display } from '../../src/ui';

// Standings (W-L, PF, PA, playoff line) need game results; for now, list the 12 teams and open their rosters.
export default function League() {
  const { t } = useTheme();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  useEffect(() => { api.teams().then(setTeams).catch(() => {}); }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>TEAMS</Display>
      <Card style={{ overflow: 'hidden' }}>
        {teams.map((tm, i) => (
          <Pressable key={tm.id} onPress={() => router.push({ pathname: '/team/[id]', params: { id: tm.id } })}
            style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
            <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: tm.color }} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 16 }} numberOfLines={1}>{tm.name}</Body>
              <Body style={{ color: t.dim, fontSize: 12 }}>{tm.owner} · FAAB ${tm.faab}</Body>
            </View>
            <Body style={{ color: t.dim2 }}>›</Body>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}
