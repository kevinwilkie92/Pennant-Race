import { Pressable, View } from 'react-native';
import { BENCH_SLOTS, HIT_SLOTS, PIT_SLOTS, ROSTER_LABELS, playerSubline } from '@pennant/domain';
import type { LineupSlot, RosterSlot } from './api';
import { fmtPts } from './useLeague';
import { FONT, useTheme } from './theme';
import { Body, Card, Display } from './ui';

const NH = HIT_SLOTS.length, NP = PIT_SLOTS.length;
const HIT = ROSTER_LABELS.slice(0, NH), PIT = ROSTER_LABELS.slice(NH, NH + NP), BEN = ROSTER_LABELS.slice(NH + NP);
void BENCH_SLOTS;

type Row = RosterSlot & Partial<Pick<LineupSlot, 'locked' | 'points'>>;

function Section({ title, labels, by, showPoints, onPress, selected }: {
  title: string; labels: readonly string[]; by: Map<string, Row>; showPoints: boolean;
  onPress?: (r: Row) => void; selected?: number | null;
}) {
  const { t } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>{title}</Display>
      <Card style={{ overflow: 'hidden' }}>
        {labels.map((label, i) => {
          const r = by.get(label);
          const badge = label.replace(/^B\d$/, 'BN');
          return (
            <Pressable key={label} disabled={!r || !onPress} onPress={() => r && onPress?.(r)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line,
                backgroundColor: r && selected === r.playerId ? t.card2 : 'transparent' }}>
              <View style={{ width: 42, paddingVertical: 4, borderRadius: t.radius.chip, backgroundColor: t.card2, alignItems: 'center' }}>
                <Display style={{ fontSize: 13, color: t.dim }}>{badge}</Display>
              </View>
              {r ? (
                <>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontFamily: FONT.bodyBold, fontSize: 15 }} numberOfLines={1}>
                      {r.locked ? '🔒 ' : ''}{r.name}{r.keeperYear ? `  ·  K${r.keeperYear}` : ''}
                    </Body>
                    <Body style={{ color: t.dim, fontSize: 12 }}>{playerSubline(r.mlbTeam, r.positions)}</Body>
                  </View>
                  {showPoints && (
                    <Body style={{ fontFamily: FONT.num, fontSize: 16, color: r.points == null ? t.dim2 : r.points < 0 ? t.loss : t.text }}>{fmtPts(r.points)}</Body>
                  )}
                </>
              ) : <Body style={{ flex: 1, color: t.dim2, fontSize: 14 }}>Empty</Body>}
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

/** Hitters (slot order, INF after SS), then pitchers (SP×4, RP×4), then bench at the bottom. Empty slots are shown. */
export function Lineup<T extends Row>({ slots, showPoints = false, onPress, selected }: {
  slots: T[]; showPoints?: boolean; onPress?: (r: T) => void; selected?: number | null;
}) {
  const by = new Map<string, Row>(slots.map((s) => [s.slot, s]));
  const p = { by, showPoints, onPress: onPress as ((r: Row) => void) | undefined, selected };
  return (
    <>
      <Section title="HITTERS" labels={HIT} {...p} />
      <Section title="PITCHERS" labels={PIT} {...p} />
      <Section title="BENCH" labels={BEN} {...p} />
    </>
  );
}
