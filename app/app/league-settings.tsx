import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BUDGET, HIT_SCORING, MAX_IL, MAX_KEEPERS, MAX_LEAGUE_NAME, PIT_SCORING, PLAYOFF_TEAMS, REGULAR_WEEKS, ROSTER_SIZE } from '@pennant/domain';
import { api, type LeagueSettings } from '../src/api';
import { useAuth } from '../src/auth';
import { RequireAuth } from '../src/RequireAuth';
import { useRealtime } from '../src/realtime';
import { TeamAvatar } from '../src/TeamAvatar';
import { useTeams } from '../src/teams';
import { FONT, useTheme } from '../src/theme';
import { Body, Card, Display } from '../src/ui';

const when = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** League name, who the commissioners are, sign-ups and the join code, waiver period, season tools, and the fixed rules. */
function Settings() {
  const { me } = useAuth();
  const { t } = useTheme();
  const { byId } = useTeams();
  const { subscribe } = useRealtime();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<LeagueSettings | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const boss = !!me?.user.isCommissioner;

  const load = useCallback(async () => {
    const r = await api.leagueSettings().catch(() => null);
    if (r) { setS(r); setName((n) => (n === '' || n === s?.name ? r.name : n)); }
  }, [s?.name]);
  useEffect(() => { load(); }, []);                                       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => subscribe((ev) => { if (ev.type === 'league') api.leagueSettings().then((r) => { setS(r); setName(r.name); }).catch(() => {}); }), [subscribe]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' }); }
    const r = await api.leagueSettings().catch(() => null);
    if (r) { setS(r); setName(r.name); }
    setBusy('');
  };

  const section = (label: string) => <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1.5, marginTop: 6, marginBottom: 6 }}>{label}</Body>;
  const btn = (label: string, press: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => (
    <Pressable onPress={press} disabled={!!busy || opts.disabled} style={{ backgroundColor: opts.primary ? t.red : 'transparent', borderColor: opts.primary ? t.red : t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 14, paddingVertical: 9, opacity: busy || opts.disabled ? 0.5 : 1 }}>
      <Display style={{ fontSize: 13, color: opts.primary ? '#fff' : t.text }}>{label}</Display>
    </Pressable>
  );
  const input = { color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 12, paddingVertical: 9, fontFamily: FONT.body } as const;

  if (!s) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.red} /></View>;
  const commissioners = s.commissioners.filter((c) => c.isCommissioner && c.hasAccount).length;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()}><Body style={{ color: t.red, marginBottom: 8 }}>‹ Back</Body></Pressable>
      <Display style={{ fontSize: 26 }}>League settings</Display>
      {!boss && <Body style={{ color: t.dim, fontSize: 12, marginTop: 2 }}>You can see these. Only commissioners can change them.</Body>}
      {msg && <Body style={{ color: msg.ok ? t.green : t.loss, fontFamily: FONT.bodyMedium, marginTop: 8 }}>{msg.text}</Body>}

      {section('LEAGUE')}
      <Card style={{ padding: 14, marginBottom: 12 }}>
        {boss ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={name} onChangeText={setName} maxLength={MAX_LEAGUE_NAME} placeholder="League name" placeholderTextColor={t.dim2} style={[input, { flex: 1 }]} />
            {btn('SAVE', () => run('name', () => api.setLeagueSettings({ name }), 'League name saved.'), { primary: true, disabled: name.trim() === s.name })}
          </View>
        ) : <Display style={{ fontSize: 20 }}>{s.name}</Display>}
      </Card>

      {section(`COMMISSIONERS (${commissioners})`)}
      <Card style={{ overflow: 'hidden', marginBottom: 12 }}>
        <Body style={{ color: t.dim, fontSize: 12, padding: 12, paddingBottom: 6 }}>
          Commissioners can run the draft, set lineups for anyone, edit these settings, and appoint or remove other commissioners. Every change is logged below.
        </Body>
        {s.commissioners.map((c) => {
          const team = byId.get(c.teamId);
          const mine = c.teamId === me?.user.teamId;
          return (
            <View key={c.teamId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderTopWidth: 1, borderTopColor: t.line }}>
              <TeamAvatar id={c.teamId} color={team?.color ?? t.dim2} logoKey={team?.logoKey} size={32} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontFamily: FONT.bodySemi }}>{team?.name ?? c.name}{mine ? ' (you)' : ''}</Body>
                <Body style={{ color: t.dim, fontSize: 12 }}>{c.owner}{c.hasAccount ? '' : ' · hasn’t signed up yet'}</Body>
              </View>
              {c.isCommissioner && <Body style={{ color: t.gold, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>COMMISSIONER</Body>}
              {boss && (c.isCommissioner
                ? <Pressable disabled={!!busy} onPress={() => run(`c${c.teamId}`, () => api.setCommissioner(c.teamId, false), mine ? 'You are no longer a commissioner.' : `${team?.name ?? c.name} is no longer a commissioner.`)}><Body style={{ color: t.loss, fontFamily: FONT.bodyBold, fontSize: 12 }}>{mine ? 'STEP DOWN' : 'REMOVE'}</Body></Pressable>
                : <Pressable disabled={!!busy || !c.hasAccount} onPress={() => run(`c${c.teamId}`, () => api.setCommissioner(c.teamId, true), `${team?.name ?? c.name} is now a commissioner.`)}><Body style={{ color: c.hasAccount ? t.red : t.dim2, fontFamily: FONT.bodyBold, fontSize: 12 }}>MAKE COMMISSIONER</Body></Pressable>)}
            </View>
          );
        })}
      </Card>

      {section('SIGN-UPS')}
      <Card style={{ padding: 14, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontFamily: FONT.bodySemi }}>New managers can sign up</Body>
            <Body style={{ color: t.dim, fontSize: 12 }}>{s.signupsOpen ? 'Open: anyone with the join code can take an unclaimed team.' : 'Closed: nobody new can join, even with the code. Current managers are unaffected.'}</Body>
          </View>
          <Switch value={s.signupsOpen} disabled={!boss || !!busy} onValueChange={(v) => run('signups', () => api.setLeagueSettings({ signupsOpen: v }))} trackColor={{ true: t.red }} />
        </View>
        {boss && (
          <>
            <View style={{ height: 1, backgroundColor: t.line, marginVertical: 12 }} />
            <Body style={{ color: t.dim, fontSize: 11, fontFamily: FONT.bodyBold, letterSpacing: 1 }}>JOIN CODE{s.joinCodeSource === 'server' ? ' (set on the server)' : ''}</Body>
            <Display selectable style={{ fontSize: 28, letterSpacing: 2, marginVertical: 4 }}>{s.joinCode ?? '—'}</Display>
            <Body style={{ color: t.dim, fontSize: 12, marginBottom: 8 }}>Share this with managers who haven't joined. Changing it stops the old code working straight away. Capitals, spaces and the hyphen don't matter.</Body>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {btn('NEW RANDOM CODE', () => run('code', () => api.setJoinCode(), 'New join code made.'))}
              {s.joinCodeSource === 'app' && btn('USE THE SERVER’S CODE', () => run('code', () => api.resetJoinCode(), 'Back to the server’s join code.'))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={code} onChangeText={setCode} autoCapitalize="none" placeholder="Or type your own (6+ letters/numbers)" placeholderTextColor={t.dim2} style={[input, { flex: 1 }]} />
              {btn('SET', () => run('code', async () => { await api.setJoinCode(code); setCode(''); }, 'Join code changed.'), { disabled: code.trim().length < 6 })}
            </View>
          </>
        )}
      </Card>

      {section('WAIVERS')}
      <Card style={{ padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontFamily: FONT.bodySemi }}>Waiver period after a drop</Body>
          <Body style={{ color: t.dim, fontSize: 12 }}>How long a dropped player stays on waivers. 0 means claimable at the next run.</Body>
        </View>
        {boss && <Pressable disabled={!!busy || s.waiverDays <= 0} onPress={() => run('days', () => api.setLeagueSettings({ waiverDays: s.waiverDays - 1 }))} hitSlop={8}><Display style={{ fontSize: 26, color: s.waiverDays <= 0 ? t.dim2 : t.text }}>−</Display></Pressable>}
        <Display style={{ fontSize: 20, minWidth: 64, textAlign: 'center' }}>{s.waiverDays} day{s.waiverDays === 1 ? '' : 's'}</Display>
        {boss && <Pressable disabled={!!busy || s.waiverDays >= 14} onPress={() => run('days', () => api.setLeagueSettings({ waiverDays: s.waiverDays + 1 }))} hitSlop={8}><Display style={{ fontSize: 26, color: s.waiverDays >= 14 ? t.dim2 : t.text }}>+</Display></Pressable>}
      </Card>

      {section(`SEASON${s.season ? ` ${s.season}` : ''}`)}
      <Card style={{ padding: 14, marginBottom: 12 }}>
        <Body style={{ fontFamily: FONT.bodySemi }}>{s.schedule.created ? `Schedule created · week 1 starts ${s.schedule.start}` : 'No schedule yet'}</Body>
        {!s.schedule.created && boss && (
          <>
            <Body style={{ color: t.dim, fontSize: 12, marginVertical: 6 }}>Enter the Monday week 1 starts (YYYY-MM-DD). This makes 26 weeks and the {REGULAR_WEEKS}-week round robin.</Body>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={start} onChangeText={setStart} autoCapitalize="none" placeholder="2027-03-29" placeholderTextColor={t.dim2} style={[input, { flex: 1 }]} />
              {btn('CREATE', () => run('sched', () => api.createSchedule(start), 'Schedule created.'), { primary: true, disabled: !/^\d{4}-\d{2}-\d{2}$/.test(start) })}
            </View>
          </>
        )}
        {boss && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {btn('RUN WAIVERS NOW', () => run('waivers', async () => { const r = await api.processWaivers(); setMsg({ ok: true, text: `Waivers processed: ${r.won} won, ${r.failed} failed.` }); }))}
            {btn('MLB STATS FEED ›', () => router.push('/stats-feed'))}
          </View>
        )}
      </Card>

      {boss && s.audit && s.audit.length > 0 && (
        <>
          {section('RECENT CHANGES')}
          <Card style={{ overflow: 'hidden', marginBottom: 12 }}>
            {s.audit.map((a, i) => (
              <View key={a.id} style={{ padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                <Body style={{ fontSize: 13 }}>{a.detail}</Body>
                <Body style={{ color: t.dim2, fontSize: 11 }}>{when(a.at)}</Body>
              </View>
            ))}
          </Card>
        </>
      )}

      {section('THE RULES (FIXED)')}
      <Card style={{ padding: 14 }}>
        <Body style={{ color: t.dim, fontSize: 12, marginBottom: 8 }}>These are built into the app and can't be changed here.</Body>
        {[
          ['Roster', `${ROSTER_SIZE} players, plus up to ${MAX_IL} on the injured list`], ['Auction budget', `$${BUDGET} per team, $1 minimum bid`], ['Keepers', `Up to ${MAX_KEEPERS} per team`],
          ['FAAB', `$${BUDGET} per season`], ['Season', `${REGULAR_WEEKS} regular-season weeks, top ${PLAYOFF_TEAMS} make the playoffs`],
        ].map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', gap: 10, paddingVertical: 3 }}>
            <Body style={{ width: 110, color: t.dim, fontSize: 13 }}>{k}</Body><Body style={{ flex: 1, fontSize: 13 }}>{v}</Body>
          </View>
        ))}
        <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, marginTop: 10 }}>HITTING</Body>
        <Body style={{ fontSize: 13 }}>{Object.entries(HIT_SCORING).map(([k, v]) => `${k} ${v}`).join(' · ')}</Body>
        <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, marginTop: 8 }}>PITCHING</Body>
        <Body style={{ fontSize: 13 }}>{Object.entries(PIT_SCORING).map(([k, v]) => `${k} ${v}`).join(' · ')}</Body>
      </Card>
    </ScrollView>
  );
}

export default function LeagueSettings() { return <RequireAuth><Settings /></RequireAuth>; }
