import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { validateBid } from '@pennant/domain';
import { api, type DraftManager, type DraftPlayer, type Team } from '../api';
import { FONT } from '../theme';
import { D } from './tokens';

export function Award({ player, managers, teams, onClose, onDone }: {
  player: DraftPlayer; managers: DraftManager[]; teams: Team[]; onClose: () => void; onDone: () => void;
}) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const [bid, setBid] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const open = managers.filter((m) => m.spots > 0);
  const byId = new Map(teams.map((t) => [t.id, t]));

  const submit = async () => {
    const m = managers.find((x) => x.teamId === teamId);
    if (!m) return setErr('Choose the winning manager');
    const price = Number(bid);
    const check = validateBid(price, m.spent, m.filled);
    if (!check.ok) return setErr(check.reason);
    setBusy(true); setErr('');
    try { await api.sell({ playerId: player.id, teamId: m.teamId, price }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not record sale'); setBusy(false); }
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
        <Pressable onPress={() => {}} style={{ width: 640, backgroundColor: D.panel, borderColor: D.line, borderWidth: 1, padding: 26 }}>
          <Text style={{ color: D.gold, fontFamily: FONT.bodyBold, letterSpacing: 4, fontSize: 12 }}>SOLD TO…</Text>
          <Text style={{ color: D.text, fontFamily: FONT.display, fontSize: 40, marginBottom: 2 }}>{player.name}</Text>
          <Text style={{ color: D.dim, fontFamily: FONT.body, marginBottom: 18 }}>{player.mlbTeam ?? 'FA'} · {player.positions.join(',')}</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {open.map((m) => {
              const t = byId.get(m.teamId); const on = teamId === m.teamId;
              return (
                <Pressable key={m.teamId} onPress={() => setTeamId(m.teamId)}
                  style={{ width: 190, padding: 10, borderLeftWidth: 4, borderLeftColor: t?.color ?? D.dim2, backgroundColor: on ? 'rgba(226,38,52,0.18)' : D.row, borderWidth: 1, borderColor: on ? D.red : 'transparent' }}>
                  <Text numberOfLines={1} style={{ color: D.text, fontFamily: FONT.bodyBold, fontSize: 13 }}>{t?.name ?? m.teamId}</Text>
                  <Text style={{ color: D.gold, fontFamily: FONT.num, fontSize: 13 }}>max ${m.maxBid}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, letterSpacing: 1 }}>WINNING BID $</Text>
            <TextInput value={bid} onChangeText={setBid} keyboardType="number-pad" autoFocus onSubmitEditing={submit}
              style={{ width: 120, color: D.text, backgroundColor: D.row, fontFamily: FONT.num, fontSize: 28, paddingHorizontal: 12, paddingVertical: 8, borderColor: D.line, borderWidth: 1 }} />
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}><Text style={{ color: D.dim, fontFamily: FONT.bodyBold, padding: 12 }}>CANCEL</Text></Pressable>
            <Pressable onPress={submit} disabled={busy} style={{ backgroundColor: D.red, paddingHorizontal: 22, paddingVertical: 14, opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontFamily: FONT.display, fontSize: 18, letterSpacing: 1 }}>AWARD</Text>
            </Pressable>
          </View>
          {!!err && <Text style={{ color: '#ec3b48', fontFamily: FONT.bodyMedium, marginTop: 12 }}>{err}</Text>}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
