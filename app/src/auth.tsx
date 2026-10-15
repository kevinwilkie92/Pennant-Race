import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, type Me } from './api';
import { loadItem, saveItem } from './storage';

type AuthState = {
  ready: boolean;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;   // re-read your account and team (after renaming, new logo…)
};
const Ctx = createContext<AuthState>({ ready: false, me: null, signIn: async () => {}, signOut: async () => {}, refresh: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    (async () => {
      const t = await loadItem('prToken');
      if (t) {
        setToken(t);
        try { setMe(await api.me()); } catch { setToken(null); await saveItem('prToken', null); }
      }
      setReady(true);
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { token } = await api.login(email, password);
    setToken(token);
    await saveItem('prToken', token);
    setMe(await api.me());
  };
  const signOut = async () => {
    try { await api.logout(); } catch { /* token may already be invalid */ }
    setToken(null);
    await saveItem('prToken', null);
    setMe(null);
  };
  const refresh = async () => { try { setMe(await api.me()); } catch { /* keep what we have */ } };
  return <Ctx.Provider value={{ ready, me, signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
