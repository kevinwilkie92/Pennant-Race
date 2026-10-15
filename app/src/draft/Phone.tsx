import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BUDGET, ROSTER_LABELS, ROSTER_SIZE } from '@pennant/domain';
import type { DraftManager, DraftPlayer, DraftSale, MlbTeam, Nomination, Team } from '../api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TeamAvatar } from '../TeamAvatar';
import { FONT, useTheme, type Tokens } from '../theme';
import { GROUPS, groupOf, type Group } from './useDraft';

type Roster = Map<string, { sale: DraftSale; label: string }[]>;

export type PhoneProps = {
  title: string; isLive: boolean; connected: boolean;
  mlb: MlbTeam[]; players: DraftPlayer[]; teams: Team[]; managers: DraftManager[]; sales: DraftSale[];
  sale: Map<number, DraftSale>; roster: Roster; byPlayer: Map<number, DraftPlayer>;
  current: string | null; onBrowse: (abbr: string) => void;
  myTeamId: string | null; onBack: () => void; nomination?: Nomination | null;
};

type Tab = 'board' | 'mgrs' | 'mine' | 'log';
const TABS: { key: Tab; label: string }[] = [
  { key: 'board', label: 'Board' }, { key: 'mgrs', label: 'Managers' }, { key: 'mine', label: 'My Roster' }, { key: 'log', label: 'Log' },
];
const colorOf = (g: Group) => GROUPS.find((x) => x.key === g)!.color;

export function Phone(p: PhoneProps) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('board');
  const [chip, setChip] = useState<'ALL' | Group>('ALL');
  const [q, setQ] = useState('');
  const [mgrSheet, setMgrSheet] = useState<string | null>(null);
  const [playerSheet, setPlayerSheet] = useState<DraftPlayer | null>(null);
  const [pickTeam, setPickTeam] = useState(false);

  const teamById = new Map(p.teams.map((x) => [x.id, x]));
  const mgrById = new Map(p.managers.map((m) => [m.teamId, m]));
  const team = p.mlb.find((m) => m.abbr === p.current) ?? null;
  const mine = p.myTeamId ? mgrById.get(p.myTeamId) : undefined;
  const myTeam = p.myTeamId ? teamById.get(p.myTeamId) : undefined;
  const last = p.sales[p.sales.length - 1];

  const board = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return p.players.filter((x) => x.mlbTeam === p.current && (chip === 'ALL' || groupOf(x) === chip) && (!ql || x.name.toLowerCase().includes(ql)));
  }, [p.players, p.current, chip, q]);
  const leftOnBoard = p.players.filter((x) => x.mlbTeam === p.current && !p.sale.has(x.id)).length;

  const s = styles(t);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* header */}
      <View style={[s.row, { paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomColor: t.line, borderBottomWidth: 1 }]}>
        <Pressable onPress={p.onBack} hitSlop={12}><Text style={{ color: t.text, fontSize: 26 }}>‹</Text></Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[s.display, { fontSize: 19 }]}>DRAFT ROOM</Text>
          <Text style={{ color: t.dim, fontFamily: FONT.body, fontSize: 10.5 }}>Carrollton All Stars · {p.title}</Text>
        </View>
        <Text style={{ color: '#fff', fontFamily: FONT.display, fontSize: 11, letterSpacing: 1, backgroundColor: p.isLive ? (p.connected ? '#e22634' : t.dim2) : t.dim2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: t.radius.chip, overflow: 'hidden' }}>
          {p.isLive ? (p.connected ? '● LIVE' : 'RECONNECTING') : 'FINAL'}
        </Text>
      </View>

      {/* on the clock */}
      <View style={[s.row, { padding: 12, paddingHorizontal: 16, gap: 12, backgroundColor: (team?.color ?? t.panel) + 'cc', borderBottomColor: t.line, borderBottomWidth: 1 }]}>
        {team?.logo ? (
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: team.logo }} style={{ width: 34, height: 34, resizeMode: 'contain' }} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: FONT.displayBold, fontSize: 10, letterSpacing: 1.2 }}>{p.isLive ? 'ON THE CLOCK' : 'BROWSING'}</Text>
          <Text numberOfLines={1} style={[s.display, { fontSize: 21, color: '#fff' }]}>
            {team?.name ?? (p.isLive ? 'Waiting for the hat…' : 'Pick a team')}
          </Text>
        </View>
        {!p.isLive && (
          <Pressable onPress={() => setPickTeam(true)} style={{ backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: t.radius.chip }}>
            <Text style={{ color: '#fff', fontFamily: FONT.bodyBold, fontSize: 12 }}>Team ▾</Text>
          </Pressable>
        )}
        {team && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: '#fff', fontFamily: FONT.num, fontSize: 17 }}>{leftOnBoard}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontFamily: FONT.body, fontSize: 9.5 }}>LEFT ON BOARD</Text>
          </View>
        )}
      </View>

      {/* now bidding: the player the commissioner has put up for auction */}
      {p.nomination && (
        <Pressable onPress={() => { const pl = p.byPlayer.get(p.nomination!.playerId); if (pl) setPlayerSheet(pl); }}
          style={[s.row, { gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(51,176,106,0.16)', borderBottomColor: 'rgba(51,176,106,0.4)', borderBottomWidth: 1 }]}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.green }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.green, fontFamily: FONT.bodyBold, fontSize: 10, letterSpacing: 1.5 }}>NOW BIDDING</Text>
            <Text numberOfLines={1} style={{ color: t.text, fontFamily: FONT.bodyBold, fontSize: 15 }}>
              {p.nomination.name} <Text style={{ color: t.dim, fontFamily: FONT.body, fontSize: 12 }}>{p.nomination.positions.join(',')} · {p.nomination.mlbTeam ?? 'FA'}</Text>
            </Text>
          </View>
          {p.nomination.bid != null ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: t.green, fontFamily: FONT.num, fontSize: 20 }}>${p.nomination.bid}</Text>
              {p.nomination.teamId && <Text numberOfLines={1} style={{ color: t.dim, fontFamily: FONT.body, fontSize: 10, maxWidth: 120 }}>{teamById.get(p.nomination.teamId)?.name ?? p.nomination.teamId}</Text>}
            </View>
          ) : <Text style={{ color: t.dim, fontFamily: FONT.body, fontSize: 11 }}>no bids yet</Text>}
        </Pressable>
      )}

      {/* latest pick */}
      {last && (
        <View style={[s.row, { gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(51,176,106,0.12)', borderBottomColor: 'rgba(51,176,106,0.25)', borderBottomWidth: 1 }]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.green }} />
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontFamily: FONT.body, fontSize: 12.5 }}>
            <Text style={{ fontFamily: FONT.bodyBold }}>{last.name}</Text>
            <Text style={{ color: t.dim }}>  → {teamById.get(last.teamId)?.name ?? last.teamId}</Text>
          </Text>
          <Text style={{ color: t.green, fontFamily: FONT.num, fontSize: 16 }}>${last.price}</Text>
        </View>
      )}

      {/* wallet */}
      {mine && myTeam && (
        <View style={[s.card, { flexDirection: 'row', alignItems: 'stretch', margin: 12, marginBottom: 0, overflow: 'hidden' }]}>
          <View style={[s.row, { flex: 1.4, gap: 9, padding: 11 }]}>
            <TeamAvatar id={myTeam.id} color={myTeam.color} logoKey={myTeam.logoKey} size={32} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontFamily: FONT.bodyBold, fontSize: 12.5 }}>{myTeam.name}</Text>
              <Text style={{ color: t.dim, fontFamily: FONT.body, fontSize: 10 }}>Your wallet</Text>
            </View>
          </View>
          {([['BUDGET', `$${mine.remaining}`, t.green], ['MAX BID', `$${mine.maxBid}`, t.gold], ['SPOTS', String(mine.spots), t.text]] as const).map(([k, v, c]) => (
            <View key={k} style={{ flex: 1, padding: 10, alignItems: 'center', justifyContent: 'center', borderLeftColor: t.line, borderLeftWidth: 1 }}>
              <Text style={{ color: c, fontFamily: FONT.num, fontSize: 19 }}>{v}</Text>
              <Text style={{ color: t.dim, fontFamily: FONT.body, fontSize: 9, letterSpacing: 0.5 }}>{k}</Text>
            </View>
          ))}
        </View>
      )}

      {/* content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {tab === 'board' && (
          <View>
            <View style={{ flexDirection: 'row', gap: 6, padding: 12, paddingBottom: 4 }}>
              {(['ALL', ...GROUPS.map((g) => g.key)] as const).map((k) => {
                const on = chip === k;
                return (
                  <Pressable key={k} onPress={() => setChip(k)}
                    style={{ flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: t.radius.chip, borderWidth: 1, borderColor: on ? t.red : t.line, backgroundColor: on ? t.red : 'transparent' }}>
                    <Text style={{ color: on ? '#fff' : t.dim, fontFamily: FONT.displayBold, fontSize: 12, letterSpacing: 0.5 }}>{k === 'ALL' ? 'ALL' : GROUPS.find((g) => g.key === k)!.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput value={q} onChangeText={setQ} placeholder="Search players" placeholderTextColor={t.dim2}
              style={{ marginHorizontal: 12, marginVertical: 6, paddingHorizontal: 12, paddingVertical: 9, color: t.text, fontFamily: FONT.body, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.button }} />
            {!team && <Empty t={t} msg={p.isLive ? 'The commissioner hasn’t drawn a team yet.' : 'Choose a team to browse its results.'} />}
            {board.map((x) => {
              const sold = p.sale.get(x.id);
              const g = groupOf(x);
              return (
                <Pressable key={x.id} onPress={() => setPlayerSheet(x)} style={[s.line, { opacity: sold ? 0.6 : 1 }]}>
                  <Text style={{ width: 52, color: colorOf(g), fontFamily: FONT.display, fontSize: 12 }} numberOfLines={1}>{x.positions.join(',')}</Text>
                  <Text numberOfLines={1} style={{ flex: 1, color: sold ? t.dim : t.text, fontFamily: FONT.bodySemi, fontSize: 13.5 }}>{x.name}</Text>
                  {sold ? (
                    <View style={[s.row, { gap: 7 }]}>
                      <Text style={{ color: teamById.get(sold.teamId)?.color ?? t.dim, fontFamily: FONT.bodyBold, fontSize: 11 }}>{sold.teamId}</Text>
                      <Text style={{ color: t.green, fontFamily: FONT.num, fontSize: 14 }}>${sold.price}</Text>
                    </View>
                  ) : <Text style={{ color: t.dim2, fontFamily: FONT.body, fontSize: 10.5 }}>available</Text>}
                </Pressable>
              );
            })}
            {team && board.length === 0 && <Empty t={t} msg="No players match this filter." />}
          </View>
        )}

        {tab === 'mgrs' && (
          <View>
            <View style={[s.row, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }]}>
              <Text style={[s.head, { flex: 1 }]}>MANAGER</Text>
              <Text style={[s.head, { width: 56, textAlign: 'right' }]}>BUDGET</Text>
              <Text style={[s.head, { width: 52, textAlign: 'right' }]}>MAX</Text>
              <Text style={[s.head, { width: 48, textAlign: 'right' }]}>SPOTS</Text>
            </View>
            {p.teams.map((tm) => {
              const m = mgrById.get(tm.id);
              return (
                <Pressable key={tm.id} onPress={() => setMgrSheet(tm.id)} style={[s.line, { gap: 10, backgroundColor: tm.id === p.myTeamId ? t.card : 'transparent' }]}>
                  <TeamAvatar id={tm.id} color={tm.color} logoKey={tm.logoKey} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: t.text, fontFamily: FONT.bodySemi, fontSize: 12.5 }}>{tm.name}</Text>
                    <Text style={{ color: t.dim2, fontFamily: FONT.body, fontSize: 10 }}>{tm.owner}</Text>
                  </View>
                  <Text style={[s.num, { width: 56, color: t.green }]}>${m?.remaining ?? BUDGET}</Text>
                  <Text style={[s.num, { width: 52, color: t.gold }]}>${m?.maxBid ?? 0}</Text>
                  <Text style={[s.num, { width: 48, color: t.text }]}>{m?.spots ?? ROSTER_SIZE}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {tab === 'mine' && (p.myTeamId
          ? <RosterList t={t} teamId={p.myTeamId} roster={p.roster} manager={mine} header />
          : <Empty t={t} msg="Your account isn't linked to a team." />)}

        {tab === 'log' && (
          <View>
            <Text style={[s.head, { padding: 12, paddingBottom: 6 }]}>DRAFT LOG · {p.sales.length} PICKS</Text>
            {[...p.sales].reverse().map((e) => (
              <View key={e.seq} style={[s.line, { gap: 10 }]}>
                <Text style={{ width: 30, color: t.dim2, fontFamily: FONT.num, fontSize: 13 }}>{e.seq}</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: t.text, fontFamily: FONT.bodySemi, fontSize: 13 }}>{e.name}{e.isKeeper ? '  · keeper' : ''}</Text>
                  <Text numberOfLines={1} style={{ color: t.dim2, fontFamily: FONT.body, fontSize: 10.5 }}>{teamById.get(e.teamId)?.name ?? e.teamId}</Text>
                </View>
                <Text style={{ color: t.gold, fontFamily: FONT.num, fontSize: 15 }}>${e.price}</Text>
              </View>
            ))}
            {p.sales.length === 0 && <Empty t={t} msg="No picks yet — the auction hasn't started." />}
          </View>
        )}
      </ScrollView>

      {/* bottom tabs */}
      <View style={{ flexDirection: 'row', backgroundColor: '#0a1a30', paddingBottom: Math.max(insets.bottom, 12), paddingTop: 6, borderTopColor: 'rgba(255,255,255,0.08)', borderTopWidth: 1 }}>
        {TABS.map((x) => (
          <Pressable key={x.key} onPress={() => setTab(x.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ color: tab === x.key ? t.red : '#fff', fontFamily: FONT.bodyBold, fontSize: 12 }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* manager roster sheet */}
      <Sheet visible={!!mgrSheet} onClose={() => setMgrSheet(null)} t={t}>
        {mgrSheet && (
          <>
            <Text style={[s.display, { fontSize: 22, padding: 16, paddingBottom: 0 }]}>{teamById.get(mgrSheet)?.name}</Text>
            <ScrollView><RosterList t={t} teamId={mgrSheet} roster={p.roster} manager={mgrById.get(mgrSheet)} header /></ScrollView>
          </>
        )}
      </Sheet>

      {/* player sheet */}
      <Sheet visible={!!playerSheet} onClose={() => setPlayerSheet(null)} t={t}>
        {playerSheet && (() => {
          const sold = p.sale.get(playerSheet.id);
          const g = groupOf(playerSheet);
          const tm = p.mlb.find((m) => m.abbr === playerSheet.mlbTeam);
          return (
            <View style={{ padding: 18, gap: 6 }}>
              <Text style={{ color: colorOf(g), fontFamily: FONT.display, fontSize: 13, letterSpacing: 1 }}>{playerSheet.positions.join(' · ')}</Text>
              <Text style={[s.display, { fontSize: 30 }]}>{playerSheet.name}</Text>
              <Text style={{ color: t.dim, fontFamily: FONT.body, fontSize: 14 }}>{tm?.name ?? 'Free agent'}</Text>
              <View style={[s.card, { padding: 14, marginTop: 10 }]}>
                {sold ? (
                  <>
                    <Text style={{ color: t.dim, fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 1 }}>SOLD</Text>
                    <Text style={{ color: t.text, fontFamily: FONT.bodyBold, fontSize: 16 }}>{teamById.get(sold.teamId)?.name ?? sold.teamId}</Text>
                    <Text style={{ color: t.green, fontFamily: FONT.num, fontSize: 28 }}>${sold.price}</Text>
                    {sold.keeperYear ? <Text style={{ color: t.gold, fontFamily: FONT.bodyBold, marginTop: 2 }}>Keeper · Year {sold.keeperYear}</Text> : null}
                  </>
                ) : <Text style={{ color: t.text, fontFamily: FONT.bodySemi, fontSize: 15 }}>Available — not yet drafted</Text>}
              </View>
            </View>
          );
        })()}
      </Sheet>

      {/* archive: team picker */}
      <Sheet visible={pickTeam} onClose={() => setPickTeam(false)} t={t}>
        <ScrollView>
          {p.mlb.map((m) => (
            <Pressable key={m.abbr} onPress={() => { setPickTeam(false); p.onBrowse(m.abbr); }} style={[s.line, { gap: 10 }]}>
              <View style={{ width: 6, height: 22, backgroundColor: m.color ?? t.dim2 }} />
              <Text style={{ flex: 1, color: t.text, fontFamily: FONT.bodySemi, fontSize: 14 }}>{m.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function RosterList({ t, teamId, roster, manager, header }: {
  t: Tokens; teamId: string; roster: Roster; manager?: DraftManager; header?: boolean;
}) {
  const by = new Map((roster.get(teamId) ?? []).map((r) => [r.label, r.sale]));
  const s = styles(t);
  return (
    <View>
      {header && (
        <View style={[s.row, { justifyContent: 'space-between', padding: 12, paddingBottom: 6 }]}>
          <Text style={s.head}>ROSTER · {manager?.filled ?? 0} / {ROSTER_SIZE}</Text>
          <Text style={{ color: t.dim2, fontFamily: FONT.body, fontSize: 11 }}>Spent ${manager?.spent ?? 0} · Max ${manager?.maxBid ?? 0}</Text>
        </View>
      )}
      {ROSTER_LABELS.map((label) => {
        const e = by.get(label);
        return (
          <View key={label} style={[s.line, { gap: 10, paddingVertical: 8 }]}>
            <Text style={{ width: 38, color: '#e0607a', fontFamily: FONT.display, fontSize: 12 }}>{label}</Text>
            <Text numberOfLines={1} style={{ flex: 1, color: e ? t.text : t.dim2, fontFamily: FONT.bodySemi, fontSize: 13 }}>{e?.name ?? 'Empty'}</Text>
            {e?.keeperYear ? <Text style={{ color: '#fff', backgroundColor: e.keeperYear === 1 ? '#2e9e5b' : '#d19a1f', fontFamily: FONT.bodyBold, fontSize: 9, paddingHorizontal: 4, paddingVertical: 1 }}>Y{e.keeperYear}</Text> : null}
            {e ? <Text style={{ color: t.green, fontFamily: FONT.num, fontSize: 14 }}>${e.price}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function Sheet({ visible, onClose, t, children }: { visible: boolean; onClose: () => void; t: Tokens; children: React.ReactNode }) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ maxHeight: '82%', backgroundColor: t.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderColor: t.line, borderWidth: 1, paddingBottom: 24 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.dim2, marginTop: 8 }} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Empty({ t, msg }: { t: Tokens; msg: string }) {
  return <Text style={{ padding: 30, textAlign: 'center', color: t.dim2, fontFamily: FONT.body, fontSize: 13 }}>{msg}</Text>;
}

const styles = (t: Tokens) => ({
  row: { flexDirection: 'row', alignItems: 'center' } as const,
  display: { fontFamily: FONT.display, fontStyle: t.display, color: t.text } as const,
  head: { color: t.dim, fontFamily: FONT.displayBold, fontSize: 11, letterSpacing: 0.8 } as const,
  num: { textAlign: 'right', fontFamily: FONT.num, fontSize: 14.5 } as const,
  card: { backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.card } as const,
  line: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopColor: t.line, borderTopWidth: 1 } as const,
});
