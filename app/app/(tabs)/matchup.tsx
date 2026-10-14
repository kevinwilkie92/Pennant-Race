import { View } from 'react-native';
import { useTheme } from '../../src/theme';
import { Body, Card, Display } from '../../src/ui';

export default function Screen() {
  const { t } = useTheme();
  return (
    <View style={{ padding: 16 }}>
      <Card style={{ padding: 20 }}>
        <Display style={{ fontSize: 26 }}>Matchup</Display>
        <Body style={{ color: t.dim, marginTop: 6 }}>Head-to-head weekly matchups with daily point totals. Coming soon — see design/ for the target layout.</Body>
      </Card>
    </View>
  );
}
