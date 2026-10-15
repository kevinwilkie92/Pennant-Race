import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { playerSubline } from '@pennant/domain';
import { api, type Team, type WeekInfo, type WeekSlot } from './api';
import { fmtPts } from './useLeague';
import { FONT, useTheme } from './theme';
import { TeamAvatar } from './TeamAvatar';
import { Body, Card, Display } from './ui';

const HIT = new Set(['C', '1B', '2B', '3B', 'SS', 'IF', 'OF1', 'OF2', 'OF3', 'OF4', 'Util1', 'Util2']);
const PIT = new Set(['SP1', 'SP2', 'SP3', 'SP4', 'RP1', 'RP2', 'RP3', 'RP4']);
const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

type Side = { team: Team; score: number; slots: WeekSlot[] | null; days: string[] };

/** Head-to-head view used by the Matchup tab and by any league matchup you open. */
export function MatchupView({ week, weeks, onWeek, home, away, homeScore, awayScore }: {
  week: number; weeks: WeekInfo[]; onWeek: (w: number) => void;
  home: Team; away: Team; homeScore: number; awayScore: number;
}) {
  const { t } = useTheme();
  const [day, setDay] = useState<string | 'WEEK'>('WEEK');
  const [sides, setSides] = useState<{ h: WeekSlot[]; a: WeekSlot[]; days: string[] } | null>(null);
  useEffect(() => {
    setSides(null); setDay('WEEK');
    Promise.all([api.teamWeek(home.id, week), api.teamWeek(away.id, week)])
      .then(([h, a]) => setSides({ h: h.slots, a: a.slots, days: h.days }))
      .catch(() => setSides({ h: [], a: [], days: [] }));
  }, [home.id, away.id, week]);

  const idx = weeks.findIndex((w) => w.week === week);
  const dayTotal = (slots: WeekSlot[] | undefined) =>
    (slots ?? []).filter((s) => !s.slot.startsWith('B') && !s.slot.startsWith('IL')).reduce((n, s) => n + (day === 'WEEK' ? s.weekTotal : s.byDay[day] ?? 0), 0);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Pressable disabled={idx <= 0} onPress={() => onWeek(weeks[idx - 1].week)} hitSlop={10}>
          <Body style={{ fontSize: 22, color: idx <= 0 ? t.dim2 : t.text }}>‹</Body>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Display style={{ fontSize: 18, letterSpacing: 1 }}>WEEK {week}</Display>
          {weeks[idx] && <Body style={{ color: t.dim, fontSize: 11 }}>{weeks[idx].start} – {weeks[idx].end}</Body>}
        </View>
        <Pressable disabled={idx < 0 || idx >= weeks.length - 1} onPress={() => onWeek(weeks[idx + 1].week)} hitSlop={10}>
          <Body style={{ fontSize: 22, color: idx >= weeks.length - 1 ? t.dim2 : t.text }}>›</Body>
        </Pressable>
      </View>

      <Card style={{ flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12 }}>
        {(() => {
          // Show the selected day's totals when a day is picked, otherwise the week score.
          const shown = [day === 'WEEK' ? homeScore : dayTotal(sides?.h), day === 'WEEK' ? awayScore : dayTotal(sides?.a)];
          return [home, away].map((tm, i) => (
            <View key={tm.id} style={{ flex: 1, alignItems: i ? 'flex-end' : 'flex-start' }}>
              <View style={{ marginBottom: 6 }}><TeamAvatar id={tm.id} color={tm.color} logoKey={tm.logoKey} size={36} /></View>
              <Body numberOfLines={1} style={{ fontFamily: FONT.bodyBold, fontSize: 13 }}>{tm.name}</Body>
              <Display style={{ fontSize: 34, color: shown[i] >= shown[1 - i] ? t.text : t.dim }}>{fmtPts(shown[i])}</Display>
            </View>
          ));
        })()}
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {(['WEEK', ...(sides?.days ?? [])] as const).map((d, i) => {
          const on = day === d;
          return (
            <Pressable key={d} onPress={() => setDay(d)}
              style={{ paddingHorizontal: 14, paddingVertical: 7, marginRight: 6, borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
              <Display style={{ fontSize: 13, color: on ? '#fff' : t.dim }}>{d === 'WEEK' ? 'WEEK' : DOW[i - 1]}</Display>
            </Pressable>
          );
        })}
      </ScrollView>

      {!sides ? <ActivityIndicator color={t.red} /> : (
        <>
          <Roster title="HITTERS" pick={(s) => HIT.has(s.slot)} sides={sides} day={day} home={home} away={away} />
          <Roster title="PITCHERS" pick={(s) => PIT.has(s.slot)} sides={sides} day={day} home={home} away={away} />
          <Roster title="BENCH" pick={(s) => s.slot.startsWith('B')} sides={sides} day={day} home={home} away={away} />
          <Roster title="INJURED LIST" pick={(s) => s.slot.startsWith('IL')} sides={sides} day={day} home={home} away={away} />
        </>
      )}
    </ScrollView>
  );
}

function Roster({ title, pick, sides, day, home, away }: {
  title: string; pick: (s: WeekSlot) => boolean; sides: { h: WeekSlot[]; a: WeekSlot[] }; day: string | 'WEEK'; home: Team; away: Team;
}) {
  const { t } = useTheme();
  const h = sides.h.filter(pick), a = sides.a.filter(pick);
  const rows = Math.max(h.length, a.length);
  if (!rows) return null;
  const cell = (s: WeekSlot | undefined, right: boolean) => {
    if (!s) return <View style={{ flex: 1 }} />;
    const dayPts = day === 'WEEK' ? s.weekTotal : s.byDay[day];
    return (
      <View style={{ flex: 1, flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8 }}>
        <View style={{ flex: 1, alignItems: right ? 'flex-end' : 'flex-start' }}>
          <Body numberOfLines={1} style={{ fontFamily: FONT.bodySemi, fontSize: 12.5 }}>{s.name}</Body>
          <Body numberOfLines={1} style={{ color: t.dim, fontSize: 10 }}>{s.slot.replace(/^B\d$/, 'BN')} · {playerSubline(s.mlbTeam, s.positions)}</Body>
        </View>
        <View style={{ alignItems: right ? 'flex-start' : 'flex-end', minWidth: 34 }}>
          <Body style={{ fontFamily: FONT.num, fontSize: 15, color: dayPts == null ? t.dim2 : dayPts < 0 ? t.loss : t.text }}>{fmtPts(dayPts)}</Body>
          {day !== 'WEEK' && <Body style={{ fontFamily: FONT.num, fontSize: 10, color: t.dim }}>{fmtPts(s.weekTotal)}</Body>}
        </View>
      </View>
    );
  };
  return (
    <View style={{ marginBottom: 12 }}>
      <Display style={{ fontSize: 12, letterSpacing: 1.5, color: t.dim, marginBottom: 4, marginLeft: 4 }}>{title}</Display>
      <Card style={{ overflow: 'hidden' }}>
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={{ flexDirection: 'row', borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
            {cell(h[i], false)}
            <View style={{ width: 1, backgroundColor: t.line }} />
            {cell(a[i], true)}
          </View>
        ))}
      </Card>
    </View>
  );
}
