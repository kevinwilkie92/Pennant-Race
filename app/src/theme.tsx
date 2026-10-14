import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadItem, saveItem } from './storage';

export type ThemeName = 'dark' | 'light' | 'broadcast' | 'network';

export type Tokens = {
  bg: string; panel: string; card: string; card2: string; line: string;
  text: string; dim: string; dim2: string;
  red: string; redSoft: string; green: string; gold: string; blue: string; loss: string;
  radius: { chip: number; button: number; card: number };
  display: 'italic' | 'normal';
  upper: boolean;
};

const accents = { red: '#e22634', redSoft: '#ec3b48', green: '#33b06a', gold: '#d19a1f', blue: '#3b74d6', loss: '#ec3b48' };

export const THEMES: Record<ThemeName, Tokens> = {
  dark: {
    bg: '#0a1a30', panel: '#0d2342', card: 'rgba(255,255,255,0.045)', card2: 'rgba(255,255,255,0.07)',
    line: 'rgba(255,255,255,0.08)', text: '#ffffff', dim: '#90a4bf', dim2: '#5f7d9c',
    ...accents, radius: { chip: 8, button: 12, card: 15 }, display: 'italic', upper: false,
  },
  light: {
    bg: '#eef2f7', panel: '#ffffff', card: 'rgba(14,32,56,0.05)', card2: 'rgba(14,32,56,0.08)',
    line: 'rgba(14,32,56,0.13)', text: '#12233d', dim: '#5a6b80', dim2: '#8a99ab',
    ...accents, radius: { chip: 8, button: 12, card: 15 }, display: 'italic', upper: false,
  },
  broadcast: {
    bg: '#0b0d11', panel: '#12151b', card: '#161a22', card2: '#1c212b',
    line: 'rgba(255,255,255,0.08)', text: '#ffffff', dim: '#a3aab5', dim2: '#6f7782',
    ...accents, radius: { chip: 5, button: 5, card: 5 }, display: 'normal', upper: false,
  },
  network: {
    bg: '#eceef1', panel: '#ffffff', card: '#ffffff', card2: '#f3f4f6',
    line: 'rgba(17,20,24,0.12)', text: '#111418', dim: '#565d69', dim2: '#868d97',
    ...accents, radius: { chip: 2, button: 2, card: 2 }, display: 'normal', upper: true,
  },
};

/** Position colours (README). */
export const POS_COLOR = { IF: '#2bb0c4', OF: '#5fbf6f', SP: '#8a7dff', RP: '#e08a3b' } as const;

export const FONT = {
  display: 'SairaCondensed_800ExtraBold',
  displayBold: 'SairaCondensed_700Bold',
  body: 'Barlow_400Regular',
  bodyMedium: 'Barlow_500Medium',
  bodySemi: 'Barlow_600SemiBold',
  bodyBold: 'Barlow_700Bold',
  num: 'BarlowSemiCondensed_700Bold',
} as const;

type Ctx = { name: ThemeName; t: Tokens; setTheme: (n: ThemeName) => void };
const ThemeCtx = createContext<Ctx>({ name: 'dark', t: THEMES.dark, setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<ThemeName>('dark');
  useEffect(() => {
    loadItem('prTheme').then((v) => { if (v && v in THEMES) setName(v as ThemeName); });
  }, []);
  const setTheme = (n: ThemeName) => { setName(n); saveItem('prTheme', n); };
  return <ThemeCtx.Provider value={{ name, t: THEMES[name], setTheme }}>{children}</ThemeCtx.Provider>;
}
export const useTheme = () => useContext(ThemeCtx);
