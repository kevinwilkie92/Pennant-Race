import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type FeedStatus } from '../src/api';
import { useAuth } from '../src/auth';
import { RequireAuth } from '../src/RequireAuth';
import { FONT, useTheme } from '../src/theme';
import { Body, Card, Display } from '../src/ui';

const addDays = (d: string, k: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + k)).toISOString().slice(0, 10);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Commissioner tools for the MLB stats feed: match players, pull games (any date range), refresh injuries/positions. */
function Feed() {
  const { me } = useAuth();
  const { t } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [unmapped, setUnmapped] = useState<{ id: number; name: string; mlbTeam: string | null; pos: string; drafted: number }[]>([]);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [from, setFrom] = useState(addDays(today(), -7));
  const [to, setTo] = useState(today());
  const [ids, setIds] = useState<Record<number, string>>({});

  const reload = useCallback(async () => {
    setStatus(await api.feedStatus().catch(() => null));
    setUnmapped(await api.feedUnmapped().catch(() => []));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  if (!me?.user.isCommissioner) return <Body style={{ padding: 20, color: t.dim }}>Commissioner only.</Body>;

  const say = (m: string) => setLog((l) => [m, ...l].slice(0, 12));
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e) { say(`✗ ${e instanceof Error ? e.message : 'Failed'}`); }
    setBusy(''); await reload();
  };

  const match = () => run('match', async () => {
    let r = await api.feedMap('players'); say(`Active players: ${r.matched} matched, ${r.remaining} left`);
    let from = 0;
    do { r = await api.feedMap('rosters', from); from = r.next ?? 0; say(`40-man rosters: ${r.matched} more, ${r.remaining} left`); } while (r.next != null);
    let at = 0;
    do { r = await api.feedMap('search', at); at = r.next ?? 0; say(`Name search: ${r.matched} more, ${r.remaining} left`); } while (r.next != null);
    say(`Done. ${r.remaining} still need an id (below).`);
  });

  // Games are pulled up to a week at a time so no single request runs long.
  const pull = () => run('sync', async () => {
    if (to < from) throw new Error('"To" must not be before "From"');
    let d = from, games = 0, rows = 0;
    while (d <= to) {
      const end = addDays(d, 6) < to ? addDays(d, 6) : to;
      const r = await api.feedSync(d, end);
      for (const x of r.results) { games += x.fetched; rows += x.rows; }
      say(`${d} → ${end}: ${r.results.reduce((n, x) => n + x.fetched, 0)} games`);
      d = addDays(end, 1);
    }
    say(`Done. ${games} games, ${rows} player lines.`);
  });

  const refresh = () => run('refresh', async () => {
    const r = await api.feedRefresh();
    say(`Injured list: ${r.injuries.set} on the IL, ${r.injuries.cleared} active. New positions earned: ${r.eligibility.added}`);
  });

  const btn = (label: string, name: string, press: () => void, primary = true) => (
    <Pressable onPress={press} disabled={!!busy} style={{ backgroundColor: primary ? t.red : 'transparent', borderColor: primary ? t.red : t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 16, paddingVertical: 11, opacity: busy ? 0.6 : 1 }}>
      {busy === name ? <ActivityIndicator color="#fff" /> : <Display style={{ fontSize: 14, color: primary ? '#fff' : t.text }}>{label}</Display>}
    </Pressable>
  );
  const field = { color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 12, paddingVertical: 9, fontFamily: FONT.body, width: 130 } as const;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()}><Body style={{ color: t.red, marginBottom: 8 }}>‹ Back</Body></Pressable>
      <Display style={{ fontSize: 26, marginBottom: 12 }}>MLB stats feed</Display>

      <Card style={{ padding: 14, marginBottom: 12 }}>
        {status ? (
          <>
            <Body>{status.mapped} of {status.total} players matched to MLB · {status.finalGames} games scored{status.lastGameDate ? ` (latest ${status.lastGameDate})` : ''}</Body>
            <Body style={{ color: t.dim, fontSize: 12, marginTop: 4 }}>
              The feed updates itself every 10 minutes during games, settles yesterday at about 3-4am Eastern, and refreshes injuries and positions daily.
              {status.lastSync ? ` Last run covered ${status.lastSync.value.date}.` : ''}
            </Body>
            {status.lastError && <Body style={{ color: t.loss, fontSize: 12, marginTop: 4 }}>Last error ({status.lastError.value.date}): {status.lastError.value.message}</Body>}
          </>
        ) : <ActivityIndicator color={t.red} />}
      </Card>

      <Card style={{ padding: 14, marginBottom: 12 }}>
        <Display style={{ fontSize: 17 }}>1 · Match players</Display>
        <Body style={{ color: t.dim, fontSize: 12, marginVertical: 6 }}>Pairs our players with MLB's ids by name and team. Safe to run again; only unmatched players are looked at.</Body>
        {btn('MATCH PLAYERS', 'match', match)}
      </Card>

      <Card style={{ padding: 14, marginBottom: 12 }}>
        <Display style={{ fontSize: 17 }}>2 · Pull games</Display>
        <Body style={{ color: t.dim, fontSize: 12, marginVertical: 6 }}>Scores games and credits each team's lineup as it stood that day. Use a wide range to backfill a season.</Body>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <Body style={{ color: t.dim }}>From</Body><TextInput value={from} onChangeText={setFrom} autoCapitalize="none" style={field} />
          <Body style={{ color: t.dim }}>to</Body><TextInput value={to} onChangeText={setTo} autoCapitalize="none" style={field} />
        </View>
        {btn('PULL GAMES', 'sync', pull)}
      </Card>

      <Card style={{ padding: 14, marginBottom: 12 }}>
        <Display style={{ fontSize: 17 }}>3 · Injuries and positions</Display>
        <Body style={{ color: t.dim, fontSize: 12, marginVertical: 6 }}>Mirrors MLB's injured list (your own manual statuses are never changed) and awards positions earned in games.</Body>
        {btn('REFRESH NOW', 'refresh', refresh, false)}
      </Card>

      {log.length > 0 && (
        <Card style={{ padding: 12, marginBottom: 12 }}>
          {log.map((l, i) => <Body key={i} style={{ fontSize: 12, color: l.startsWith('✗') ? t.loss : i ? t.dim : t.text }}>{l}</Body>)}
        </Card>
      )}

      {unmapped.length > 0 && (
        <Card style={{ overflow: 'hidden' }}>
          <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, padding: 12, paddingBottom: 6 }}>NO MLB ID YET ({unmapped.length}) · drafted players first</Body>
          {unmapped.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.line }}>
              <Body style={{ flex: 1, fontSize: 13 }} numberOfLines={1}>{p.name}{p.drafted ? ' ★' : ''} <Body style={{ color: t.dim, fontSize: 11 }}>{p.mlbTeam ?? 'FA'} · {p.pos}</Body></Body>
              <TextInput value={ids[p.id] ?? ''} onChangeText={(v) => setIds((m) => ({ ...m, [p.id]: v.replace(/\D/g, '') }))} placeholder="MLB id" placeholderTextColor={t.dim2} keyboardType="number-pad" style={[field, { width: 100, paddingVertical: 5 }]} />
              <Pressable disabled={!ids[p.id]} onPress={() => run(`id${p.id}`, async () => { await api.feedSetMlbId(p.id, Number(ids[p.id])); say(`Saved id for ${p.name}`); })}>
                <Body style={{ color: ids[p.id] ? t.red : t.dim2, fontFamily: FONT.bodyBold }}>SAVE</Body>
              </Pressable>
            </View>
          ))}
          <Body style={{ color: t.dim2, fontSize: 11, padding: 12 }}>Find an id at mlb.com: it is the number at the end of a player's page address.</Body>
        </Card>
      )}
    </ScrollView>
  );
}

export default function StatsFeed() { return <RequireAuth><Feed /></RequireAuth>; }
