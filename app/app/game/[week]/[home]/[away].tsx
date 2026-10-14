import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../../src/api';
import { MatchupView } from '../../../../src/MatchupView';
import { useLeague } from '../../../../src/useLeague';
import { useTheme } from '../../../../src/theme';
import { Body } from '../../../../src/ui';

// Any league matchup, rendered exactly like the Matchup tab.
export default function Game() {
  const p = useLocalSearchParams<{ week: string; home: string; away: string }>();
  const { t } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lg = useLeague();
  const [week, setWeek] = useState(Number(p.week));
  const [scores, setScores] = useState<{ h: number; a: number } | null>(null);
  useEffect(() => {
    setScores(null);
    api.matchups(week).then((r) => {
      const m = r.find((x) => x.home === p.home && x.away === p.away);
      setScores({ h: m?.homeScore ?? 0, a: m?.awayScore ?? 0 });
    }).catch(() => setScores({ h: 0, a: 0 }));
  }, [week, p.home, p.away]);
  const home = lg.byId.get(p.home), away = lg.byId.get(p.away);
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
      <Pressable onPress={() => router.back()} style={{ paddingHorizontal: 16 }}><Body style={{ color: t.red }}>‹ Back</Body></Pressable>
      {home && away && scores
        ? <MatchupView week={week} weeks={lg.weeks.filter((w) => w.week === week)} onWeek={setWeek} home={home} away={away} homeScore={scores.h} awayScore={scores.a} />
        : <ActivityIndicator color={t.red} style={{ marginTop: 40 }} />}
    </View>
  );
}
