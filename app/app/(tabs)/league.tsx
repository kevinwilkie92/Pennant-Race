import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, type BracketMatch, type MatchupRow, type StandingRow, type Team, type Txn } from '../../src/api';
import { describeTxn } from '../../src/Transactions';
import { TeamAvatar } from '../../src/TeamAvatar';
import { useAuth } from '../../src/auth';
import { fmtPts, useLeague } from '../../src/useLeague';
import { useTeams } from '../../src/teams';
import { FONT, useTheme } from '../../src/theme';
import { Body, Card, Display } from '../../src/ui';

type Sub = 'standings' | 'matchups' | 'bracket' | 'activity';
const SUBS: { key: Sub; label: string }[] = [
  { key: 'standings', label: 'Standings' }, { key: 'matchups', label: 'Matchups' }, { key: 'bracket', label: 'Bracket' }, { key: 'activity', label: 'Activity' },
];

export default function League() {
  const { t } = useTheme();
  const { me } = useAuth();
  const lg = useLeague();
  const [sub, setSub] = useState<Sub>('standings');
  const noSchedule = lg.loaded && lg.weeks.length === 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
        {SUBS.map((s) => {
          const on = sub === s.key;
          return (
            <Pressable key={s.key} onPress={() => setSub(s.key)}
              style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
              <Display style={{ fontSize: 14, color: on ? '#fff' : t.dim }}>{s.label}</Display>
            </Pressable>
          );
        })}
      </View>
      {noSchedule && <CreateSchedule commissioner={!!me?.user.isCommissioner} onDone={lg.reload} />}
      {sub === 'standings' && <Standings byId={lg.byId} />}
      {sub === 'matchups' && <Matchups lg={lg} />}
      {sub === 'bracket' && <Bracket byId={lg.byId} />}
      {sub === 'activity' && <Activity byId={lg.byId} />}
    </ScrollView>
  );
}

function CreateSchedule({ commissioner, onDone }: { commissioner: boolean; onDone: () => void }) {
  const { t } = useTheme();
  const [date, setDate] = useState('');
  const [err, setErr] = useState('');
  const { rules } = useTeams();
  return (
    <Card style={{ padding: 14, marginBottom: 14 }}>
      <Display style={{ fontSize: 18 }}>No schedule yet</Display>
      {commissioner ? (
        <>
          <Body style={{ color: t.dim, marginVertical: 6, fontSize: 12 }}>
            Enter the Monday that week 1 starts (YYYY-MM-DD). This creates the {rules.regularWeeks}-week round-robin plus {rules.playoffTeams ? `the playoff weeks (top ${rules.playoffTeams})` : 'no playoffs'}.
          </Body>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={date} onChangeText={setDate} placeholder="2027-03-29" placeholderTextColor={t.dim2}
              style={{ flex: 1, color: t.text, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 12, fontFamily: FONT.body }} />
            <Pressable onPress={() => api.createSchedule(date).then(onDone).catch((e) => setErr(e.message))}
              style={{ backgroundColor: t.red, borderRadius: t.radius.button, paddingHorizontal: 16, justifyContent: 'center', paddingVertical: 10 }}>
              <Display style={{ color: '#fff', fontSize: 14 }}>CREATE</Display>
            </Pressable>
          </View>
          {!!err && <Body style={{ color: t.loss, marginTop: 6 }}>{err}</Body>}
        </>
      ) : <Body style={{ color: t.dim, marginTop: 4 }}>The commissioner hasn't created the season schedule yet.</Body>}
    </Card>
  );
}

type SortKey = 'rank' | 'pct' | 'gb' | 'pf' | 'pa' | 'faab' | 'streak';

function Standings({ byId }: { byId: Map<string, Team> }) {
  const { t } = useTheme();
  const router = useRouter();
  const [data, setData] = useState<{ rows: StandingRow[]; playoffTeams: number } | null>(null);
  const [key, setKey] = useState<SortKey>('rank');
  const [desc, setDesc] = useState(false);
  useEffect(() => { api.standings().then(setData).catch(() => setData({ rows: [], playoffTeams: 6 })); }, []);
  if (!data) return <ActivityIndicator color={t.red} />;

  const val = (r: StandingRow): number => key === 'streak' ? (r.streak[0] === 'W' ? 1 : -1) * Number(r.streak.slice(1) || 0) : (r[key] as number);
  const rows = [...data.rows].sort((a, b) => (desc ? -1 : 1) * (val(a) - val(b)) || a.rank - b.rank);
  const head = (k: SortKey, label: string, w: number) => (
    <Pressable onPress={() => { if (key === k) setDesc(!desc); else { setKey(k); setDesc(k !== 'rank' && k !== 'gb' && k !== 'pa'); } }} style={{ width: w }}>
      <Body style={{ textAlign: 'right', color: key === k ? t.text : t.dim, fontFamily: FONT.displayBold, fontSize: 11 }}>
        {label}{key === k ? (desc ? ' ▼' : ' ▲') : ''}
      </Body>
    </Pressable>
  );
  const sorted = key === 'rank' && !desc;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Card style={{ overflow: 'hidden', minWidth: 540 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, paddingBottom: 6, gap: 8 }}>
          <View style={{ width: 22 }} /><View style={{ flex: 1, minWidth: 118, maxWidth: 118 }} />
          <Body style={{ width: 52, textAlign: 'right', color: t.dim, fontFamily: FONT.displayBold, fontSize: 11 }}>W-L</Body>
          {head('pct', 'PCT', 44)}{head('gb', 'GB', 36)}{head('streak', 'STK', 40)}{head('pf', 'PF', 58)}{head('pa', 'PA', 58)}{head('faab', 'FAAB', 46)}
        </View>
        {rows.map((r, i) => {
          const tm = byId.get(r.teamId);
          const line = sorted && i === data.playoffTeams;
          return (
            <View key={r.teamId}>
              {line && (
                <View style={{ borderTopWidth: 2, borderTopColor: t.red, borderStyle: 'dashed', paddingVertical: 2, backgroundColor: t.card }}>
                  <Body style={{ textAlign: 'center', color: t.red, fontFamily: FONT.displayBold, fontSize: 10, letterSpacing: 2 }}>PLAYOFF LINE</Body>
                </View>
              )}
              <Pressable onPress={() => router.push({ pathname: '/team/[id]', params: { id: r.teamId } })}
                style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8, borderTopWidth: 1, borderTopColor: t.line }}>
                <Body style={{ width: 22, color: t.dim, fontFamily: FONT.num }}>{r.rank}</Body>
                <View style={{ flex: 1, minWidth: 118, maxWidth: 118, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {tm ? <TeamAvatar id={tm.id} color={tm.color} logoKey={tm.logoKey} size={26} /> : <View style={{ width: 26 }} />}
                  <Body numberOfLines={1} style={{ flex: 1, fontFamily: FONT.bodySemi, fontSize: 12.5 }}>
                    {tm?.name ?? r.teamId}{r.status === 'clinched' ? '  x' : r.status === 'eliminated' ? '  e' : ''}
                  </Body>
                </View>
                <Body style={{ width: 52, textAlign: 'right', fontFamily: FONT.num }}>{r.w}-{r.l}{r.t ? `-${r.t}` : ''}</Body>
                <Body style={{ width: 44, textAlign: 'right', fontFamily: FONT.num }}>{r.played ? r.pct.toFixed(3).replace(/^0/, '') : '–'}</Body>
                <Body style={{ width: 36, textAlign: 'right', fontFamily: FONT.num, color: t.dim }}>{r.gb === 0 ? '–' : fmtPts(r.gb)}</Body>
                <Body style={{ width: 40, textAlign: 'right', fontFamily: FONT.num, color: r.streak[0] === 'W' ? t.green : r.streak[0] === 'L' ? t.loss : t.dim }}>{r.streak}</Body>
                <Body style={{ width: 58, textAlign: 'right', fontFamily: FONT.num }}>{fmtPts(r.pf)}</Body>
                <Body style={{ width: 58, textAlign: 'right', fontFamily: FONT.num, color: t.dim }}>{fmtPts(r.pa)}</Body>
                <Body style={{ width: 46, textAlign: 'right', fontFamily: FONT.num, color: t.green }}>${r.faab}</Body>
              </Pressable>
            </View>
          );
        })}
        <Body style={{ color: t.dim2, fontSize: 10.5, padding: 10 }}>x = clinched playoff spot · e = eliminated · top {data.playoffTeams} make the playoffs</Body>
      </Card>
    </ScrollView>
  );
}

function Matchups({ lg }: { lg: ReturnType<typeof useLeague> }) {
  const { t } = useTheme();
  const router = useRouter();
  const [week, setWeek] = useState<number | null>(null);
  const [rows, setRows] = useState<MatchupRow[] | null>(null);
  useEffect(() => { if (week == null && lg.current != null) setWeek(lg.current); }, [lg.current]);
  useEffect(() => { if (week != null) { setRows(null); api.matchups(week).then(setRows).catch(() => setRows([])); } }, [week]);
  if (week == null) return lg.loaded ? null : <ActivityIndicator color={t.red} />;
  const idx = lg.weeks.findIndex((w) => w.week === week);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Pressable disabled={idx <= 0} onPress={() => setWeek(lg.weeks[idx - 1].week)}><Body style={{ fontSize: 22, color: idx <= 0 ? t.dim2 : t.text }}>‹</Body></Pressable>
        <Display style={{ fontSize: 18, letterSpacing: 1 }}>WEEK {week}</Display>
        <Pressable disabled={idx >= lg.weeks.length - 1} onPress={() => setWeek(lg.weeks[idx + 1].week)}><Body style={{ fontSize: 22, color: idx >= lg.weeks.length - 1 ? t.dim2 : t.text }}>›</Body></Pressable>
      </View>
      {!rows ? <ActivityIndicator color={t.red} /> : rows.length === 0 ? <Body style={{ color: t.dim }}>No regular-season matchups this week — see the Bracket tab for playoff weeks.</Body> : (
        <Card style={{ overflow: 'hidden' }}>
          {rows.map((m, i) => {
            const h = lg.byId.get(m.home), a = lg.byId.get(m.away);
            return (
              <Pressable key={m.home} onPress={() => router.push({ pathname: '/game/[week]/[home]/[away]', params: { week: String(week), home: m.home, away: m.away } })}
                style={{ padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                {[{ tm: h, s: m.homeScore, o: m.awayScore }, { tm: a, s: m.awayScore, o: m.homeScore }].map(({ tm, s, o }, k) => (
                  <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
                    <View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: tm?.color ?? t.dim2 }} />
                    <Body numberOfLines={1} style={{ flex: 1, fontFamily: m.final && s > o ? FONT.bodyBold : FONT.body }}>{tm?.name}</Body>
                    <Body style={{ fontFamily: FONT.num, fontSize: 16, color: m.final && s < o ? t.dim : t.text }}>{fmtPts(s)}</Body>
                  </View>
                ))}
                <Body style={{ color: t.dim2, fontSize: 10.5, marginTop: 2 }}>{m.final ? 'FINAL' : 'IN PROGRESS / UPCOMING'}</Body>
              </Pressable>
            );
          })}
        </Card>
      )}
    </View>
  );
}

function Bracket({ byId }: { byId: Map<string, Team> }) {
  const { t } = useTheme();
  const { rules } = useTeams();
  const [data, setData] = useState<{ seeds: string[]; matches: BracketMatch[] } | null>(null);
  useEffect(() => { api.bracket().then(setData).catch(() => setData({ seeds: [], matches: [] })); }, []);
  if (!data) return <ActivityIndicator color={t.red} />;
  if (!data.matches.length) {
    return (
      <Card style={{ padding: 18 }}>
        <Display style={{ fontSize: 18 }}>Playoffs</Display>
        <Body style={{ color: t.dim, marginTop: 6 }}>
          {rules.playoffTeams
            ? `${rules.playoffTeams} teams make it, starting week ${rules.regularWeeks + 1}. The bracket fills in when the regular season ends.`
            : 'This league has no playoffs.'}
        </Body>
      </Card>
    );
  }
  const seed = (id: string | null) => (id ? data.seeds.indexOf(id) + 1 : 0);
  const rounds = [...new Set(data.matches.map((m) => m.round))];
  return (
    <View style={{ gap: 14 }}>
      {rounds.map((round) => {
        const ms = data.matches.filter((m) => m.round === round);
        return (
          <View key={round}>
            <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>{round.toUpperCase()} · WK {ms[0]?.week}</Display>
            {ms.map((m) => (
              <Card key={m.id} style={{ marginBottom: 8, overflow: 'hidden' }}>
                {([[m.a, m.aScore], [m.b, m.bScore]] as const).map(([id, sc], i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                    <Body style={{ width: 18, color: t.dim, fontFamily: FONT.num }}>{id ? seed(id) : ''}</Body>
                    <Body numberOfLines={1} style={{ flex: 1, fontFamily: id && id === m.winner ? FONT.bodyBold : FONT.body, color: id ? t.text : t.dim2 }}>{id ? byId.get(id)?.name : 'TBD'}</Body>
                    <Body style={{ fontFamily: FONT.num, fontSize: 16, color: id && id === m.winner ? t.green : t.dim }}>{sc == null ? '' : fmtPts(sc)}</Body>
                  </View>
                ))}
              </Card>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function Activity({ byId }: { byId: Map<string, Team> }) {
  const { t } = useTheme();
  const [log, setLog] = useState<Txn[] | null>(null);
  useEffect(() => { api.transactions().then(setLog).catch(() => setLog([])); }, []);
  if (!log) return <ActivityIndicator color={t.red} />;
  return (
    <Card style={{ overflow: 'hidden' }}>
      {log.length === 0 && <Body style={{ color: t.dim, padding: 14 }}>No waiver or trade activity yet.</Body>}
      {log.map((x, i) => (
        <View key={x.id} style={{ padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
          <Body style={{ fontSize: 13.5 }}>{describeTxn(x, (id) => byId.get(id)?.name ?? id)}</Body>
          <Body style={{ color: t.dim2, fontSize: 11 }}>{new Date(x.at).toLocaleString()}</Body>
        </View>
      ))}
    </Card>
  );
}
