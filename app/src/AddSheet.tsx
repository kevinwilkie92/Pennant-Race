import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { rosterSizeOf } from '@pennant/domain';
import { useTeams } from './teams';
import { api, type LineupSlot, type PoolPlayer } from './api';
import { FONT, useTheme } from './theme';
import { Body, Display } from './ui';

/** Add a free agent: a FAAB waiver claim, optionally dropping someone (required when the roster is full). */
export function AddSheet({ player, teamId, onClose, onDone }: {
  player: PoolPlayer | null; teamId: string | null; onClose: () => void; onDone: (msg: string) => void;
}) {
  const { t } = useTheme();
  const [faab, setFaab] = useState<number | null>(null);
  const { rules } = useTeams();
  const ROSTER_SIZE = rosterSizeOf(rules.roster);
  const [roster, setRoster] = useState<LineupSlot[]>([]);
  const [bid, setBid] = useState('0');
  const [drop, setDrop] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!player || !teamId) return;
    setBid('0'); setDrop(null); setErr('');
    api.claims().then((c) => setFaab(c.faab)).catch(() => {});
    api.lineup(teamId).then((l) => setRoster(l.slots)).catch(() => {});
  }, [player?.id, teamId]);

  if (!player) return null;
  const full = roster.length >= ROSTER_SIZE;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api.createClaim({ addPlayerId: player.id, dropPlayerId: drop, bid: Number(bid) });
      onDone(`Claim submitted for ${player.name}. It's processed at the next waiver run.`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not submit claim'); setBusy(false); }
  };
  void Alert; void Platform;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '88%', backgroundColor: t.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderColor: t.line, borderWidth: 1, paddingBottom: 24 }}>
          <View style={{ padding: 16, paddingBottom: 8 }}>
            <Display style={{ fontSize: 24 }}>{player.name}</Display>
            <Body style={{ color: t.dim, fontSize: 12 }}>{player.mlbTeam ?? 'FA'} · {player.positions.join(',')}</Body>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
            <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, marginTop: 6 }}>FAAB BID</Body>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 }}>
              <Display style={{ fontSize: 26, color: t.green }}>$</Display>
              <TextInput value={bid} onChangeText={(v) => setBid(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad"
                style={{ width: 110, color: t.text, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button, paddingHorizontal: 12, paddingVertical: 8, fontFamily: FONT.num, fontSize: 24 }} />
              <Body style={{ color: t.dim, fontSize: 12 }}>{faab == null ? '' : `of $${faab} left`}</Body>
            </View>
            <Body style={{ color: t.dim2, fontSize: 11, marginBottom: 10 }}>Highest bid wins. Ties go to the team first in the waiver order. $0 is allowed.</Body>
            {player.waiversUntil && <Body style={{ color: t.gold, fontSize: 12, marginBottom: 10 }}>He was just dropped and is on waivers until {player.waiversUntil}. Your claim waits and is processed on or after that date.</Body>}

            <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1, marginTop: 4 }}>
              {full ? 'DROP (REQUIRED — ROSTER FULL)' : 'DROP (OPTIONAL)'}
            </Body>
            {!full && (
              <Pressable onPress={() => setDrop(null)} style={{ paddingVertical: 10, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Body style={{ color: drop == null ? t.red : t.dim, fontSize: 16 }}>{drop == null ? '●' : '○'}</Body>
                <Body>Nobody — I have an open spot</Body>
              </Pressable>
            )}
            {roster.map((r) => (
              <Pressable key={r.playerId} onPress={() => setDrop(r.playerId)} style={{ paddingVertical: 9, flexDirection: 'row', gap: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.line }}>
                <Body style={{ color: drop === r.playerId ? t.red : t.dim, fontSize: 16 }}>{drop === r.playerId ? '●' : '○'}</Body>
                <Body style={{ flex: 1, fontFamily: FONT.bodySemi }} numberOfLines={1}>{r.name}</Body>
                <Body style={{ color: t.dim, fontSize: 11 }}>{r.slot.replace(/^B\d$/, 'BN')} · {r.positions.join(',')}</Body>
              </Pressable>
            ))}
            {!!err && <Body style={{ color: t.loss, fontFamily: FONT.bodyMedium, marginTop: 10 }}>{err}</Body>}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 4 }}>
            <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: t.radius.button, borderWidth: 1, borderColor: t.line }}>
              <Display style={{ fontSize: 15, color: t.dim }}>CANCEL</Display>
            </Pressable>
            <Pressable onPress={submit} disabled={busy || (full && drop == null)}
              style={{ flex: 2, paddingVertical: 13, alignItems: 'center', borderRadius: t.radius.button, backgroundColor: t.red, opacity: busy || (full && drop == null) ? 0.5 : 1 }}>
              <Display style={{ fontSize: 15, color: '#fff' }}>SUBMIT CLAIM</Display>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
