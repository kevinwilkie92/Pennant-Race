import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { api, type RosterSlot } from '../../src/api';
import { useAuth } from '../../src/auth';
import { Lineup } from '../../src/Lineup';
import { FONT, useTheme } from '../../src/theme';
import { Body, Card, Display } from '../../src/ui';

export default function MyTeam() {
  const { me } = useAuth();
  const { t } = useTheme();
  const [slots, setSlots] = useState<RosterSlot[] | null>(null);
  const [err, setErr] = useState('');
  const team = me?.team;

  useEffect(() => {
    if (!team) return;
    api.roster(team.id).then((r) => setSlots(r.slots)).catch((e) => setErr(e.message));
  }, [team?.id]);

  if (!team) return <Body style={{ padding: 20, color: t.dim }}>Your account isn't linked to a team yet.</Body>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card style={{ padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: team.color, alignItems: 'center', justifyContent: 'center' }}>
          <Display style={{ fontSize: 22, color: '#fff' }}>{team.name.slice(0, 2).toUpperCase()}</Display>
        </View>
        <View style={{ flex: 1 }}>
          <Display style={{ fontSize: 24 }} numberOfLines={1}>{team.name}</Display>
          <Body style={{ color: t.dim }}>{team.owner_name} · FAAB ${team.faab}</Body>
        </View>
      </Card>
      {!slots && !err && <ActivityIndicator color={t.red} />}
      {!!err && <Body style={{ color: t.loss, fontFamily: FONT.bodyMedium }}>{err}</Body>}
      {slots && <Lineup slots={slots} />}
    </ScrollView>
  );
}
