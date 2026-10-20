import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ROSTER_LABELS, ROSTER_SIZE } from '@pennant/domain';
import { useTeams } from '../teams';
import { api, type DraftManager, type DraftPlayer, type DraftSale, type Team } from '../api';
import { TeamAvatar } from '../TeamAvatar';
import { FONT } from '../theme';
import { D } from './tokens';
import { GROUPS, groupOf } from './useDraft';

export function Rosters({ teams, managers, roster, highlight }: {
  teams: Team[]; managers: DraftManager[];
  roster: Map<string, { sale: DraftSale; label: string }[]>; highlight: string | null;
}) {
  const { rules } = useTeams();
  const mg = new Map(managers.map((m) => [m.teamId, m]));
  return (
    <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 18 }}>
      {teams.map((t) => {
        const m = mg.get(t.id);
        const byLabel = new Map((roster.get(t.id) ?? []).map((r) => [r.label, r.sale]));
        return (
          <View key={t.id} style={{ width: '15.9%', minWidth: 300, backgroundColor: D.panel, borderWidth: 1, borderColor: t.id === highlight ? D.gold : D.line }}>
            <View style={{ padding: 10, backgroundColor: t.color + '55' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TeamAvatar id={t.id} color={t.color} logoKey={t.logoKey} size={26} />
                <Text numberOfLines={1} style={{ flex: 1, color: D.text, fontFamily: FONT.display, fontSize: 17 }}>{t.name}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ color: D.green, fontFamily: FONT.bodyBold, fontSize: 11 }}>Max ${m?.maxBid ?? 0}</Text>
                <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 11 }}>${m?.remaining ?? rules.budget} left</Text>
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

export function Log({ sales, teams, season, canEdit, onChanged }: {
  sales: DraftSale[]; teams: Team[]; season?: number | null; canEdit?: boolean; onChanged?: () => void;
}) {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const [editing, setEditing] = useState<DraftSale | null>(null);
  return (
    <ScrollView contentContainerStyle={{ padding: 18, maxWidth: 900 }}>
      {canEdit && <Text style={{ color: D.dim, fontFamily: FONT.body, marginBottom: 10 }}>Archived draft: tap EDIT to correct a price, change who drafted a player, or remove a sale.</Text>}
      {[...sales].reverse().map((s) => (
        <View key={s.seq} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: D.row, padding: 10, marginBottom: 5 }}>
          <Text style={{ width: 40, color: D.dim2, fontFamily: FONT.num }}>#{s.seq}</Text>
          <Text style={{ flex: 1, color: D.text, fontFamily: FONT.display, fontSize: 20 }}>{s.name}</Text>
          {s.isKeeper ? <Text style={{ color: D.gold, fontFamily: FONT.bodyBold, fontSize: 11 }}>KEEPER</Text> : null}
          <View style={{ width: 240, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TeamAvatar id={s.teamId} color={byId.get(s.teamId)?.color ?? D.dim2} logoKey={byId.get(s.teamId)?.logoKey} size={24} />
            <Text style={{ flex: 1, color: byId.get(s.teamId)?.color ?? D.dim, fontFamily: FONT.bodyBold }} numberOfLines={1}>{byId.get(s.teamId)?.name ?? s.teamId}</Text>
          </View>
          <Text style={{ width: 60, textAlign: 'right', color: D.green, fontFamily: FONT.num, fontSize: 18 }}>${s.price}</Text>
          {canEdit && (
            <Pressable onPress={() => setEditing(s)} disabled={!!s.isKeeper} style={{ width: 54, opacity: s.isKeeper ? 0.25 : 1 }}>
              <Text style={{ color: D.gold, fontFamily: FONT.bodyBold, fontSize: 12, letterSpacing: 1 }}>EDIT</Text>
            </Pressable>
          )}
        </View>
      ))}
      {sales.length === 0 && <Text style={{ color: D.dim }}>No sales yet.</Text>}
      {editing && season != null && (
        <EditSale sale={editing} season={season} teams={teams} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged?.(); }} />
      )}
    </ScrollView>
  );
}

function EditSale({ sale, season, teams, onClose, onSaved }: {
  sale: DraftSale; season: number; teams: Team[]; onClose: () => void; onSaved: () => void;
}) {
  const [price, setPrice] = useState(String(sale.price));
  const [teamId, setTeamId] = useState(sale.teamId);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('');
    try { await fn(); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); setBusy(false); }
  };
  const save = () => {
    const n = Number(price);
    const b: { price?: number; teamId?: string } = {};
    if (n !== sale.price) b.price = n;
    if (teamId !== sale.teamId) b.teamId = teamId;
    if (!Object.keys(b).length) return onClose();
    run(() => api.editSale(season, sale.playerId, b));
  };
  const remove = () => {
    const ok = typeof globalThis.confirm === 'function' ? globalThis.confirm(`Remove ${sale.name} from the ${season} draft?`) : true;
    if (ok) run(() => api.removeSale(season, sale.playerId));
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
        <Pressable onPress={() => {}} style={{ width: 640, backgroundColor: D.panel, borderColor: D.line, borderWidth: 1, padding: 26 }}>
          <Text style={{ color: D.gold, fontFamily: FONT.bodyBold, letterSpacing: 4, fontSize: 12 }}>EDIT {season} SALE</Text>
          <Text style={{ color: D.text, fontFamily: FONT.display, fontSize: 36, marginBottom: 14 }}>{sale.name}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {teams.map((t) => {
              const on = teamId === t.id;
              return (
                <Pressable key={t.id} onPress={() => setTeamId(t.id)}
                  style={{ width: 190, padding: 8, borderLeftWidth: 4, borderLeftColor: t.color, backgroundColor: on ? 'rgba(226,38,52,0.18)' : D.row, borderWidth: 1, borderColor: on ? D.red : 'transparent' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TeamAvatar id={t.id} color={t.color} logoKey={t.logoKey} size={22} />
                    <Text numberOfLines={1} style={{ flex: 1, color: D.text, fontFamily: FONT.bodyBold, fontSize: 13 }}>{t.name}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, letterSpacing: 1 }}>PRICE $</Text>
            <TextInput value={price} onChangeText={setPrice} keyboardType="number-pad" onSubmitEditing={save}
              style={{ width: 110, color: D.text, backgroundColor: D.row, fontFamily: FONT.num, fontSize: 26, paddingHorizontal: 12, paddingVertical: 6, borderColor: D.line, borderWidth: 1 }} />
            <View style={{ flex: 1 }} />
            <Pressable onPress={remove} disabled={busy}><Text style={{ color: '#ec3b48', fontFamily: FONT.bodyBold, padding: 12 }}>REMOVE SALE</Text></Pressable>
            <Pressable onPress={onClose}><Text style={{ color: D.dim, fontFamily: FONT.bodyBold, padding: 12 }}>CANCEL</Text></Pressable>
            <Pressable onPress={save} disabled={busy} style={{ backgroundColor: D.red, paddingHorizontal: 22, paddingVertical: 12, opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontFamily: FONT.display, fontSize: 18, letterSpacing: 1 }}>SAVE</Text>
            </Pressable>
          </View>
          {!!err && <Text style={{ color: '#ec3b48', fontFamily: FONT.bodyMedium, marginTop: 12 }}>{err}</Text>}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
