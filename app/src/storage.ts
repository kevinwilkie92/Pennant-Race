import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore on native, localStorage on web. Never throws (private windows, blocked storage, etc.).
export async function loadItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch { return null; }
}
export async function saveItem(key: string, value: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (value == null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value);
      return;
    }
    if (value == null) await SecureStore.deleteItemAsync(key); else await SecureStore.setItemAsync(key, value);
  } catch { /* ignore */ }
}
