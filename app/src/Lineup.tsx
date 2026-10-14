import { View } from 'react-native';
import { playerSubline } from '@pennant/domain';
import type { RosterSlot } from './api';
import { FONT, useTheme } from './theme';
import { Body, Card, Display } from './ui';

const HIT = new Set(['C', '1B', '2B', '3B', 'SS', 'IF', 'OF1', 'OF2', 'OF3', 'OF4', 'Util1', 'Util2']);
const PIT = new Set(['SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2', 'RP3', 'RP4']);

function Section({ title, rows }: { title: string; rows: RosterSlot[] }) {
  const { t } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>{title}</Display>
      <Card style={{ overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <View key={r.slot} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
            <View style={{ width: 42, paddingVertical: 4, borderRadius: t.radius.chip, backgroundColor: t.card2, alignItems: 'center' }}>
              <Display style={{ fontSize: 13, color: t.dim }}>{r.slot.replace(/^B(\d)$/, 'BN')}</Display>
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontFamily: FONT.bodyBold, fontSize: 15 }} numberOfLines={1}>
                {r.name}{r.keeperYear ? `  ·  K${r.keeperYear}` : ''}
              </Body>
              <Body style={{ color: t.dim, fontSize: 12 }}>{playerSubline(r.mlbTeam, r.positions)}</Body>
            </View>
            {/* Points arrive with the live stats feed. */}
            <Body style={{ fontFamily: FONT.num, fontSize: 16, color: t.dim2 }}>—</Body>
          </View>
        ))}
      </Card>
    </View>
  );
}

/** Hitters (slot order, INF after SS), then pitchers (SP×4, RP×4), then bench last. */
export function Lineup({ slots }: { slots: RosterSlot[] }) {
  return (
    <>
      <Section title="HITTERS" rows={slots.filter((s) => HIT.has(s.slot))} />
      <Section title="PITCHERS" rows={slots.filter((s) => PIT.has(s.slot))} />
      <Section title="BENCH" rows={slots.filter((s) => !HIT.has(s.slot) && !PIT.has(s.slot))} />
    </>
  );
}
