import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { allLabels, canFillSlot, canUseIL, isILSlot } from '@pennant/domain';
import { PlayerCard } from '../../src/PlayerCard';
import { api, type LineupSlot } from '../../src/api';
import { useAuth } from '../../src/auth';
import { Lineup } from '../../src/Lineup';
import { TradeComposer } from '../../src/TradeComposer';
import { TeamAvatar } from '../../src/TeamAvatar';
import { Transactions } from '../../src/Transactions';
import { useRouter } from 'expo-router';
import { useTeams } from '../../src/teams';
import { useLeague } from '../../src/useLeague';
import { fmtPts } from '../../src/useLeague';
import { FONT, useTheme } from '../../src/theme';
import { Body, Card, Display } from '../../src/ui';

const shift = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const pretty = (d: string) => new Date(Date.parse(d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function MyTeam() {
  const { me } = useAuth();
  const { t } = useTheme();
  const team = me?.team;
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.lineup>> | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<LineupSlot | null>(null);
  const [sub, setSub] = useState<'lineup' | 'trade' | 'transactions'>('lineup');
  const [cardId, setCardId] = useState<number | null>(null);
  const router = useRouter();
  const lg = useLeague();
  const { rules } = useTeams();

  const load = useCallback(() => {
    if (!team) return;
    api.lineup(team.id, date ?? undefined).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  }, [team?.id, date]);
  useEffect(() => { setData(null); load(); }, [load]);

  if (!team) return <Body style={{ padding: 20, color: t.dim }}>Your account isn't linked to a team yet.</Body>;
  const day = data?.date ?? date;
  const isToday = !!data && data.date === data.today;
  const say = (m: string) => (Platform.OS === 'web' ? globalThis.alert?.(m) : Alert.alert(m));

  const move = async (toSlot: string) => {
    if (!sel || !data?.date) return;
    const who = sel;
    setSel(null);
    try { await api.moveLineup(team.id, { date: data.date, playerId: who.playerId, toSlot }); load(); }
    catch (e) { say(e instanceof Error ? e.message : 'Could not move player'); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card style={{ padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Pressable onPress={() => router.push('/team-settings')} hitSlop={8} accessibilityLabel="Team settings">
          <TeamAvatar id={team.id} color={team.color} logoKey={team.logo_key} size={54} />
          <View style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: t.panel, borderColor: t.line, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Body style={{ fontSize: 12 }}>⚙</Body>
          </View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Display style={{ fontSize: 24 }} numberOfLines={1}>{team.name}</Display>
          <Body style={{ color: t.dim }}>{team.owner_name} · FAAB ${team.faab}</Body>
        </View>
        {data && (
          <View style={{ alignItems: 'flex-end' }}>
            <Display style={{ fontSize: 26 }}>{fmtPts(data.total)}</Display>
            <Body style={{ color: t.dim, fontSize: 10 }}>{isToday ? 'TODAY' : 'THAT DAY'}</Body>
          </View>
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        {([['lineup', 'Lineup'], ['trade', 'Trade'], ['transactions', 'Transactions']] as const).map(([k, label]) => {
          const on = sub === k;
          return (
            <Pressable key={k} onPress={() => setSub(k)} style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
              <Display style={{ fontSize: 13, color: on ? '#fff' : t.dim }}>{label}</Display>
            </Pressable>
          );
        })}
      </View>

      {sub === 'trade' && <TradeComposer myTeamId={team.id} teams={lg.teams} onSent={() => { setSub('transactions'); }} />}

      {sub === 'transactions' && <Transactions teamId={team.id} commissioner={!!me?.user.isCommissioner} teamName={(id) => lg.byId.get(id)?.name ?? id} />}

      {sub === 'lineup' && data && day && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Pressable onPress={() => setDate(shift(day, -1))} hitSlop={12}><Body style={{ fontSize: 24 }}>‹</Body></Pressable>
          <Pressable onPress={() => setDate(null)} style={{ alignItems: 'center' }}>
            <Display style={{ fontSize: 17, letterSpacing: 0.5 }}>{pretty(day)}</Display>
            <Body style={{ color: isToday ? t.green : t.dim, fontSize: 10.5, fontFamily: FONT.bodyBold }}>
              {isToday ? 'TODAY' : day < data.today ? 'ACTUAL POINTS · TAP FOR TODAY' : 'UPCOMING · TAP FOR TODAY'}
            </Body>
          </Pressable>
          <Pressable onPress={() => setDate(shift(day, 1))} hitSlop={12}><Body style={{ fontSize: 24 }}>›</Body></Pressable>
        </View>
      )}

      {sub === 'lineup' && !data && !err && <ActivityIndicator color={t.red} />}
      {sub === 'lineup' && !!err && <Body style={{ color: t.loss, fontFamily: FONT.bodyMedium }}>{err}</Body>}
      {sub === 'lineup' && data && (
        <>
          {data.editable && <Body style={{ color: t.dim, fontSize: 12, marginBottom: 8, marginLeft: 4 }}>Tap a player to move or swap him.</Body>}
          <Lineup slots={data.slots} showPoints onPress={data.editable ? setSel : undefined} selected={sel?.playerId} />
        </>
      )}

      <PlayerCard playerId={cardId} teamName={(id) => lg.byId.get(id)?.name ?? id} onClose={() => setCardId(null)} />
      <Modal transparent visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable onPress={() => setSel(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ maxHeight: '75%', backgroundColor: t.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderColor: t.line, borderWidth: 1, paddingBottom: 24 }}>
            {sel && data && (
              <>
                <View style={{ padding: 16, paddingBottom: 6 }}>
                  <Display style={{ fontSize: 22 }}>{sel.name}</Display>
                  <Body style={{ color: t.dim, fontSize: 12 }}>{sel.slot.replace(/^B\d$/, 'BN')} · {sel.positions.join(',')} — move to…</Body>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8, flexWrap: 'wrap' }}>
                  <Pressable onPress={() => { const id = sel.playerId; setSel(null); setCardId(id); }} style={{ borderColor: t.line, borderWidth: 1, borderRadius: t.radius.chip, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Display style={{ fontSize: 12, color: t.text }}>PLAYER CARD</Display>
                  </Pressable>
                  {me?.user.isCommissioner && (['—', 'DTD', 'IL', 'OUT'] as const).map((st) => {
                    const cur = sel.injury ?? '—';
                    return (
                      <Pressable key={st} onPress={() => { const who = sel; api.setStatus(who.playerId, st === '—' ? null : st).then(() => { setSel({ ...who, injury: st === '—' ? null : st }); load(); }).catch((e) => say(e.message)); }}
                        style={{ borderColor: cur === st ? t.red : t.line, backgroundColor: cur === st ? t.red : 'transparent', borderWidth: 1, borderRadius: t.radius.chip, paddingHorizontal: 10, paddingVertical: 6 }}>
                        <Display style={{ fontSize: 12, color: cur === st ? '#fff' : t.dim }}>{st}</Display>
                      </Pressable>
                    );
                  })}
                </View>
                {!canUseIL(sel.injury) && <Body style={{ color: t.dim2, fontSize: 11, paddingHorizontal: 16, paddingBottom: 6 }}>Only players ruled IL or OUT can go on the injured list.</Body>}
                {data.editable && isToday && !sel.locked && (
                  <Pressable onPress={() => {
                    const who = sel; setSel(null);
                    const go = () => api.dropPlayer(who.playerId).then(load).catch((e) => say(e instanceof Error ? e.message : 'Could not drop'));
                    if (Platform.OS === 'web') { if (globalThis.confirm?.(`Drop ${who.name}? He becomes a free agent.`)) go(); }
                    else Alert.alert(`Drop ${who.name}?`, 'He becomes a free agent.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Drop', style: 'destructive', onPress: go }]);
                  }} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                    <Body style={{ color: t.loss, fontFamily: FONT.bodyBold }}>Drop {sel.name}</Body>
                  </Pressable>
                )}
                {sel.locked ? (
                  <Body style={{ padding: 16, color: t.loss }}>🔒 His game has started, so he's locked for today.</Body>
                ) : (
                  <ScrollView>
                    {allLabels(rules.ilSlots).filter((l) => l !== sel.slot && canFillSlot(l, sel.positions) && (!isILSlot(l) || canUseIL(sel.injury))).map((label) => {
                      const occ = data.slots.find((s) => s.slot === label);
                      const blocked = !!occ?.locked || (!!occ && !canFillSlot(sel.slot, occ.positions)) || (!!occ && isILSlot(sel.slot) && !canUseIL(occ.injury));
                      return (
                        <Pressable key={label} disabled={blocked} onPress={() => move(label)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: t.line, opacity: blocked ? 0.4 : 1 }}>
                          <Display style={{ width: 44, fontSize: 14, color: t.dim }}>{label.replace(/^B\d$/, 'BN')}</Display>
                          <Body style={{ flex: 1, fontFamily: occ ? FONT.bodySemi : FONT.body, color: occ ? t.text : t.dim2 }}>
                            {occ ? `${occ.locked ? '🔒 ' : ''}${occ.name}` : 'Empty'}
                          </Body>
                          {occ && !blocked && <Body style={{ color: t.dim, fontSize: 11 }}>swap</Body>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
