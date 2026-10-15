// Phone notifications (Expo push). Same exports as push.web.ts for browsers. Needs a development or production build
// (not Expo Go) and an EAS project id in app.json → expo.extra.eas.projectId.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

export type PushState = { supported: boolean; reason?: string; permission: 'granted' | 'denied' | 'default' | 'unsupported'; enabled: boolean; configured: boolean };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const projectId = () => (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
let cached: string | null = null;

export async function getPushState(): Promise<PushState> {
  const p = await Notifications.getPermissionsAsync();
  const permission = p.granted ? 'granted' : p.canAskAgain ? 'default' : 'denied';
  return { supported: true, permission, enabled: !!cached && p.granted, configured: !!projectId(), reason: projectId() ? undefined : 'This build has no Expo project id, so phone notifications cannot register yet.' };
}

export async function enablePush(): Promise<void> {
  const id = projectId();
  if (!id) throw new Error('This build has no Expo project id (app.json → expo.extra.eas.projectId), so phone notifications cannot register.');
  let p = await Notifications.getPermissionsAsync();
  if (!p.granted) p = await Notifications.requestPermissionsAsync();
  if (!p.granted) throw new Error('Notifications are blocked. Turn them on for Pennant Race in your phone settings.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Pennant Race', importance: Notifications.AndroidImportance.DEFAULT });
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
  cached = data;
  await api.pushSubscribe({ kind: 'expo', endpoint: data });
}

export async function disablePush(): Promise<void> {
  if (!cached) return;
  await api.pushUnsubscribe(cached).catch(() => {});
  cached = null;
}

/** Calls `fn(url)` when a notification is tapped. Returns an unsubscribe function. */
export function onNotificationOpen(fn: (url: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = (r.notification.request.content.data as { url?: string } | undefined)?.url;
    if (typeof url === 'string') fn(url);
  });
  return () => sub.remove();
}
