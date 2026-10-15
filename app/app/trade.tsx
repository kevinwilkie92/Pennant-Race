import { Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth';
import { TradeComposer } from '../src/TradeComposer';
import { useLeague } from '../src/useLeague';
import { useTheme } from '../src/theme';
import { Body, Display } from '../src/ui';
import { RequireAuth } from '../src/RequireAuth';

// Full-screen composer, opened from another team's roster or the Players tab (team + player preselected).
function TradeInner() {
  const { team, player } = useLocalSearchParams<{ team?: string; player?: string }>();
  const { me } = useAuth();
  const { t } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lg = useLeague();
  const mine = me?.user.teamId;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12 }}>
      <Pressable onPress={() => router.back()}><Body style={{ color: t.red, marginBottom: 8 }}>‹ Back</Body></Pressable>
      <Display style={{ fontSize: 28, marginBottom: 14 }}>Propose a trade</Display>
      {mine && lg.loaded && (
        <TradeComposer myTeamId={mine} teams={lg.teams} initialTeam={team} initialPlayer={player ? Number(player) : undefined}
          onSent={() => router.replace('/team')} />
      )}
    </ScrollView>
  );
}

export default function Trade() {
  return (
    <RequireAuth>
      <TradeInner />
    </RequireAuth>
  );
}
