import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_RULES, HIT_LABELS, LIMITS, MAX_LEAGUE_NAME, PIT_LABELS, PLAYOFF_TEAMS, REGULAR_WEEKS, ROSTER_SIZE, SCORE_MAX, SCORE_MIN, type LeagueRules } from '@pennant/domain';
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
  const { byId, rules } = useTeams();
  const [scoreEdit, setScoreEdit] = useState<{ hit: Record<string, string>; pit: Record<string, string> }>({ hit: {}, pit: {} });
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

      {section('LEAGUE RULES')}
      <Card style={{ overflow: 'hidden', marginBottom: 12 }}>
        <Body style={{ color: t.dim, fontSize: 12, padding: 12, paddingBottom: 6 }}>
          {boss ? 'Change a number and it saves when you leave the box or tap − / +. The app refuses a change that would break something already in progress (for example a budget below what a team has spent).' : 'These are the league’s rules. Only commissioners can change them.'}
        </Body>
        {([
          ['budget', 'Auction budget', '$', 25, 'Dollars each team has for the auction.'], ['minBid', 'Minimum bid', '$', 1, 'The smallest winning bid.'],
          ['maxKeepers', 'Keepers per team', '', 1, 'How many players a team may keep.'], ['keeperIncrease', 'Keeper cost increase', '$', 1, 'A Year-1 keeper costs last year’s price plus this.'],
          ['faabBudget', 'FAAB budget', '$', 25, 'Waiver dollars per team, reset each season.'], ['ilSlots', 'Injured-list slots', '', 1, 'Spots for injured players outside the 26-man roster.'],
        ] as const).map(([key, label, unit, step, hint]) => (
          <NumberRule key={key} label={label} hint={hint} unit={unit} step={step} value={rules[key]} min={LIMITS[key].min} max={LIMITS[key].max} editable={boss} busy={!!busy}
            onSave={(n) => run(`rule-${key}`, () => api.setLeagueRules({ [key]: n }), `${label} saved.`)} />
        ))}
      </Card>

      {section('SCORING')}
      <Card style={{ padding: 14, marginBottom: 12 }}>
        <Body style={{ color: t.dim, fontSize: 12, marginBottom: 8 }}>
          Points per stat (negative values are penalties; up to 2 decimals, between {SCORE_MIN} and {SCORE_MAX}).
          {boss ? ' Saving recalculates every saved score, including past weeks and past seasons, so standings and matchup results can change.' : ''}
        </Body>
        {([['hit', 'HITTING', HIT_LABELS], ['pit', 'PITCHING', PIT_LABELS]] as const).map(([grp, title, labels]) => (
          <View key={grp} style={{ marginBottom: 6 }}>
            <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, marginVertical: 6 }}>{title}</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(labels).map(([k, label]) => {
                const cur = (rules[grp] as Record<string, number>)[k];
                const typed = scoreEdit[grp][k];
                const shown = typed ?? String(cur);
                const changed = typed !== undefined && Number(typed) !== cur;
                return (
                  <View key={k} style={{ width: 128, borderWidth: 1, borderColor: changed ? t.gold : t.line, borderRadius: t.radius.button, padding: 8 }}>
                    <Body style={{ color: t.dim, fontSize: 11 }} numberOfLines={1}>{label}</Body>
                    {boss ? (
                      <TextInput value={shown} onChangeText={(v) => setScoreEdit((e) => ({ ...e, [grp]: { ...e[grp], [k]: v.replace(/[^0-9.-]/g, '') } }))} keyboardType="numbers-and-punctuation"
                        style={{ color: t.text, fontFamily: FONT.num, fontSize: 18, padding: 0, marginTop: 2 }} />
                    ) : <Display style={{ fontSize: 18 }}>{cur}</Display>}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
        {boss && (() => {
          const patch = (['hit', 'pit'] as const).reduce<Record<string, Record<string, number>>>((o, g) => {
            const changes = Object.fromEntries(Object.entries(scoreEdit[g]).filter(([k, v]) => v !== '' && v !== '-' && v !== '.' && Number(v) !== (rules[g] as Record<string, number>)[k]).map(([k, v]) => [k, Number(v)]));
            return Object.keys(changes).length ? { ...o, [g]: changes } : o;
          }, {});
          const dirty = Object.keys(patch).length > 0;
          const isDefault = JSON.stringify([rules.hit, rules.pit]) === JSON.stringify([DEFAULT_RULES.hit, DEFAULT_RULES.pit]);
          return (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {btn('SAVE SCORING', () => {
                const ok = typeof globalThis.confirm !== 'function' || globalThis.confirm('Change the scoring? Every saved score, past weeks and seasons included, will be recalculated.');
                if (ok) run('scoring', async () => { const r = await api.setLeagueRules(patch); setScoreEdit({ hit: {}, pit: {} }); setMsg({ ok: true, text: `Scoring saved and all scores recalculated (${r.changed.length} change${r.changed.length === 1 ? '' : 's'}).` }); });
              }, { primary: true, disabled: !dirty })}
              {dirty && btn('DISCARD', () => setScoreEdit({ hit: {}, pit: {} }))}
              {btn('RESET TO DEFAULTS', () => {
                const ok = typeof globalThis.confirm !== 'function' || globalThis.confirm('Put the scoring back to the league’s original values? All saved scores will be recalculated.');
                if (ok) run('scoring', async () => { await api.setLeagueRules({ reset: 'scoring' }); setScoreEdit({ hit: {}, pit: {} }); setMsg({ ok: true, text: 'Scoring reset to the defaults and all scores recalculated.' }); });
              }, { disabled: isDefault && !dirty })}
            </View>
          );
        })()}
      </Card>

      {section('BUILT IN (NOT EDITABLE)')}
      <Card style={{ padding: 14 }}>
        <Body style={{ color: t.dim, fontSize: 12, marginBottom: 8 }}>These shape how the app works and can only be changed in the code.</Body>
        {[
          ['Roster', `${ROSTER_SIZE} players: C, 1B, 2B, 3B, SS, IF, 4 OF, 2 Util, 4 SP, 4 RP and 6 on the bench`],
          ['Season', `${REGULAR_WEEKS} regular-season weeks (a round robin), then the top ${PLAYOFF_TEAMS} teams play the playoffs`],
        ].map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', gap: 10, paddingVertical: 3 }}>
            <Body style={{ width: 70, color: t.dim, fontSize: 13 }}>{k}</Body><Body style={{ flex: 1, fontSize: 13 }}>{v}</Body>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

/** A rule with a number box and − / + buttons; saves when you leave the box or tap a button. */
function NumberRule({ label, hint, unit, step, value, min, max, editable, busy, onSave }: {
  label: string; hint: string; unit: string; step: number; value: number; min: number; max: number; editable: boolean; busy: boolean; onSave: (n: number) => void;
}) {
  const { t } = useTheme();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => { const n = Number(text); if (text.trim() === '' || !Number.isInteger(n)) setText(String(value)); else if (n !== value) onSave(n); };
  const bump = (d: number) => { const n = Math.min(max, Math.max(min, value + d)); if (n !== value) onSave(n); };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderTopWidth: 1, borderTopColor: t.line }}>
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: FONT.bodySemi }}>{label}</Body>
        <Body style={{ color: t.dim, fontSize: 12 }}>{hint}</Body>
      </View>
      {editable && <Pressable disabled={busy || value <= min} onPress={() => bump(-step)} hitSlop={8}><Display style={{ fontSize: 24, color: value <= min ? t.dim2 : t.text }}>−</Display></Pressable>}
      {editable ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.line, borderRadius: t.radius.button, paddingHorizontal: 8, minWidth: 70 }}>
          {!!unit && <Body style={{ color: t.dim }}>{unit}</Body>}
          <TextInput value={text} onChangeText={(v) => setText(v.replace(/[^0-9]/g, ''))} onBlur={commit} onSubmitEditing={commit} keyboardType="number-pad" style={{ color: t.text, fontFamily: FONT.num, fontSize: 18, paddingVertical: 6, minWidth: 40, textAlign: 'right' }} />
        </View>
      ) : <Display style={{ fontSize: 18 }}>{unit}{value}</Display>}
      {editable && <Pressable disabled={busy || value >= max} onPress={() => bump(step)} hitSlop={8}><Display style={{ fontSize: 24, color: value >= max ? t.dim2 : t.text }}>+</Display></Pressable>}
    </View>
  );
}

export default function LeagueSettings() { return <RequireAuth><Settings /></RequireAuth>; }
