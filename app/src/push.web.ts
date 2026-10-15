// Browser notifications (Web Push through a service worker). Same exports as push.ts for phones.
import { api } from './api';

export type PushState = { supported: boolean; reason?: string; permission: 'granted' | 'denied' | 'default' | 'unsupported'; enabled: boolean; configured: boolean };

const has = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
const keyBytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64u.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
async function registration() {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export async function getPushState(): Promise<PushState> {
  if (!has()) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    return { supported: false, permission: 'unsupported', enabled: false, configured: false,
      reason: ios ? 'On iPhone and iPad, add Pennant Race to your Home Screen first (Share → Add to Home Screen), then open it from there.' : 'This browser does not support notifications.' };
  }
  const cfg = await api.pushConfig().catch(() => null);
  const sub = await (await registration().catch(() => null))?.pushManager.getSubscription();
  return { supported: true, permission: Notification.permission, enabled: !!sub && Notification.permission === 'granted', configured: !!cfg?.web };
}

export async function enablePush(): Promise<void> {
  if (!has()) throw new Error('This browser does not support notifications.');
  const cfg = await api.pushConfig();
  if (!cfg.web) throw new Error('Notifications are not set up on the server yet (the commissioner needs to add the VAPID keys).');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.' : 'Permission was not granted.');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.web) }));
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.pushSubscribe({ kind: 'web', endpoint: j.endpoint, keys: j.keys });
}

export async function disablePush(): Promise<void> {
  if (!has()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Calls `fn(url)` when a notification is tapped while the app is already open. Returns an unsubscribe function. */
export function onNotificationOpen(fn: (url: string) => void): () => void {
  if (!has()) return () => {};
  const h = (e: MessageEvent) => { if (e.data?.type === 'open-url' && typeof e.data.url === 'string') fn(e.data.url); };
  navigator.serviceWorker.addEventListener('message', h);
  return () => navigator.serviceWorker.removeEventListener('message', h);
}
