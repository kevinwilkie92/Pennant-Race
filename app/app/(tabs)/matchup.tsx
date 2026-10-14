import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, type MatchupRow } from '../../src/api';
import { useAuth } from '../../src/auth';
import { MatchupView } from '../../src/MatchupView';
import { useLeague } from '../../src/useLeague';
import { useTheme } from '../../src/theme';
import { Body, Card, Display } from '../../src/ui';

// Defaults to your matchup for the current week; you are always shown as the home side (README).
export default function Matchup() {
  const { me } = useAuth();
  const { t } = useTheme();
  const lg = useLeague();
  const [week, setWeek] = useState<number | null>(null);
  const [rows, setRows] = useState<MatchupRow[] | null>(null);
  useEffect(() => { if (week == null && lg.current != null) setWeek(lg.current); }, [lg.current]);
  useEffect(() => { if (week != null) { setRows(null); api.matchups(week).then(setRows).catch(() => setRows([])); } }, [week]);

  const myId = me?.user.teamId;
  if (!lg.loaded) return <ActivityIndicator color={t.red} style={{ marginTop: 40 }} />;
  if (week == null || lg.weeks.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        <Card style={{ padding: 20 }}>
          <Display style={{ fontSize: 24 }}>No schedule yet</Display>
          <Body style={{ color: t.dim, marginTop: 6 }}>
            Matchups appear once the commissioner creates the season schedule (League tab).
          </Body>
        </Card>
      </View>
    );
  }
  if (!rows) return <ActivityIndicator color={t.red} style={{ marginTop: 40 }} />;
  const m = rows.find((r) => r.home === myId || r.away === myId);
  const mine = m && lg.byId.get(myId!), opp = m && lg.byId.get(m.home === myId ? m.away : m.home);
  if (!m || !mine || !opp) {
    return <View style={{ padding: 16 }}><Body style={{ color: t.dim }}>No matchup for your team in week {week} (playoff bye or eliminated).</Body></View>;
  }
  const mineHome = m.home === myId;
  return (
    <MatchupView week={week} weeks={lg.weeks} onWeek={setWeek} home={mine} away={opp}
      homeScore={mineHome ? m.homeScore : m.awayScore} awayScore={mineHome ? m.awayScore : m.homeScore} />
  );
}
