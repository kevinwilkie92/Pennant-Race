import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { api, type Claim, type LineupSlot, type TradeOffer, type Txn } from './api';
import { FONT, useTheme } from './theme';
import { Body, Card, Display } from './ui';

const say = (m: string) => (Platform.OS === 'web' ? globalThis.alert?.(m) : Alert.alert(m));
export const describeTxn = (x: Txn, teamName: (id: string) => string) =>
  x.type === 'waiver' ? `${teamName(x.teamId)} added ${x.player} ($${x.faab ?? 0})`
    : x.type === 'drop' ? `${teamName(x.teamId)} dropped ${x.player}`
    : x.type === 'add' ? `${teamName(x.teamId)} added ${x.player}`
    : x.type === 'trade' ? tradeLine(x, teamName) : `${teamName(x.teamId)} drafted ${x.player}`;

function tradeLine(x: Txn, teamName: (id: string) => string) {
  try {
    const d = JSON.parse(x.detail ?? '{}') as { to?: string; give?: string[]; get?: string[] };
    return `${teamName(x.teamId)} traded ${(d.give ?? []).join(', ')} to ${teamName(d.to ?? '?')} for ${(d.get ?? []).join(', ')}`;
  } catch { return `${teamName(x.teamId)} made a trade`; }
}

/** My Team → Transactions: pending waiver claims (editable bid / drop / priority) and recent results. */
export function Transactions({ teamId, commissioner, teamName }: { teamId: string; commissioner: boolean; teamName: (id: string) => string }) {
  const { t } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.claims>> | null>(null);
  const [log, setLog] = useState<Txn[]>([]);
  const [roster, setRoster] = useState<LineupSlot[]>([]);
  const [picking, setPicking] = useState<Claim | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [trades, setTrades] = useState<Awaited<ReturnType<typeof api.trades>> | null>(null);

  const load = useCallback(() => {
    api.claims().then(setData).catch(() => {});
    api.leagueSettings().then((x) => setDays(x.waiverDays)).catch(() => {});
    api.trades().then(setTrades).catch(() => {});
    api.transactions(teamId).then(setLog).catch(() => {});
    api.lineup(teamId).then((l) => setRoster(l.slots)).catch(() => {});
  }, [teamId]);
  useEffect(load, [load]);
  const act = (fn: () => Promise<unknown>) => fn().then(load).catch((e) => say(e instanceof Error ? e.message : 'Failed'));

  if (!data) return null;
  return (
    <View>
      <Card style={{ padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Body style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>FAAB REMAINING</Body>
          <Display style={{ fontSize: 28, color: t.green }}>${data.faab}</Display>
        </View>
        {commissioner && (
          <Pressable onPress={() => act(async () => { const r = await api.processWaivers(); say(`Waivers processed: ${r.won} won, ${r.failed} failed${(r as { deferred?: number }).deferred ? `, ${(r as { deferred?: number }).deferred} waiting on a waiver period` : ''}.`); })}
            style={{ borderColor: t.red, borderWidth: 1, borderRadius: t.radius.chip, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Display style={{ fontSize: 12.5, color: t.red }}>RUN WAIVERS NOW</Display>
          </Pressable>
        )}
      </Card>

      {commissioner && days != null && (
        <Card style={{ padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontFamily: FONT.bodySemi }}>Waiver period after a drop</Body>
            <Body style={{ color: t.dim, fontSize: 11 }}>Commissioner setting. 0 = claimable at the next run.</Body>
          </View>
          <Pressable disabled={days <= 0} onPress={() => act(() => api.setWaiverDays(days - 1))} hitSlop={8}><Display style={{ fontSize: 24, color: days <= 0 ? t.dim2 : t.text }}>−</Display></Pressable>
          <Display style={{ fontSize: 20, minWidth: 54, textAlign: 'center' }}>{days} day{days === 1 ? '' : 's'}</Display>
          <Pressable disabled={days >= 14} onPress={() => act(() => api.setWaiverDays(days + 1))} hitSlop={8}><Display style={{ fontSize: 24, color: days >= 14 ? t.dim2 : t.text }}>+</Display></Pressable>
        </Card>
      )}

      {trades && (trades.received.length > 0 || trades.sent.length > 0) && (
        <>
          <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>TRADE OFFERS</Display>
          {[...trades.received.map((o) => ({ o, mine: false })), ...trades.sent.map((o) => ({ o, mine: true }))].map(({ o, mine }) => (
            <OfferCard key={o.id} o={o} mine={mine} teamName={teamName}
              onAccept={() => act(() => api.acceptTrade(o.id))} onReject={() => act(() => api.rejectTrade(o.id))} onCancel={() => act(() => api.cancelTrade(o.id))} />
          ))}
        </>
      )}

      <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, marginBottom: 6, marginLeft: 4 }}>PENDING CLAIMS</Display>
      {data.pending.length === 0 ? (
        <Body style={{ color: t.dim, marginBottom: 14, marginLeft: 4 }}>No pending claims. Add a free agent from the Players tab.</Body>
      ) : data.pending.map((c, i) => (
        <Card key={c.id} style={{ padding: 12, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ alignItems: 'center' }}>
              <Pressable disabled={i === 0} onPress={() => act(() => api.editClaim(c.id, { move: 'up' }))} hitSlop={8}><Body style={{ color: i === 0 ? t.dim2 : t.text }}>▲</Body></Pressable>
              <Display style={{ fontSize: 15, color: t.dim }}>{c.priority}</Display>
              <Pressable disabled={i === data.pending.length - 1} onPress={() => act(() => api.editClaim(c.id, { move: 'down' }))} hitSlop={8}><Body style={{ color: i === data.pending.length - 1 ? t.dim2 : t.text }}>▼</Body></Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontFamily: FONT.bodyBold, fontSize: 15 }} numberOfLines={1}>+ {c.addName}</Body>
              {c.waiversUntil && <Body style={{ color: t.gold, fontSize: 11, fontFamily: FONT.bodySemi }}>⏳ On waivers — can be won from {c.waiversUntil}</Body>}
              <Pressable onPress={() => setPicking(c)}>
                <Body style={{ color: c.dropName ? t.loss : t.dim, fontSize: 13 }} numberOfLines={1}>{c.dropName ? `− ${c.dropName}` : '− no drop (tap to choose)'}  ✎</Body>
              </Pressable>
            </View>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable disabled={c.bid <= 0} onPress={() => act(() => api.editClaim(c.id, { bid: Math.max(0, c.bid - 1) }))} hitSlop={8}><Display style={{ fontSize: 22, color: c.bid <= 0 ? t.dim2 : t.text }}>−</Display></Pressable>
                <Display style={{ fontSize: 22, color: t.green, minWidth: 44, textAlign: 'center' }}>${c.bid}</Display>
                <Pressable disabled={c.bid >= data.faab} onPress={() => act(() => api.editClaim(c.id, { bid: c.bid + 1 }))} hitSlop={8}><Display style={{ fontSize: 22, color: c.bid >= data.faab ? t.dim2 : t.text }}>+</Display></Pressable>
              </View>
              <Pressable onPress={() => act(() => api.cancelClaim(c.id))} hitSlop={8}><Body style={{ color: t.loss, fontSize: 12 }}>Cancel</Body></Pressable>
            </View>
          </View>
        </Card>
      ))}

      {data.recent.length > 0 && (
        <>
          <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, margin: 4, marginTop: 10 }}>RESULTS</Display>
          <Card style={{ overflow: 'hidden', marginBottom: 12 }}>
            {data.recent.map((c, i) => (
              <View key={c.id} style={{ padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                <Body style={{ fontFamily: FONT.bodySemi }}>{c.addName} · ${c.bid}</Body>
                <Body style={{ fontSize: 12, color: c.status === 'won' ? t.green : c.status === 'failed' ? t.loss : t.dim }}>
                  {c.status === 'won' ? 'Won' : c.status === 'failed' ? `Lost — ${c.reason}` : 'Cancelled'}
                </Body>
              </View>
            ))}
          </Card>
        </>
      )}

      {trades && trades.history.length > 0 && (
        <>
          <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, margin: 4, marginTop: 10 }}>PAST TRADES</Display>
          <Card style={{ overflow: 'hidden', marginBottom: 12 }}>
            {trades.history.map((o, i) => (
              <View key={o.id} style={{ padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
                <Body style={{ fontSize: 13 }}>
                  {teamName(o.fromTeam)} → {teamName(o.toTeam)}: {o.give.map((p) => p.name).join(', ')} for {o.get.map((p) => p.name).join(', ')}
                </Body>
                <Body style={{ fontSize: 12, color: o.status === 'accepted' ? t.green : t.dim }}>
                  {o.status === 'accepted' ? 'Accepted' : o.status === 'rejected' ? 'Rejected' : `Cancelled${o.reason ? ` — ${o.reason}` : ''}`}
                </Body>
              </View>
            ))}
          </Card>
        </>
      )}

      <Display style={{ fontSize: 13, letterSpacing: 1.5, color: t.dim, margin: 4, marginTop: 10 }}>TEAM ACTIVITY</Display>
      <Card style={{ overflow: 'hidden' }}>
        {log.length === 0 && <Body style={{ color: t.dim, padding: 12 }}>No transactions yet.</Body>}
        {log.map((x, i) => (
          <View key={x.id} style={{ padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
            <Body style={{ fontSize: 13 }}>{describeTxn(x, teamName)}</Body>
            <Body style={{ color: t.dim2, fontSize: 11 }}>{new Date(x.at).toLocaleString()}</Body>
          </View>
        ))}
      </Card>

      <Modal transparent visible={!!picking} animationType="slide" onRequestClose={() => setPicking(null)}>
        <Pressable onPress={() => setPicking(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ maxHeight: '75%', backgroundColor: t.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderColor: t.line, borderWidth: 1, paddingBottom: 24 }}>
            <Display style={{ fontSize: 20, padding: 16 }}>Who to drop?</Display>
            <ScrollView>
              <Pressable onPress={() => { const c = picking!; setPicking(null); act(() => api.editClaim(c.id, { dropPlayerId: null })); }} style={{ padding: 14, borderTopWidth: 1, borderTopColor: t.line }}>
                <Body style={{ color: t.dim }}>No drop (needs an open roster spot)</Body>
              </Pressable>
              {roster.map((r) => (
                <Pressable key={r.playerId} onPress={() => { const c = picking!; setPicking(null); act(() => api.editClaim(c.id, { dropPlayerId: r.playerId })); }}
                  style={{ padding: 14, borderTopWidth: 1, borderTopColor: t.line, flexDirection: 'row', gap: 10 }}>
                  <Body style={{ flex: 1, fontFamily: FONT.bodySemi }}>{r.name}</Body>
                  <Body style={{ color: t.dim, fontSize: 12 }}>{r.slot.replace(/^B\d$/, 'BN')} · {r.positions.join(',')}</Body>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function OfferCard({ o, mine, teamName, onAccept, onReject, onCancel }: {
  o: TradeOffer; mine: boolean; teamName: (id: string) => string; onAccept: () => void; onReject: () => void; onCancel: () => void;
}) {
  const { t } = useTheme();
  const names = (ps: TradeOffer['give']) => ps.map((p) => p.name).join(', ');
  const btn = (label: string, onPress: () => void, color: string, disabled = false) => (
    <Pressable onPress={onPress} disabled={disabled} style={{ borderColor: color, borderWidth: 1, borderRadius: t.radius.chip, paddingHorizontal: 14, paddingVertical: 8, opacity: disabled ? 0.4 : 1 }}>
      <Display style={{ fontSize: 13, color }}>{label}</Display>
    </Pressable>
  );
  return (
    <Card style={{ padding: 12, marginBottom: 8 }}>
      <Body style={{ color: t.dim, fontSize: 11, fontFamily: FONT.bodyBold, letterSpacing: 1 }}>
        {mine ? `SENT TO ${teamName(o.toTeam).toUpperCase()}` : `FROM ${teamName(o.fromTeam).toUpperCase()}`}
      </Body>
      <Body style={{ marginTop: 4, fontSize: 14 }}><Body style={{ color: t.dim, fontSize: 14 }}>{mine ? 'You give: ' : 'They give: '}</Body>{names(o.give)}</Body>
      <Body style={{ marginTop: 2, fontSize: 14 }}><Body style={{ color: t.dim, fontSize: 14 }}>{mine ? 'You get: ' : 'You give: '}</Body>{names(o.get)}</Body>
      {o.problem && <Body style={{ color: t.loss, fontSize: 12, marginTop: 6 }}>⚠ {o.problem}</Body>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {mine ? btn('CANCEL OFFER', onCancel, t.loss) : (
          <>
            {btn('ACCEPT', onAccept, t.green, !!o.problem)}
            {btn('REJECT', onReject, t.loss)}
          </>
        )}
      </View>
    </Card>
  );
}
