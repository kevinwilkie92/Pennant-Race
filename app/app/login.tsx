import { useEffect, useState } from 'react';
import { Image, ImageBackground, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Redirect } from 'expo-router';
import { api, setToken } from '../src/api';
import { useAuth } from '../src/auth';
import { saveItem } from '../src/storage';
import { FONT } from '../src/theme';

// Login always uses dark styling regardless of theme (README).
const C = { text: '#fff', dim: '#90a4bf', line: 'rgba(255,255,255,0.14)', red: '#e22634', card: 'rgba(10,26,48,0.86)' };

export default function Login() {
  const { me, signIn } = useAuth();
  const [mode, setMode] = useState<'in' | 'join'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [teamId, setTeamId] = useState('');
  const [teams, setTeams] = useState<{ id: string; name: string; owner: string; claimed: number }[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === 'join' && teams.length === 0) api.publicTeams().then(setTeams).catch(() => setErr('Could not reach the server'));
  }, [mode]);

  if (me) return <Redirect href="/team" />;

  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (mode === 'in') await signIn(email, password);
      else {
        const { token } = await api.register({ email, password, teamId, joinCode });
        setToken(token); await saveItem('prToken', token);
        await signIn(email, password); // refreshes `me`
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  const input = {
    backgroundColor: 'rgba(255,255,255,0.07)', borderColor: C.line, borderWidth: 1, borderRadius: 12,
    color: C.text, fontFamily: FONT.body, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  } as const;

  return (
    <ImageBackground source={require('../assets/stadium.png')} resizeMode="cover" style={{ flex: 1, backgroundColor: '#0a1a30' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', padding: 20, paddingBottom: 40 }}>
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <Image source={require('../assets/logo.png')} style={{ width: 120, height: 120, resizeMode: 'contain' }} />
            <Text style={{ fontFamily: FONT.display, fontStyle: 'italic', fontSize: 34, color: C.text, letterSpacing: 1 }}>PENNANT RACE</Text>
            <Text style={{ fontFamily: FONT.bodySemi, fontSize: 13, color: C.dim, letterSpacing: 3 }}>CARROLLTON ALL STARS</Text>
          </View>

          <View style={{ backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 18, maxWidth: 440, width: '100%', alignSelf: 'center' }}>
            <TextInput style={input} placeholder="Email" placeholderTextColor={C.dim} autoCapitalize="none" keyboardType="email-address"
              value={email} onChangeText={setEmail} />
            <View>
              <TextInput style={input} placeholder="Password" placeholderTextColor={C.dim} secureTextEntry={!show}
                value={password} onChangeText={setPassword} onSubmitEditing={submit} />
              <Pressable onPress={() => setShow(!show)} style={{ position: 'absolute', right: 14, top: 14 }}>
                <Text style={{ color: C.dim, fontFamily: FONT.bodySemi }}>{show ? 'HIDE' : 'SHOW'}</Text>
              </Pressable>
            </View>

            {mode === 'join' && (
              <>
                <TextInput style={input} placeholder="League join code" placeholderTextColor={C.dim} autoCapitalize="none"
                  value={joinCode} onChangeText={setJoinCode} />
                <Text style={{ color: C.dim, fontFamily: FONT.bodySemi, fontSize: 12, marginBottom: 6 }}>YOUR TEAM</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {teams.filter((t) => !t.claimed).map((t) => (
                    <Pressable key={t.id} onPress={() => setTeamId(t.id)}
                      style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: teamId === t.id ? C.red : C.line, backgroundColor: teamId === t.id ? 'rgba(226,38,52,0.18)' : 'transparent' }}>
                      <Text style={{ color: C.text, fontFamily: FONT.bodyMedium, fontSize: 13 }}>{t.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {!!err && <Text style={{ color: '#ec3b48', fontFamily: FONT.bodyMedium, marginBottom: 10 }}>{err}</Text>}

            <Pressable onPress={submit} disabled={busy}
              style={{ backgroundColor: C.red, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontFamily: FONT.display, fontSize: 18, letterSpacing: 1 }}>{mode === 'in' ? 'SIGN IN' : 'JOIN LEAGUE'}</Text>
            </Pressable>

            {/* Google / Apple sign-in are planned; they need OAuth client IDs configured on the API. */}
            <Pressable onPress={() => { setErr(''); setMode(mode === 'in' ? 'join' : 'in'); }} style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={{ color: C.dim, fontFamily: FONT.bodySemi }}>
                {mode === 'in' ? 'New here? Join with your league code' : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}
