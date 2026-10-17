import { Image, Pressable, Text, View } from 'react-native';
import { FONT } from '../theme';
import type { SeasonRow } from '../api';
import { useTeams } from '../teams';
import { D } from './tokens';

export type Tab = 'board' | 'rosters' | 'undrafted' | 'keepers' | 'log';
const TABS: { key: Tab; label: string }[] = [
  { key: 'board', label: 'DRAFT BOARD' },
  { key: 'rosters', label: 'ROSTERS' },
  { key: 'undrafted', label: 'UNDRAFTED' },
  { key: 'keepers', label: 'KEEPERS' },
  { key: 'log', label: 'DRAFT LOG' },
];

type Props = {
  tab: Tab; setTab: (t: Tab) => void;
  seasons: SeasonRow[]; season: number | null; setSeason: (y: number) => void;
  drafted: number; total: number; live: boolean; commissioner: boolean; isLive: boolean;
  onUndo: () => void; onBack: () => void; onPush: () => void; pushYear: number | null;
};

export function Nav(p: Props) {
  const { leagueName } = useTeams();
  const status = p.seasons.find((s) => s.year === p.season)?.status;
  return (
    <View style={{ height: 64, backgroundColor: D.nav, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 18, borderBottomColor: D.line, borderBottomWidth: 1 }}>
      <Pressable onPress={p.onBack}><Text style={{ color: D.dim, fontSize: 24 }}>‹</Text></Pressable>
      <Image source={require('../../assets/logo.png')} style={{ width: 40, height: 40, resizeMode: 'contain' }} />
      <Text style={{ fontFamily: FONT.display, color: D.text, fontSize: 22, letterSpacing: 1.5 }}>{leagueName.toUpperCase()}</Text>
      <View style={{ flexDirection: 'row', gap: 22, marginLeft: 10, alignSelf: 'stretch' }}>
        {TABS.map((t) => {
          const on = p.tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => p.setTab(t.key)}
              style={{ justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: on ? D.red : 'transparent' }}>
              <Text style={{ fontFamily: FONT.bodyBold, fontSize: 14, letterSpacing: 1, color: on ? D.text : D.dim2 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {p.seasons.map((s) => (
          <Pressable key={s.year} onPress={() => p.setSeason(s.year)}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: s.year === p.season ? D.gold : D.line, backgroundColor: D.panel }}>
            <Text style={{ color: D.text, fontFamily: FONT.display, fontStyle: 'italic', fontSize: 15 }}>
              {s.year} <Text style={{ color: s.status === 'live' ? D.green : D.gold, fontSize: 11, fontStyle: 'normal', fontFamily: FONT.bodyBold }}>{s.status === 'live' ? 'LIVE' : 'FINAL'}</Text>
            </Text>
          </Pressable>
        ))}
      </View>
      {p.commissioner && p.pushYear != null && (
        <Pressable onPress={p.onPush} style={{ paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: D.gold }}>
          <Text style={{ color: D.gold, fontFamily: FONT.bodyBold, fontSize: 12, letterSpacing: 1 }}>PUSH TO {p.pushYear} SEASON</Text>
        </Pressable>
      )}
      {p.commissioner && p.isLive && (
        <Pressable onPress={p.onUndo} style={{ paddingHorizontal: 10, paddingVertical: 7 }}>
          <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 12, letterSpacing: 1 }}>↶ UNDO</Text>
        </Pressable>
      )}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.live ? D.green : D.red }} />
      <Text style={{ color: D.dim, fontFamily: FONT.bodyBold, fontSize: 13, letterSpacing: 1 }}>{p.drafted}/{p.total} DRAFTED{status === 'live' ? '' : ''}</Text>
    </View>
  );
}
