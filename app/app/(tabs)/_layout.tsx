import { useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth';
import { FONT, THEMES, useTheme, type ThemeName } from '../../src/theme';

// Nav bar and its icons/labels stay dark/white in every theme; only the active tab turns red.
const NAV_BG = '#0a1a30';
const ICONS = {
  team: require('../../assets/icons/roster.png'),
  matchup: require('../../assets/icons/matchups.png'),
  players: require('../../assets/icons/players.png'),
  league: require('../../assets/icons/standings.png'),
} as const;

function Header() {
  const { t, name, setTheme } = useTheme();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 16, backgroundColor: t.panel, borderBottomColor: t.line, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable onPress={() => setOpen(true)} hitSlop={12}><Text style={{ color: t.text, fontSize: 24 }}>☰</Text></Pressable>
      <Image source={require('../../assets/logo.png')} style={{ width: 38, height: 38, resizeMode: 'contain' }} />
      {/* Chat overlay is a later milestone. */}
      <Text style={{ color: t.dim2, fontSize: 22 }}>💬</Text>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setOpen(false)}>
          <View style={{ marginTop: insets.top + 50, marginLeft: 12, width: 240, backgroundColor: t.panel, borderColor: t.line, borderWidth: 1, borderRadius: t.radius.card, padding: 14 }}>
            <Text style={{ color: t.dim, fontFamily: FONT.bodySemi, fontSize: 12, letterSpacing: 1, marginBottom: 8 }}>THEME</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {(Object.keys(THEMES) as ThemeName[]).map((n) => (
                <Pressable key={n} onPress={() => setTheme(n)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: t.radius.chip, borderWidth: 1, borderColor: name === n ? t.red : t.line }}>
                  <Text style={{ color: t.text, fontFamily: FONT.bodySemi, textTransform: 'capitalize' }}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => { setOpen(false); router.push('/draft'); }} style={{ marginBottom: 14 }}>
              <Text style={{ color: t.text, fontFamily: FONT.bodyBold, fontSize: 15 }}>Draft Room (TV board)</Text>
            </Pressable>
            <Pressable onPress={() => { setOpen(false); signOut(); }}>
              <Text style={{ color: t.red, fontFamily: FONT.bodyBold, fontSize: 15 }}>Sign out</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function TabsLayout() {
  const { ready, me } = useAuth();
  const { t } = useTheme();
  if (!ready) return null;
  if (!me) return <Redirect href="/login" />;

  const tab = (title: string, key: keyof typeof ICONS) => ({
    title,
    tabBarIcon: ({ focused }: { focused: boolean }) => (
      <Image source={ICONS[key]} style={{ width: 24, height: 24, resizeMode: 'contain', tintColor: focused ? t.red : '#fff' }} />
    ),
  });

  return (
    <Tabs
      screenOptions={{
        header: () => <Header />,
        sceneStyle: { backgroundColor: t.bg },
        tabBarStyle: { backgroundColor: NAV_BG, borderTopColor: 'rgba(255,255,255,0.08)' },
        tabBarActiveTintColor: t.red,
        tabBarInactiveTintColor: '#fff',
        tabBarLabelStyle: { fontFamily: FONT.bodyBold, fontSize: 11, letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="team" options={tab('My Team', 'team')} />
      <Tabs.Screen name="matchup" options={tab('Matchup', 'matchup')} />
      <Tabs.Screen name="players" options={tab('Players', 'players')} />
      <Tabs.Screen name="league" options={tab('League', 'league')} />
    </Tabs>
  );
}
