import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { FONT } from './theme';
import { newNonce, type ProviderConfig, type SocialCredential } from './social';

WebBrowser.maybeCompleteAuthSession();

type Props = { config: ProviderConfig; onCredential: (c: SocialCredential) => void; onError: (m: string) => void; disabled?: boolean };

const pill = { height: 44, width: 320, maxWidth: '100%', alignSelf: 'center', borderRadius: 22, alignItems: 'center', justifyContent: 'center' } as const;

function GoogleButton({ clientId, onCredential, onError, disabled }: { clientId: string } & Omit<Props, 'config'>) {
  // Native apps use their own OAuth client IDs (created per platform in Google Cloud); the API accepts all of them.
  const [request, response, prompt] = Google.useIdTokenAuthRequest({
    clientId,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });
  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params.id_token;
      const nonce = request?.extraParams?.nonce;
      if (idToken && nonce) onCredential({ provider: 'google', idToken, nonce });
      else onError('Google did not return a sign-in token');
    } else if (response.type === 'error') onError(response.error?.message ?? 'Google sign-in failed');
  }, [response]);
  return (
    <Pressable onPress={() => prompt()} disabled={!request || disabled} style={[pill, { backgroundColor: '#131314', borderWidth: 1, borderColor: '#8e918f', opacity: request ? 1 : 0.5 }]}>
      <Text style={{ color: '#e3e3e3', fontFamily: FONT.bodySemi, fontSize: 15 }}>Continue with Google</Text>
    </Pressable>
  );
}

function AppleButton({ onCredential, onError, disabled }: Omit<Props, 'config'>) {
  const go = async () => {
    try {
      const raw = newNonce();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
      const r = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (r.identityToken) onCredential({ provider: 'apple', idToken: r.identityToken, nonce: raw });
      else onError('Apple did not return a sign-in token');
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') onError(e instanceof Error ? e.message : 'Apple sign-in failed');
    }
  };
  return (
    <Pressable onPress={go} disabled={disabled} style={[pill, { backgroundColor: '#fff' }]}>
      <Text style={{ color: '#000', fontFamily: FONT.bodySemi, fontSize: 15 }}>  Continue with Apple</Text>
    </Pressable>
  );
}

export function SocialButtons({ config, ...p }: Props) {
  const [appleOk, setAppleOk] = useState(false);
  useEffect(() => { if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleOk).catch(() => {}); }, []);
  const apple = config.apple && appleOk;
  if (!config.google && !apple) return null;
  return (
    <View style={{ gap: 10, marginTop: 14 }}>
      {config.google && <GoogleButton clientId={config.google.clientId} onCredential={p.onCredential} onError={p.onError} disabled={p.disabled} />}
      {apple && <AppleButton onCredential={p.onCredential} onError={p.onError} disabled={p.disabled} />}
    </View>
  );
}
