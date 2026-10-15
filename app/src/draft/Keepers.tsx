import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, type DraftManager, type KeeperCandidate, type KeeperRow, type KeeperView, type Team } from '../api';
import { TeamAvatar } from '../TeamAvatar';
import { FONT } from '../theme';
import { D } from './tokens';
import { GROUPS, groupOf } from './useDraft';

const posColor = (pos: string) => GROUPS.find((g) => g.key === groupOf({ pos }))!.color;

type Props = {
  season: number; teams: Team[]; managers: DraftManager[]; version: unknown;
  commissioner: boolean; myTeamId: string | null; onError: (m: string) => void;
};

export function Keepers({ season, teams, managers, version, commissioner, myTeamId, onError }: Props) {
  const [view, setView] = useState<KeeperView | null>(null);
  const [teamId, setTeamId] = useState<string>(myTeamId ?? teams[0]?.id ?? '');
  const [avg, setAvg] = useState<Record<number, string>>({});

  const load = useCallback(() => { api.keepers(season).then(setView).catch((e) => onError(e.message)); }, [season]);
  useEffect(load, [load, version]);
  useEffect(() => { if (!teamId && teams[0]) setTeamId(teams[0].id); }, [teams]);

  if (!view) return null;
  const live = view.status === 'live';
  const editable = live && !view.locked && (commissioner || teamId === myTeamId);
  const mine = view.kept.filter((k) => k.teamId === teamId);
  const mgr = managers.find((m) => m.teamId === teamId);
  const spent = mine.reduce((n, k) => n + k.cost, 0);
  const act = (fn: () => Promise<unknown>) => fn().then(load).catch((e) => onError(e instanceof Error ? e.message : 'Failed'));

  const cands = view.candidates.filter((c) => c.teamId === teamId).sort((a, b) => (b.cost ?? b.lastPrice ?? 0) - (a.cost ?? a.lastPrice ?? 0));
  const cols: { title: string; sub: string; tier: 1 | 2 | 0 }[] = [
    { title: 'YEAR 1', sub: 'last price + $5 ($5 if undrafted)', tier: 1 },
    { title: 'YEAR 2', sub: 'ESPN average salary', tier: 2 },
    { title: 'NOT ELIGIBLE', sub: 'kept two years — back to the draft', tier: 0 },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 18 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {teams.map((t) => {
          const n = view.kept.filter((k) => k.teamId === t.id).length;
          const on = t.id === teamId;
          return (
            <Pressable key={t.id} onPress={() => setTeamId(t.id)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: on ? D.panel : D.row, borderWidth: 1, borderColor: on ? D.gold : D.line, borderLeftWidth: 4, borderLeftColor: t.color }}>
              <TeamAvatar id={t.id} color={t.color} logoKey={t.logoKey} size={22} />
              <Text style={{ color: D.text, fontFamily: FONT.bodyBold, fontSize: 13 }}>{t.name}</Text>
              <Text style={{ color: n ? D.green : D.dim2, fontFamily: FONT.num, fontSize: 13 }}>{n}/{view.max}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 22, alignItems: 'center', marginBottom: 6 }}>
        <Stat k="KEPT" v={`${mine.length}/${view.max}`} />
        <Stat k="KEEPER COST" v={`$${spent}`} color={D.gold} />
        {live && <Stat k="MAX BID AFTER" v={`$${mgr?.maxBid ?? 0}`} color={D.green} />}
        <View style={{ flex: 1 }} />
        <Text style={{ color: D.dim, fontFamily: FONT.body, fontSize: 12, maxWidth: 520, textAlign: 'right' }}>
          {!live ? `${season} keepers as recorded — read-only.`
            : view.locked ? 'The auction has started — keepers are locked.'
            : editable ? 'Click a player to keep him; click again to release. Costs come out of the draft budget.'
            : 'You can only edit your own team’s keepers.'}
        </Text>
      </View>

      {!live ? (
        <ArchiveColumns kept={mine} />
      ) : (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
          {cols.map((col) => {
            const list = cands.filter((c) => c.tier === col.tier);
            return (
              <View key={col.tier} style={{ flex: 1 }}>
                <Header title={col.title} sub={col.sub} n={list.length} />
                {list.map((c) => (
                  <CandRow key={c.playerId} c={c} editable={editable} commissioner={commissioner && !view.locked}
                    full={!c.kept && mine.length >= view.max}
                    avg={avg[c.playerId] ?? ''} setAvg={(v) => setAvg((a) => ({ ...a, [c.playerId]: v }))}
                    onToggle={() => act(() => api.setKeeper({ teamId, playerId: c.playerId, kept: !c.kept }))}
                    onValue={() => act(() => api.setValue(c.playerId, Number(avg[c.playerId])))} />
                ))}
                {list.length === 0 && <Text style={{ color: D.dim2, fontFamily: FONT.body, padding: 10 }}>None</Text>}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ k, v, color = D.text }: { k: string; v: string; color?: string }) {
  return (
    <View>
      <Text style={{ color: D.dim2, fontFamily: FONT.bodyBold, fontSize: 10, letterSpacing: 2 }}>{k}</Text>
      <Text style={{ color, fontFamily: FONT.display, fontSize: 28 }}>{v}</Text>
    </View>
  );
}

function Header({ title, sub, n }: { title: string; sub: string; n: number }) {
  return (
    <View style={{ borderBottomColor: D.gold, borderBottomWidth: 2, paddingBottom: 6, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: D.text, fontFamily: FONT.display, fontSize: 18, letterSpacing: 1 }}>{title}</Text>
        <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 12 }}>{n}</Text>
      </View>
      <Text style={{ color: D.dim2, fontFamily: FONT.body, fontSize: 11 }}>{sub}</Text>
    </View>
  );
}

function CandRow({ c, editable, commissioner, full, avg, setAvg, onToggle, onValue }: {
  c: KeeperCandidate; editable: boolean; commissioner: boolean; full: boolean;
  avg: string; setAvg: (v: string) => void; onToggle: () => void; onValue: () => void;
}) {
  const blocked = c.tier === 0;
  const needsValue = c.tier === 2 && c.cost == null;
  const can = editable && !blocked && !needsValue && (c.kept || !full);
  return (
    <Pressable onPress={can ? onToggle : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.kept ? 'rgba(47,191,99,0.14)' : D.row, borderWidth: 1, borderColor: c.kept ? D.green : 'transparent', padding: 10, marginBottom: 5, opacity: blocked ? 0.5 : 1 }}>
      <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: posColor(c.pos) }} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: D.text, fontFamily: FONT.display, fontSize: 20 }}>{c.name}</Text>
        <Text style={{ color: D.dim2, fontFamily: FONT.body, fontSize: 11 }}>
          {c.mlbTeam ?? 'FA'} · {c.positions.join(',')}{c.lastPrice != null ? ` · paid $${c.lastPrice}` : ' · undrafted'}
        </Text>
      </View>
      {needsValue ? (
        commissioner ? (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <TextInput value={avg} onChangeText={setAvg} placeholder="ESPN avg $" placeholderTextColor={D.dim2} keyboardType="decimal-pad"
              style={{ width: 90, color: D.text, backgroundColor: D.bg, padding: 6, fontFamily: FONT.num, fontSize: 13, borderColor: D.line, borderWidth: 1 }} />
            <Pressable onPress={onValue} style={{ backgroundColor: D.red, paddingHorizontal: 10, paddingVertical: 7 }}>
              <Text style={{ color: '#fff', fontFamily: FONT.display, fontSize: 12 }}>SET</Text>
            </Pressable>
          </View>
        ) : <Text style={{ color: D.dim2, fontFamily: FONT.body, fontSize: 11 }}>avg salary not set</Text>
      ) : blocked ? (
        <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 11 }}>back to draft</Text>
      ) : (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: c.kept ? D.green : D.gold, fontFamily: FONT.num, fontSize: 20 }}>${c.cost}</Text>
          {c.kept ? <Text style={{ color: D.green, fontFamily: FONT.bodyBold, fontSize: 10, letterSpacing: 1 }}>KEPT</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

function ArchiveColumns({ kept }: { kept: KeeperRow[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
      {([1, 2] as const).map((y) => {
        const list = kept.filter((k) => k.year === y);
        return (
          <View key={y} style={{ flex: 1 }}>
            <Header title={`YEAR ${y} KEEPERS`} sub={y === 1 ? 'first-year keepers' : 'second and final year'} n={list.length} />
            {list.map((k) => (
              <View key={k.playerId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.row, padding: 10, marginBottom: 5 }}>
                <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: posColor(k.pos) }} />
                <Text numberOfLines={1} style={{ flex: 1, color: D.text, fontFamily: FONT.display, fontSize: 20 }}>{k.name}</Text>
                <Text style={{ color: D.gold, fontFamily: FONT.num, fontSize: 20 }}>${k.cost}</Text>
              </View>
            ))}
            {list.length === 0 && <Text style={{ color: D.dim2, fontFamily: FONT.body, padding: 10 }}>None</Text>}
          </View>
        );
      })}
      <View style={{ flex: 1 }} />
    </View>
  );
}
