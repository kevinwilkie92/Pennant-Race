import { Pressable, ScrollView, Text, View } from 'react-native';
import { BUDGET } from '@pennant/domain';
import type { DraftManager, Team } from '../api';
import { FONT } from '../theme';
import { D } from './tokens';

export function Money({ managers, teams, onPick }: { managers: DraftManager[]; teams: Team[]; onPick: (id: string) => void }) {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const order = [...managers].sort((a, b) => teams.findIndex((t) => t.id === a.teamId) - teams.findIndex((t) => t.id === b.teamId));
  return (
    <View style={{ width: 310, backgroundColor: D.nav, borderLeftColor: D.line, borderLeftWidth: 1, padding: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <Text style={{ fontFamily: FONT.display, color: D.text, fontSize: 22 }}>The Money</Text>
        <Text style={{ fontFamily: FONT.bodyBold, color: D.dim2, fontSize: 10, letterSpacing: 1.5 }}>LEFT · MAX BID</Text>
      </View>
      <ScrollView>
        {order.map((m) => {
          const t = byId.get(m.teamId);
          return (
            <Pressable key={m.teamId} onPress={() => onPick(m.teamId)} style={{ flexDirection: 'row', marginBottom: 12 }}>
              <View style={{ width: 3, backgroundColor: t?.color ?? D.dim2, marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text numberOfLines={1} style={{ flex: 1, color: D.text, fontFamily: FONT.bodyBold, fontSize: 13 }}>{t?.name ?? m.teamId}</Text>
                  <Text style={{ width: 52, textAlign: 'right', color: D.green, fontFamily: FONT.num, fontSize: 17 }}>${m.remaining}</Text>
                  <Text style={{ width: 46, textAlign: 'right', color: D.gold, fontFamily: FONT.num, fontSize: 17 }}>${m.maxBid}</Text>
                </View>
                <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 5 }}>
                  <View style={{ height: 3, width: `${Math.max(0, Math.min(100, (m.remaining / BUDGET) * 100))}%`, backgroundColor: D.green }} />
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={{ color: D.dim2, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
        Click a manager to view their roster. Max bid holds back $1 for each empty roster spot.
      </Text>
    </View>
  );
}
