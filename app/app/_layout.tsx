import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SairaCondensed_700Bold, SairaCondensed_800ExtraBold } from '@expo-google-fonts/saira-condensed';
import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { BarlowSemiCondensed_700Bold } from '@expo-google-fonts/barlow-semi-condensed';
import { View } from 'react-native';
import { AuthProvider } from '../src/auth';
import { ThemeProvider, useTheme } from '../src/theme';

function Shell() {
  const { t, name } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={name === 'light' || name === 'network' ? 'dark' : 'light'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </View>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    SairaCondensed_700Bold, SairaCondensed_800ExtraBold,
    Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold,
    BarlowSemiCondensed_700Bold,
  });
  if (!loaded) return null;
  return (
    <ThemeProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ThemeProvider>
  );
}
