// Pennant Race service worker: shows push notifications and opens the app when one is tapped.
// (It deliberately does no caching; the app always loads fresh.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Pennant Race', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    // If the app is open and visible, it already shows what happened live; don't also buzz a banner on top of it.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused) && d.tag !== 'test') return;
    await self.registration.showNotification(d.title || 'Pennant Race', {
      body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: '/push-icon.png', badge: '/push-icon.png',
      data: { url: d.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) { await win.focus(); win.postMessage({ type: 'open-url', url }); return; }   // the app is already open: it opens the right place itself
    await self.clients.openWindow(url);
  })());
});
