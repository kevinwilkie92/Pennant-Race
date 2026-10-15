import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, type LeaderRow, type PoolPlayer } from '../../src/api';
import { AddSheet } from '../../src/AddSheet';
import { PlayerCard } from '../../src/PlayerCard';
import { useLeague } from '../../src/useLeague';
import { useAuth } from '../../src/auth';
import { FONT, POS_COLOR, useTheme } from '../../src/theme';
import { Body, Card, Display } from '../../src/ui';

type Sub = 'available' | 'watch' | 'trending' | 'leaders';
const SUBS: { key: Sub; label: string }[] = [
  { key: 'available', label: 'Available' }, { key: 'watch', label: 'Watchlist' }, { key: 'trending', label: 'Trending' }, { key: 'leaders', label: 'Leaders' },
];
const POS = ['ALL', 'C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'];
const colorFor = (pos: string) => (pos === 'SP' ? POS_COLOR.SP : pos === 'RP' ? POS_COLOR.RP : pos === 'OF' ? POS_COLOR.OF : POS_COLOR.IF);

export default function Players() {
  const { t } = useTheme();
  const { me } = useAuth();
  const router = useRouter();
  const [sub, setSub] = useState<Sub>('available');
  const [q, setQ] = useState('');
  const [pos, setPos] = useState('ALL');
  const [sort, setSort] = useState<'name' | 'pos' | 'team'>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [rows, setRows] = useState<PoolPlayer[] | null>(null);
  const [total, setTotal] = useState(0);
  const [adding, setAdding] = useState<PoolPlayer | null>(null);
  const [toast, setToast] = useState('');
  const [cardId, setCardId] = useState<number | null>(null);
  const lg = useLeague();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback((offset = 0) => {
    if (sub === 'trending' || sub === 'leaders') return;
    api.pool({ q, pos, sort, dir, watch: sub === 'watch', all: sub === 'watch', offset }).then((r) => {
      setTotal(r.total);
      setRows((prev) => (offset ? [...(prev ?? []), ...r.players] : r.players));
    }).catch(() => setRows([]));
  }, [sub, q, pos, sort, dir]);

  // Debounce typing in the search box.
  useEffect(() => { setRows(null); clearTimeout(timer.current); timer.current = setTimeout(() => load(0), 250); return () => clearTimeout(timer.current); }, [load]);

  const star = async (p: PoolPlayer) => {
    setRows((r) => (r ? r.map((x) => (x.id === p.id ? { ...x, watched: !x.watched } : x)).filter((x) => sub !== 'watch' || x.watched) : r));
    try { await api.watch(p.id, !p.watched); } catch { load(0); }
  };
  const header = (key: typeof sort, label: string) => (
    <Pressable onPress={() => { if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('asc'); } }}>
      <Body style={{ color: sort === key ? t.text : t.dim, fontFamily: FONT.displayBold, fontSize: 11 }}>{label}{sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</Body>
    </Pressable>
  );
  const needsFeed = sub === 'trending' || sub === 'leaders';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
          {SUBS.map((s) => {
            const on = sub === s.key;
            return (
              <Pressable key={s.key} onPress={() => setSub(s.key)}
                style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
                <Display style={{ fontSize: 12.5, color: on ? '#fff' : t.dim }}>{s.label}</Display>
              </Pressable>
            );
          })}
        </View>

        {needsFeed ? (
          <Leaders sub={sub as 'trending' | 'leaders'} onCard={setCardId} onAdd={setAdding} myTeam={me?.user.teamId ?? null} />
        ) : (
          <>
            <TextInput value={q} onChangeText={setQ} placeholder="Search players" placeholderTextColor={t.dim2} autoCapitalize="none"
              style={{ color: t.text, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONT.body, marginBottom: 10 }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {POS.map((p) => {
                const on = pos === p;
                return (
                  <Pressable key={p} onPress={() => setPos(p)}
                    style={{ paddingHorizontal: 13, paddingVertical: 6, marginRight: 6, borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
                    <Display style={{ fontSize: 12.5, color: on ? '#fff' : t.dim }}>{p}</Display>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 6 }}>
              {header('name', 'PLAYER')}
              <View style={{ flexDirection: 'row', gap: 16 }}>{header('pos', 'POS')}{header('team', 'TEAM')}</View>
            </View>

            {!rows ? <ActivityIndicator color={t.red} /> : rows.length === 0 ? (
              <Body style={{ color: t.dim, padding: 20, textAlign: 'center' }}>
                {sub === 'watch' ? 'No players on your watchlist yet. Tap ☆ on any player.' : 'No players match.'}
              </Body>
            ) : (
              <Card style={{ overflow: 'hidden' }}>
                {rows.map((p, i) => (
                  <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                    <Pressable onPress={() => star(p)} hitSlop={10}>
                      <Body style={{ fontSize: 20, color: p.watched ? t.gold : t.dim2 }}>{p.watched ? '★' : '☆'}</Body>
                    </Pressable>
                    <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: colorFor(p.positions[0] ?? p.pos), borderRadius: 2 }} />
                    <Pressable style={{ flex: 1 }} onPress={() => setCardId(p.id)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Body numberOfLines={1} style={{ fontFamily: FONT.bodyBold, fontSize: 15, flexShrink: 1 }}>{p.name}</Body>
                        {p.injury && <Body style={{ backgroundColor: p.injury === 'DTD' ? '#d19a1f' : '#ec3b48', color: '#fff', fontFamily: FONT.bodyBold, fontSize: 10, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' }}>{p.injury}</Body>}
                      </View>
                      <Body style={{ color: t.dim, fontSize: 12 }}>{p.mlbTeam ?? 'FA'} · {p.positions.join(',')}</Body>
                      {p.waiversUntil && <Body style={{ color: t.gold, fontSize: 11, fontFamily: FONT.bodySemi }}>On waivers until {p.waiversUntil}</Body>}
                    </Pressable>
                    {p.ownerId ? (
                      p.ownerId === me?.user.teamId ? <Body style={{ color: t.dim, fontSize: 11, fontFamily: FONT.bodyBold }}>YOURS</Body> : (
                        <Pressable onPress={() => router.push({ pathname: '/trade', params: { team: p.ownerId!, player: String(p.id) } })}
                          style={{ borderColor: t.red, borderWidth: 1, borderRadius: t.radius.chip, paddingHorizontal: 10, paddingVertical: 6 }}>
                          <Display style={{ fontSize: 12, color: t.red }}>TRADE · {p.ownerId}</Display>
                        </Pressable>
                      )
                    ) : (
                      <Pressable onPress={() => setAdding(p)} style={{ backgroundColor: t.red, borderRadius: t.radius.chip, paddingHorizontal: 12, paddingVertical: 7 }}>
                        <Display style={{ fontSize: 13, color: '#fff' }}>+ ADD</Display>
                      </Pressable>
                    )}
                  </View>
                ))}
              </Card>
            )}
            {rows && rows.length < total && (
              <Pressable onPress={() => load(rows.length)} style={{ alignItems: 'center', padding: 14 }}>
                <Body style={{ color: t.red, fontFamily: FONT.bodyBold }}>Show more ({total - rows.length} left)</Body>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>

      {!!toast && (
        <Pressable onPress={() => setToast('')} style={{ position: 'absolute', left: 16, right: 16, bottom: 12, backgroundColor: t.panel, borderColor: t.green, borderWidth: 1, borderRadius: t.radius.button, padding: 12 }}>
          <Body style={{ color: t.text, fontSize: 13 }}>{toast}</Body>
        </Pressable>
      )}
      <PlayerCard playerId={cardId} teamName={(id) => lg.byId.get(id)?.name ?? id} onClose={() => setCardId(null)} />
      <AddSheet player={adding} teamId={me?.user.teamId ?? null} onClose={() => setAdding(null)}
        onDone={(m) => { setAdding(null); setToast(m); setTimeout(() => setToast(''), 5000); }} />
    </View>
  );
}


const WINDOWS = [{ k: '7', label: '7 days' }, { k: '14', label: '14 days' }, { k: '30', label: '30 days' }, { k: 'season', label: 'Season' }];

/** Trending = the last 7 days; Leaders = pick a window. Points are our league's scoring, from the MLB feed. */
function Leaders({ sub, onCard, onAdd, myTeam }: { sub: 'trending' | 'leaders'; onCard: (id: number) => void; onAdd: (p: PoolPlayer) => void; myTeam: string | null }) {
  const { t } = useTheme();
  const [win, setWin] = useState('season');
  const [role, setRole] = useState<'ALL' | 'H' | 'P'>('ALL');
  const [free, setFree] = useState(false);
  const [data, setData] = useState<{ season: number | null; through?: string; players: LeaderRow[] } | null>(null);
  const window = sub === 'trending' ? '7' : win;
  useEffect(() => {
    setData(null);
    api.leaders({ window, role: role === 'ALL' ? undefined : role, free }).then(setData).catch(() => setData({ season: null, players: [] }));
  }, [window, role, free]);
  const chip = (on: boolean, label: string, press: () => void) => (
    <Pressable key={label} onPress={press} style={{ paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
      <Display style={{ fontSize: 12.5, color: on ? '#fff' : t.dim }}>{label}</Display>
    </Pressable>
  );
  return (
    <>
      <Display style={{ fontSize: 20, marginBottom: 2 }}>{sub === 'trending' ? 'Hot this week' : 'Leaders'}</Display>
      <Body style={{ color: t.dim, fontSize: 12, marginBottom: 10 }}>
        Fantasy points{data?.through ? ` through ${data.through}` : ''}{data?.season ? ` · ${data.season} season` : ''}
      </Body>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {sub === 'leaders' && WINDOWS.map((w) => chip(win === w.k, w.label, () => setWin(w.k)))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        {chip(role === 'ALL', 'All', () => setRole('ALL'))}{chip(role === 'H', 'Hitters', () => setRole('H'))}{chip(role === 'P', 'Pitchers', () => setRole('P'))}
        {chip(free, 'Available only', () => setFree(!free))}
      </ScrollView>
      {!data ? <ActivityIndicator color={t.red} /> : data.players.length === 0 ? (
        <Body style={{ color: t.dim, padding: 20, textAlign: 'center' }}>{data.season == null ? 'No scored games yet. Scores appear once the MLB feed has pulled some games.' : 'No players match.'}</Body>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          {data.players.map((p, i) => (
            <View key={`${p.id}${p.role}`} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
              <Body style={{ width: 22, color: t.dim2, fontFamily: FONT.bodyBold }}>{i + 1}</Body>
              <Pressable style={{ flex: 1 }} onPress={() => onCard(p.id)}>
                <Body numberOfLines={1} style={{ fontFamily: FONT.bodyBold, fontSize: 15 }}>{p.name}</Body>
                <Body style={{ color: t.dim, fontSize: 12 }}>{p.mlbTeam ?? 'FA'} · {p.positions.join(',')} · {p.games} G</Body>
              </Pressable>
              <Display style={{ fontSize: 18, width: 54, textAlign: 'right' }}>{p.points}</Display>
              {p.ownerId ? <Body style={{ width: 46, textAlign: 'right', color: p.ownerId === myTeam ? t.gold : t.dim, fontFamily: FONT.bodyBold, fontSize: 11 }}>{p.ownerId === myTeam ? 'YOURS' : p.ownerId}</Body> : (
                <Pressable onPress={() => onAdd({ id: p.id, name: p.name, mlbTeam: p.mlbTeam, pos: p.pos, positions: p.positions, ownerId: null, watched: false })} style={{ backgroundColor: t.red, borderRadius: t.radius.chip, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Display style={{ fontSize: 12, color: '#fff' }}>+ ADD</Display>
                </Pressable>
              )}
            </View>
          ))}
        </Card>
      )}
    </>
  );
}
