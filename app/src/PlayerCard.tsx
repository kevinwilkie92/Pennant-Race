import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { battingAvg, era, inningsFromOuts } from '@pennant/domain';
import { api, type PlayerCardData, type PlayerCareer } from './api';
import { FONT, useTheme } from './theme';
import { Body, Card, Display } from './ui';

const when = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const HEIGHT = 84;
const ip = (x = 0) => { const outs = Math.round(x * 3); return `${Math.floor(outs / 3)}.${outs % 3}`; };
const HIT_COLS: [string, (t: Record<string, number>, g: number) => string | number][] = [
  ['G', (_, g) => g], ['H', (t) => (t['1B'] ?? 0) + (t['2B'] ?? 0) + (t['3B'] ?? 0) + (t.HR ?? 0)], ['HR', (t) => t.HR ?? 0],
  ['R', (t) => t.R ?? 0], ['RBI', (t) => t.RBI ?? 0], ['SB', (t) => t.SB ?? 0], ['BB', (t) => (t.BB ?? 0) + (t.IBB ?? 0)], ['K', (t) => t.SO ?? 0],
];
const PIT_COLS: [string, (t: Record<string, number>, g: number) => string | number][] = [
  ['G', (_, g) => g], ['IP', (t) => ip(t.IP)], ['W', (t) => t.W ?? 0], ['QS', (t) => t.QS ?? 0], ['SV', (t) => t.SV ?? 0],
  ['HLD', (t) => t.HLD ?? 0], ['K', (t) => t.K ?? 0], ['ER', (t) => t.ER ?? 0],
];

/** Player card: fantasy points, season totals and recent games from the MLB feed, plus the player's league history. */
export function PlayerCard({ playerId, teamName, onClose }: { playerId: number | null; teamName: (id: string) => string; onClose: () => void }) {
  const { t } = useTheme();
  const [d, setD] = useState<PlayerCardData | null>(null);
  const [tab, setTab] = useState<'season' | 'career' | 'history'>('season');
  const [career, setCareer] = useState<PlayerCareer | null | 'error'>(null);
  useEffect(() => { setD(null); setCareer(null); setTab('season'); if (playerId != null) api.playerCard(playerId).then(setD).catch(() => setD(null)); }, [playerId]);
  if (playerId == null) return null;

  const pts = d ? [...d.points].reverse() : [];                       // oldest → newest
  const max = Math.max(1, ...pts.map((x) => Math.abs(x.points)));
  const line = (h: PlayerCardData['history'][number]) =>
    h.type === 'waiver' ? `Added by ${teamName(h.teamId)} on waivers ($${h.faab ?? 0})`
      : h.type === 'drop' ? `Dropped by ${teamName(h.teamId)}`
      : h.type === 'trade' ? `Traded ${h.from ? `${teamName(h.from)} → ` : ''}${teamName(h.teamId)}`
      : `${h.type} · ${teamName(h.teamId)}`;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '88%', backgroundColor: t.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderColor: t.line, borderWidth: 1, paddingBottom: 24 }}>
          {!d ? <ActivityIndicator color={t.red} style={{ margin: 40 }} /> : (
            <>
              <View style={{ padding: 16, paddingBottom: 8 }}>
                <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>{d.player.positions.join(' · ')}</Body>
                <Display style={{ fontSize: 28 }}>{d.player.name}</Display>
                <Body style={{ color: t.dim, fontSize: 13 }}>
                  {d.player.mlbTeam ?? 'Free agent'} · {d.ownerId ? `On ${teamName(d.ownerId)}` : d.waiversUntil ? `On waivers until ${d.waiversUntil}` : 'Free agent'}
                </Body>
                {d.injury && <Body style={{ color: t.loss, fontFamily: FONT.bodyBold, fontSize: 13, marginTop: 4 }}>{d.injury.status}{d.injury.note ? ` — ${d.injury.note}` : ''}</Body>}
              </View>
              <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginBottom: 8 }}>
                {([['season', 'Season'], ['career', 'Career'], ['history', 'History']] as const).map(([k, label]) => {
                  const on = tab === k;
                  return (
                    <Pressable key={k} onPress={() => { setTab(k); if (k === 'career' && career === null && playerId != null) api.playerCareer(playerId).then(setCareer).catch(() => setCareer('error')); }} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
                      <Display style={{ fontSize: 13, color: on ? '#fff' : t.dim }}>{label}</Display>
                    </Pressable>
                  );
                })}
              </View>
              <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
                {tab === 'career' ? (
                  <CareerTable data={career} />
                ) : tab === 'season' ? (
                  <>
                    <Card style={{ padding: 14, marginBottom: 12 }}>
                      <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>FANTASY POINTS</Body>
                      <Display style={{ fontSize: 32, color: d.seasonPoints < 0 ? t.loss : t.text }}>{d.seasonPoints}</Display>
                      {pts.length === 0 ? (
                        <Body style={{ color: t.dim, fontSize: 12, marginTop: 4 }}>No scored games yet.</Body>
                      ) : (
                        <View style={{ height: HEIGHT * 2, flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 10 }}>
                          {pts.map((x) => {
                            const h = (Math.abs(x.points) / max) * HEIGHT;
                            return (
                              <View key={x.date} style={{ flex: 1, height: HEIGHT * 2, justifyContent: 'center' }}>
                                {/* positive bars rise from the midline, negative ones hang below it in red */}
                                <View style={{ height: HEIGHT, justifyContent: 'flex-end' }}>{x.points >= 0 && <View style={{ height: h, backgroundColor: t.green, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />}</View>
                                <View style={{ height: HEIGHT }}>{x.points < 0 && <View style={{ height: h, backgroundColor: t.loss, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />}</View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </Card>
                    {d.stats ? (
                      <>
                        <Card style={{ padding: 14, marginBottom: 12 }}>
                          <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>{d.stats.season} STATS · {d.stats.points} PTS</Body>
                          <View style={{ flexDirection: 'row', marginTop: 8 }}>
                            {(d.stats.role === 'P' ? PIT_COLS : HIT_COLS).map(([label, f]) => (
                              <View key={label} style={{ flex: 1, alignItems: 'center' }}>
                                <Body style={{ color: t.dim2, fontSize: 10, fontFamily: FONT.bodyBold }}>{label}</Body>
                                <Display style={{ fontSize: 17 }}>{f(d.stats!.totals, d.stats!.games)}</Display>
                              </View>
                            ))}
                          </View>
                        </Card>
                        <Card style={{ overflow: 'hidden' }}>
                          <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, padding: 12, paddingBottom: 6 }}>RECENT GAMES</Body>
                          {d.stats.log.map((g, i) => (
                            <View key={`${g.date}${i}`} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.line, gap: 10 }}>
                              <Body style={{ color: t.dim, fontSize: 12, width: 52 }}>{g.date.slice(5).replace('-', '/')}</Body>
                              <Body style={{ flex: 1, fontSize: 13 }}>{g.summary}</Body>
                              <Display style={{ fontSize: 15, color: g.points < 0 ? t.loss : t.text }}>{g.points}</Display>
                            </View>
                          ))}
                        </Card>
                      </>
                    ) : (
                      <Body style={{ color: t.dim2, fontSize: 12 }}>No MLB games recorded for this player yet.</Body>
                    )}
                  </>
                ) : (
                  <Card style={{ overflow: 'hidden' }}>
                    {d.draft.map((x) => (
                      <View key={`d${x.season}`} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line }}>
                        <Body style={{ fontFamily: FONT.bodySemi }}>{x.season} {x.isKeeper ? `keeper (Year ${x.keeperYear ?? '?'})` : 'draft'} · {teamName(x.teamId)} · ${x.price}</Body>
                      </View>
                    ))}
                    {d.history.map((h, i) => (
                      <View key={i} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line }}>
                        <Body style={{ fontFamily: FONT.bodySemi }}>{line(h)}</Body>
                        <Body style={{ color: t.dim2, fontSize: 11 }}>{when(h.at)}</Body>
                      </View>
                    ))}
                    {d.draft.length === 0 && d.history.length === 0 && <Body style={{ color: t.dim, padding: 14 }}>No transactions yet.</Body>}
                  </Card>
                )}
              </ScrollView>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}


type Col = { label: string; w: number; f: (st: Record<string, number>) => string | number };
const HIT_CAREER: Col[] = [
  { label: 'G', w: 40, f: (s) => s.g }, { label: 'AVG', w: 52, f: (s) => battingAvg(s.h, s.ab) }, { label: 'HR', w: 40, f: (s) => s.hr },
  { label: 'R', w: 40, f: (s) => s.r }, { label: 'RBI', w: 44, f: (s) => s.rbi }, { label: 'SB', w: 38, f: (s) => s.sb }, { label: 'BB', w: 40, f: (s) => s.bb },
];
const PIT_CAREER: Col[] = [
  { label: 'G', w: 36, f: (s) => s.g }, { label: 'GS', w: 36, f: (s) => s.gs }, { label: 'IP', w: 52, f: (s) => inningsFromOuts(s.outs) }, { label: 'W', w: 34, f: (s) => s.w },
  { label: 'QS', w: 36, f: (s) => s.qs }, { label: 'SV', w: 36, f: (s) => s.sv }, { label: 'ERA', w: 48, f: (s) => era(s.er, s.outs) }, { label: 'K', w: 40, f: (s) => s.k },
];

/** Season-by-season MLB career with fantasy points under this league's scoring. */
function CareerTable({ data }: { data: PlayerCareer | null | 'error' }) {
  const { t } = useTheme();
  if (data === null) return <ActivityIndicator color={t.red} style={{ margin: 20 }} />;
  if (data === 'error') return <Body style={{ color: t.dim, padding: 14 }}>Couldn't load career stats right now. Try again in a moment.</Body>;
  if (!data.available) return <Body style={{ color: t.dim, padding: 14 }}>{data.reason ?? 'No career stats available.'}</Body>;
  const cols = data.role === 'P' ? PIT_CAREER : HIT_CAREER;
  const cell = (w: number, text: string | number, o: { bold?: boolean; color?: string; right?: boolean } = {}) => (
    <Body style={{ width: w, textAlign: o.right === false ? 'left' : 'right', fontSize: 13, fontFamily: o.bold ? FONT.bodyBold : FONT.body, color: o.color ?? t.text }}>{text}</Body>
  );
  const row = (key: string, year: string, team: string, st: Record<string, number>, pts: number, bold = false) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, gap: 6, borderTopWidth: 1, borderTopColor: t.line }}>
      {cell(40, year, { bold, right: false })}{cell(50, team, { bold, right: false, color: t.dim })}
      {cell(52, pts, { bold: true, color: pts < 0 ? t.loss : t.gold })}
      {cols.map((c) => <View key={c.label}>{cell(c.w, c.f(st), { bold })}</View>)}
    </View>
  );
  return (
    <Card style={{ overflow: 'hidden' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, gap: 6 }}>
            {cell(40, 'YR', { right: false, color: t.dim2, bold: true })}{cell(50, 'TM', { right: false, color: t.dim2, bold: true })}{cell(52, 'PTS', { color: t.dim2, bold: true })}
            {cols.map((c) => <View key={c.label}>{cell(c.w, c.label, { color: t.dim2, bold: true })}</View>)}
          </View>
          {[...data.seasons].reverse().map((s) => row(String(s.season), String(s.season), s.teams.length > 1 ? `${s.teams.length} tms` : s.teams[0] ?? '', s.stats, s.points))}
          {row('car', 'CAR', '', data.totals.stats, data.totals.points, true)}
        </View>
      </ScrollView>
      <Body style={{ color: t.dim2, fontSize: 11, padding: 10, borderTopWidth: 1, borderTopColor: t.line }}>
        PTS is fantasy points under this league's scoring{data.role === 'P' ? ' (quality starts counted from game logs)' : ''}. Regular-season MLB only.{data.stale ? ' Showing a saved copy: MLB could not be reached.' : ''}
      </Body>
    </Card>
  );
}
