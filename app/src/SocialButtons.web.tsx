import { useEffect, useRef, useState } from 'react';
import { createElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FONT } from './theme';
import { newNonce, type ProviderConfig, type SocialCredential } from './social';

type Props = { config: ProviderConfig; onCredential: (c: SocialCredential) => void; onError: (m: string) => void; disabled?: boolean };

const loaded = new Map<string, Promise<void>>();
const loadScript = (src: string) => {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => { loaded.delete(src); rej(new Error('Could not load the sign-in script')); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src)!;
};

// Window globals injected by Google's and Apple's scripts.
type G = { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } };
type A = { auth: { init: (o: object) => void; signIn: () => Promise<{ authorization: { id_token: string } }> } };

function GoogleButton({ clientId, onCredential, onError }: { clientId: string } & Omit<Props, 'config' | 'disabled'>) {
  const host = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let dead = false;
    const nonce = newNonce();
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      if (dead || !host.current) return;
      const g = (globalThis as unknown as { google: G }).google;
      g.accounts.id.initialize({
        client_id: clientId, nonce, ux_mode: 'popup', auto_select: false,
        callback: (r: { credential?: string }) => (r.credential ? onCredential({ provider: 'google', idToken: r.credential, nonce }) : onError('Google sign-in was cancelled')),
      });
      g.accounts.id.renderButton(host.current, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', width: 320 });
    }).catch((e) => !dead && onError(e instanceof Error ? e.message : 'Google sign-in is unavailable'));
    return () => { dead = true; };
  }, [clientId]);
  return <View style={{ alignItems: 'center', minHeight: 44 }}>{createElement('div', { ref: (el: HTMLElement | null) => { host.current = el; } })}</View>;
}

function AppleButton({ clientId, onCredential, onError, disabled }: { clientId: string } & Omit<Props, 'config'>) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      const nonce = newNonce();
      const apple = (globalThis as unknown as { AppleID: A }).AppleID;
      apple.auth.init({ clientId, scope: 'name email', redirectURI: window.location.origin, usePopup: true, nonce });
      const r = await apple.auth.signIn();
      onCredential({ provider: 'apple', idToken: r.authorization.id_token, nonce });
    } catch (e) {
      const code = (e as { error?: string })?.error;
      if (code !== 'popup_closed_by_user' && code !== 'user_cancelled_authorize') onError(e instanceof Error ? e.message : 'Apple sign-in failed');
    } finally { setBusy(false); }
  };
  return (
    <Pressable onPress={go} disabled={busy || disabled} style={{ height: 44, width: 320, maxWidth: '100%', alignSelf: 'center', borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
      <Text style={{ color: '#000', fontFamily: FONT.bodySemi, fontSize: 15 }}>  Continue with Apple</Text>
    </Pressable>
  );
}

export function SocialButtons({ config, ...p }: Props) {
  if (!config.google && !config.apple) return null;
  return (
    <View style={{ gap: 10, marginTop: 14 }}>
      {config.google && <GoogleButton clientId={config.google.clientId} onCredential={p.onCredential} onError={p.onError} />}
      {config.apple && <AppleButton clientId={config.apple.clientId} {...p} />}
    </View>
  );
}
