import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from 'react-native';
import type { DraftPlayer, DraftSale, MlbTeam, Team } from '../api';
import { FONT } from '../theme';
import { GROUPS, groupOf, type Group } from './useDraft';
import { D, abbr } from './tokens';

const grad = (a: string, b: string): ViewStyle =>
  ({ experimental_backgroundImage: `linear-gradient(135deg, ${a}, ${b})`, backgroundColor: a }) as ViewStyle;

type Props = {
  mlb: MlbTeam[]; players: DraftPlayer[]; teams: Team[];
  sale: Map<number, DraftSale>;
  current: string | null;                     // drawn / browsed MLB team abbr
  isLive: boolean; commissioner: boolean; season: number | null;
  onSelect: (abbr: string | null) => void;    // pick a team (hat draw when live)
  onDraft: (p: DraftPlayer) => void;
};

export function Board({ mlb, players, teams, sale, current, isLive, commissioner, season, onSelect, onDraft }: Props) {
  const [filter, setFilter] = useState('');
  const [pick, setPick] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const team = mlb.find((m) => m.abbr === current) ?? null;
  const byTeam = useMemo(() => players.filter((p) => p.mlbTeam === current), [players, current]);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const primary = team?.color ?? '#1c212b';
  // Pirates swap primary/secondary in 2026 (README); glow stays black for them.
  const [c1, c2] = team?.abbr === 'PIT' && season === 2026 ? [team.color2 ?? primary, primary] : [primary, team?.color2 ?? primary];

  const withLeft = mlb.filter((m) => players.some((p) => p.mlbTeam === m.abbr && !sale.has(p.id)));
  const draw = (to: string | null) => { if (current) setHistory((h) => [...h, current]); onSelect(to); };
  const next = () => {
    const pool = withLeft.filter((m) => m.abbr !== current);
    if (pool.length) draw(pool[Math.floor(Math.random() * pool.length)].abbr);
  };
  const prev = () => { const h = [...history]; const p = h.pop(); if (p) { setHistory(h); onSelect(p); } };

  const sold = byTeam.filter((p) => sale.has(p.id)).length;
  const q = filter.trim().toLowerCase();
  const cols = GROUPS.map((g) => ({
    ...g,
    list: byTeam.filter((p) => groupOf(p) === g.key && (!q || p.name.toLowerCase().includes(q))),
  }));

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {/* Left rail */}
      <View style={[{ width: 118, alignItems: 'center', paddingTop: 22, justifyContent: 'space-between' }, grad(c1, c2)]}>
        <View style={{ alignItems: 'center' }}>
          {team?.logo ? <Image source={{ uri: team.logo }} style={{ width: 56, height: 56, resizeMode: 'contain' }} /> : null}
        </View>
        {/* Team nickname set vertically, centred in the rail. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ width: 640, textAlign: 'center', fontFamily: FONT.display, color: '#fff', fontSize: 56, transform: [{ rotate: '-90deg' }] }}>
            {(team?.name.split(' ').slice(-1)[0] ?? '').toUpperCase()}
          </Text>
        </View>
        <View style={{ alignSelf: 'stretch' }}>
          {[['SOLD', String(sold), D.gold], ['LEFT', String(byTeam.length - sold), '#fff'], ['TEAM', team ? `${mlb.findIndex((m) => m.abbr === team.abbr) + 1}/${mlb.length}` : '–', '#fff']].map(([k, v, c]) => (
            <View key={k} style={{ alignItems: 'center', paddingVertical: 10, borderTopColor: 'rgba(255,255,255,0.25)', borderTopWidth: 1, marginHorizontal: 18 }}>
              <Text style={{ fontFamily: FONT.bodyBold, color: 'rgba(255,255,255,0.7)', fontSize: 10, letterSpacing: 2 }}>{k}</Text>
              <Text style={{ fontFamily: FONT.display, color: c, fontSize: 26 }}>{v}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {/* Hero */}
        <View style={[{ minHeight: 240, flexDirection: 'row', padding: 28, alignItems: 'flex-end' }, grad(c1, c2)]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: D.gold, fontFamily: FONT.bodyBold, fontSize: 13, letterSpacing: 5 }}>
              {isLive ? 'ON THE CLOCK · DRAWN FROM THE HAT' : `${season} FINAL RESULTS`}
            </Text>
            <Text style={{ color: '#fff', fontFamily: FONT.display, fontSize: 72, lineHeight: 78 }} numberOfLines={1}>
              {team?.name ?? (isLive ? 'Draw a team' : 'Pick a team')}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: FONT.body, fontSize: 16 }}>
              {isLive
                ? commissioner ? 'Click Draft on any player below to put them up for auction.' : 'The commissioner is running the draft.'
                : 'Browse every MLB team’s final draft results.'}
            </Text>
          </View>
          {(commissioner || !isLive) && (
            <View style={{ width: 250, gap: 8 }}>
              <Pressable onPress={() => setPick(true)} style={{ backgroundColor: 'rgba(0,0,0,0.45)', padding: 11, borderColor: D.line, borderWidth: 1 }}>
                <Text style={{ color: '#fff', fontFamily: FONT.bodyBold }}>{team?.name ?? 'Select MLB team'}  ▾</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={prev} style={{ width: 56, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 18 }}>‹</Text></Pressable>
                <Pressable onPress={next} style={{ flex: 1, backgroundColor: D.red, padding: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontFamily: FONT.display, letterSpacing: 1.5, fontSize: 16 }}>NEXT TEAM ›</Text>
                </Pressable>
              </View>
              {isLive && (
                <Pressable onPress={next} style={{ backgroundColor: 'rgba(0,0,0,0.45)', padding: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontFamily: FONT.bodyBold, letterSpacing: 1.5, fontSize: 12 }}>SHUFFLE HAT</Text>
                </Pressable>
              )}
              <TextInput value={filter} onChangeText={setFilter} placeholder="Filter players…" placeholderTextColor="rgba(255,255,255,0.45)"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', padding: 10, fontFamily: FONT.body, borderColor: D.line, borderWidth: 1 }} />
            </View>
          )}
        </View>

        {/* Position columns */}
        <ScrollView style={{ backgroundColor: D.bg }} contentContainerStyle={{ flexDirection: 'row', gap: 12, padding: 18 }}>
          {cols.map((c) => (
            <View key={c.key} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: c.color, borderBottomWidth: 2, paddingBottom: 6, marginBottom: 8 }}>
                <View style={{ backgroundColor: c.color, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: '#0b0d11', fontFamily: FONT.display, fontSize: 13 }}>{c.label}</Text>
                </View>
                <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 12, letterSpacing: 1 }}>{c.list.filter((p) => !sale.has(p.id)).length} LEFT</Text>
              </View>
              {c.list.map((p) => <Row key={p.id} p={p} color={c.color} s={sale.get(p.id)} teamById={teamById} canDraft={isLive && commissioner} onDraft={onDraft} />)}
            </View>
          ))}
        </ScrollView>
      </View>

      <Modal transparent visible={pick} animationType="fade" onRequestClose={() => setPick(false)}>
        <Pressable onPress={() => setPick(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 520, maxHeight: '80%', backgroundColor: D.panel, borderColor: D.line, borderWidth: 1 }}>
            <ScrollView>
              {mlb.map((m) => (
                <Pressable key={m.abbr} onPress={() => { setPick(false); draw(m.abbr); }} style={{ padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center', borderBottomColor: D.line, borderBottomWidth: 1 }}>
                  <View style={{ width: 8, height: 24, backgroundColor: m.color ?? D.dim2 }} />
                  <Text style={{ color: D.text, fontFamily: FONT.bodyBold, flex: 1 }}>{m.name}</Text>
                  <Text style={{ color: D.dim2, fontFamily: FONT.num }}>{players.filter((p) => p.mlbTeam === m.abbr && !sale.has(p.id)).length} left</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Row({ p, color, s, teamById, canDraft, onDraft }: {
  p: DraftPlayer; color: string; s?: DraftSale; teamById: Map<string, Team>; canDraft: boolean; onDraft: (p: DraftPlayer) => void;
}) {
  const w = s ? teamById.get(s.teamId) : undefined;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: s ? D.sold : D.row, padding: 10, marginBottom: 6, gap: 12, opacity: s ? 0.75 : 1, minHeight: 66 }}>
      <View style={{ width: 36, height: 36, borderWidth: 2, borderColor: color, backgroundColor: 'rgba(255,255,255,0.05)', opacity: s ? 0.5 : 1 }} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT.display, fontSize: 25, color: s ? D.dim2 : D.text }}>{p.name}</Text>
        <Text style={{ fontFamily: FONT.body, fontSize: 11, color: D.dim2 }}>
          {p.positions.join(',')} · {s ? `SOLD → ${abbr(s.teamId)}` : 'Available'}
        </Text>
      </View>
      {s ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: FONT.num, fontSize: 17, color: D.green }}>${s.price}</Text>
          <Text style={{ fontFamily: FONT.bodyBold, fontSize: 10, color: w?.color ?? D.dim }}>{abbr(s.teamId)}</Text>
        </View>
      ) : canDraft ? (
        <Pressable onPress={() => onDraft(p)} style={{ backgroundColor: D.red, paddingHorizontal: 16, paddingVertical: 9 }}>
          <Text style={{ color: '#fff', fontFamily: FONT.display, fontSize: 14, letterSpacing: 1.5 }}>DRAFT</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
