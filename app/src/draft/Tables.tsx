import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { BUDGET, ROSTER_LABELS, ROSTER_SIZE } from '@pennant/domain';
import type { DraftManager, DraftPlayer, DraftSale, Team } from '../api';
import { FONT } from '../theme';
import { D } from './tokens';
import { GROUPS, groupOf } from './useDraft';

export function Rosters({ teams, managers, roster, highlight }: {
  teams: Team[]; managers: DraftManager[];
  roster: Map<string, { sale: DraftSale; label: string }[]>; highlight: string | null;
}) {
  const mg = new Map(managers.map((m) => [m.teamId, m]));
  return (
    <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 18 }}>
      {teams.map((t) => {
        const m = mg.get(t.id);
        const byLabel = new Map((roster.get(t.id) ?? []).map((r) => [r.label, r.sale]));
        return (
          <View key={t.id} style={{ width: '15.9%', minWidth: 300, backgroundColor: D.panel, borderWidth: 1, borderColor: t.id === highlight ? D.gold : D.line }}>
            <View style={{ padding: 10, backgroundColor: t.color + '55' }}>
              <Text numberOfLines={1} style={{ color: D.text, fontFamily: FONT.display, fontSize: 17 }}>{t.name}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ color: D.green, fontFamily: FONT.bodyBold, fontSize: 11 }}>Max ${m?.maxBid ?? 0}</Text>
                <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 11 }}>${m?.remaining ?? BUDGET} left</Text>
                <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 11 }}>{m?.filled ?? 0}/{ROSTER_SIZE}</Text>
              </View>
            </View>
            {ROSTER_LABELS.map((label) => {
              const s = byLabel.get(label);
              return (
                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, gap: 8, borderTopColor: D.line, borderTopWidth: 1 }}>
                  <Text style={{ width: 34, color: '#e0607a', fontFamily: FONT.num, fontSize: 10 }}>{label}</Text>
                  <Text numberOfLines={1} style={{ flex: 1, color: s ? D.text : D.dim2, fontFamily: FONT.bodyMedium, fontSize: 12 }}>{s?.name ?? '—'}</Text>
                  {s?.keeperYear ? (
                    <Text style={{ backgroundColor: s.keeperYear === 1 ? '#2e9e5b' : '#d19a1f', color: '#fff', fontFamily: FONT.bodyBold, fontSize: 9, paddingHorizontal: 4, paddingVertical: 1 }}>Y{s.keeperYear}</Text>
                  ) : null}
                  {s ? <Text style={{ color: D.green, fontFamily: FONT.num, fontSize: 12 }}>${s.price}</Text> : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

export function Undrafted({ players, sale }: { players: DraftPlayer[]; sale: Map<number, DraftSale> }) {
  const [q, setQ] = useState('');
  const left = players.filter((p) => !sale.has(p.id) && p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <ScrollView contentContainerStyle={{ padding: 18 }}>
      <TextInput value={q} onChangeText={setQ} placeholder="Filter players…" placeholderTextColor={D.dim2}
        style={{ width: 320, backgroundColor: D.row, color: D.text, padding: 10, fontFamily: FONT.body, marginBottom: 14, borderColor: D.line, borderWidth: 1 }} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {GROUPS.map((g) => {
          const list = left.filter((p) => groupOf(p) === g.key);
          return (
            <View key={g.key} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomColor: g.color, borderBottomWidth: 2, paddingBottom: 6, marginBottom: 6 }}>
                <Text style={{ color: g.color, fontFamily: FONT.display, fontSize: 16 }}>{g.label}</Text>
                <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 12 }}>{list.length} LEFT</Text>
              </View>
              {list.map((p) => (
                <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomColor: D.line, borderBottomWidth: 1 }}>
                  <Text numberOfLines={1} style={{ flex: 1, color: D.text, fontFamily: FONT.bodyMedium, fontSize: 13 }}>{p.name}</Text>
                  <Text style={{ color: D.dim2, fontFamily: FONT.body, fontSize: 11 }}>{p.mlbTeam ?? 'FA'}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function Log({ sales, teams }: { sales: DraftSale[]; teams: Team[] }) {
  const byId = new Map(teams.map((t) => [t.id, t]));
  return (
    <ScrollView contentContainerStyle={{ padding: 18, maxWidth: 900 }}>
      {[...sales].reverse().map((s) => (
        <View key={s.seq} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: D.row, padding: 10, marginBottom: 5 }}>
          <Text style={{ width: 40, color: D.dim2, fontFamily: FONT.num }}>#{s.seq}</Text>
          <Text style={{ flex: 1, color: D.text, fontFamily: FONT.display, fontSize: 20 }}>{s.name}</Text>
          {s.isKeeper ? <Text style={{ color: D.gold, fontFamily: FONT.bodyBold, fontSize: 11 }}>KEEPER</Text> : null}
          <Text style={{ width: 220, color: byId.get(s.teamId)?.color ?? D.dim, fontFamily: FONT.bodyBold }} numberOfLines={1}>{byId.get(s.teamId)?.name ?? s.teamId}</Text>
          <Text style={{ width: 60, textAlign: 'right', color: D.green, fontFamily: FONT.num, fontSize: 18 }}>${s.price}</Text>
        </View>
      ))}
      {sales.length === 0 && <Text style={{ color: D.dim }}>No sales yet.</Text>}
    </ScrollView>
  );
}
