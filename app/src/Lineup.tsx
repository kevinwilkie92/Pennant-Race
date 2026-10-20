import { Pressable, View } from 'react-native';
import { ilLabels, playerSubline, rosterLabels, sectionLabels, slotLabelRank } from '@pennant/domain';
import { useTeams } from './teams';
import type { LineupSlot, RosterSlot } from './api';
import { fmtPts } from './useLeague';
import { FONT, useTheme } from './theme';
import { Body, Card, Display } from './ui';


type Row = RosterSlot & Partial<Pick<LineupSlot, 'locked' | 'points'>>;
const BADGE: Record<string, string> = { DTD: '#d19a1f', IL: '#ec3b48', OUT: '#ec3b48' };

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
                  {r.injury && (
                    <View style={{ backgroundColor: BADGE[r.injury] ?? t.dim2, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Body style={{ color: '#fff', fontFamily: FONT.bodyBold, fontSize: 10 }}>{r.injury}</Body>
                    </View>
                  )}
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
  const { rules } = useTeams();
  const by = new Map<string, Row>(slots.map((s) => [s.slot, s]));
  // The league's IL slot count — or more, if an old roster has someone in a higher slot.
  const ilCount = Math.max(rules.ilSlots, ...slots.map((s) => (/^IL(\d+)$/.exec(s.slot)?.[1] ? Number(/^IL(\d+)$/.exec(s.slot)![1]) : 0)));
  const p = { by, showPoints, onPress: onPress as ((r: Row) => void) | undefined, selected };
  const { hit, pit, bench } = sectionLabels(rules.roster);
  // Players in slots this league's layout doesn't have (an older season, or a layout that has since shrunk) stay visible.
  const known = new Set([...rosterLabels(rules.roster), ...ilLabels(ilCount)]);
  const other = slots.map((s) => s.slot).filter((l) => !known.has(l)).sort((a, b) => slotLabelRank(a, rules.roster) - slotLabelRank(b, rules.roster));
  return (
    <>
      <Section title="HITTERS" labels={hit} {...p} />
      <Section title="PITCHERS" labels={pit} {...p} />
      <Section title="BENCH" labels={bench} {...p} />
      {other.length > 0 && <Section title="OTHER SLOTS" labels={other} {...p} />}
      {(onPress || slots.some((s) => s.slot.startsWith('IL'))) && <Section title="INJURED LIST" labels={ilLabels(ilCount)} {...p} />}
    </>
  );
}
