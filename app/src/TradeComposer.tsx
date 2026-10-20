import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { rosterSizeOf } from '@pennant/domain';
import { useTeams } from './teams';
import { api, type LineupSlot, type Team } from './api';
import { FONT, useTheme } from './theme';
import { Body, Card, Display } from './ui';

const MAX = 5;

/** Build a trade offer: pick a partner, tick what you give and what you want, send. */
export function TradeComposer({ myTeamId, teams, initialTeam, initialPlayer, onSent }: {
  myTeamId: string; teams: Team[]; initialTeam?: string; initialPlayer?: number; onSent: () => void;
}) {
  const { t } = useTheme();
  const [partner, setPartner] = useState<string | null>(initialTeam && initialTeam !== myTeamId ? initialTeam : null);
  const [mine, setMine] = useState<LineupSlot[] | null>(null);
  const [theirs, setTheirs] = useState<LineupSlot[] | null>(null);
  const [give, setGive] = useState<number[]>([]);
  const { rules } = useTeams();
  const ROSTER_SIZE = rosterSizeOf(rules.roster);
  const [get, setGet] = useState<number[]>(initialPlayer ? [initialPlayer] : []);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.lineup(myTeamId).then((l) => setMine(l.slots)).catch(() => setMine([])); }, [myTeamId]);
  useEffect(() => {
    setTheirs(null);
    if (partner) api.lineup(partner).then((l) => setTheirs(l.slots)).catch(() => setTheirs([]));
  }, [partner]);

  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : list.length < MAX ? [...list, id] : list);

  const myAfter = (mine?.length ?? 0) - give.length + get.length;
  const theirAfter = (theirs?.length ?? 0) - get.length + give.length;
  const over = myAfter > ROSTER_SIZE ? 'You' : theirAfter > ROSTER_SIZE ? 'They' : null;
  const send = async () => {
    if (!partner) return;
    setBusy(true); setErr('');
    try { await api.proposeTrade({ toTeam: partner, give, get }); onSent(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not send offer'); setBusy(false); }
  };

  const list = (slots: LineupSlot[] | null, picked: number[], set: (v: number[]) => void, empty: string) =>
    !slots ? <ActivityIndicator color={t.red} /> : slots.length === 0 ? <Body style={{ color: t.dim, padding: 12 }}>{empty}</Body> : (
      <Card style={{ overflow: 'hidden' }}>
        {slots.map((p, i) => {
          const on = picked.includes(p.playerId);
          return (
            <Pressable key={p.playerId} onPress={() => toggle(picked, set, p.playerId)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, backgroundColor: on ? t.card2 : 'transparent' }}>
              <Body style={{ fontSize: 18, color: on ? t.red : t.dim2 }}>{on ? '☑' : '☐'}</Body>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontFamily: FONT.bodySemi, fontSize: 14 }}>{p.name}</Body>
                <Body style={{ color: t.dim, fontSize: 11 }}>{p.mlbTeam ?? 'FA'} · {p.positions.join(',')}</Body>
              </View>
              <Body style={{ color: t.dim2, fontSize: 11 }}>{p.slot.replace(/^B\d$/, 'BN')}</Body>
            </Pressable>
          );
        })}
      </Card>
    );

  return (
    <View>
      <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>TRADE WITH</Display>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        {teams.filter((x) => x.id !== myTeamId).map((x) => {
          const on = partner === x.id;
          return (
            <Pressable key={x.id} onPress={() => { setPartner(x.id); setGet([]); }}
              style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 6, borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, borderLeftWidth: 4, borderLeftColor: x.color, backgroundColor: on ? t.card2 : 'transparent' }}>
              <Body style={{ fontFamily: FONT.bodySemi, fontSize: 13 }}>{x.name}</Body>
            </Pressable>
          );
        })}
      </ScrollView>

      {partner && (
        <>
          <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>YOU GIVE ({give.length})</Display>
          <View style={{ marginBottom: 14 }}>{list(mine, give, setGive, 'You have no players.')}</View>
          <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>YOU GET ({get.length})</Display>
          <View style={{ marginBottom: 14 }}>{list(theirs, get, setGet, 'They have no players.')}</View>

          <Card style={{ padding: 12, marginBottom: 12 }}>
            <Body style={{ color: t.dim, fontSize: 12 }}>
              After the trade: you {myAfter}/{ROSTER_SIZE} players · they {theirAfter}/{ROSTER_SIZE}. Up to {MAX} players per side.
            </Body>
            {over && <Body style={{ color: t.loss, fontSize: 12, marginTop: 4 }}>{over} would be over the roster limit.</Body>}
          </Card>
          {!!err && <Body style={{ color: t.loss, fontFamily: FONT.bodyMedium, marginBottom: 10 }}>{err}</Body>}
          <Pressable onPress={send} disabled={busy || !give.length || !get.length || !!over}
            style={{ backgroundColor: t.red, borderRadius: t.radius.button, paddingVertical: 14, alignItems: 'center', opacity: busy || !give.length || !get.length || over ? 0.5 : 1 }}>
            <Display style={{ color: '#fff', fontSize: 17, letterSpacing: 1 }}>SEND TRADE OFFER</Display>
          </Pressable>
        </>
      )}
    </View>
  );
}
