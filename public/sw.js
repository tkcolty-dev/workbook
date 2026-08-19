// WorkBook service worker: push notifications + click-through. (No offline caching — keeps updates instant.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let data = {}; try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'WorkBook', body: e.data && e.data.text() }; }
  const title = data.title || 'WorkBook';
  e.waitUntil(self.registration.showNotification(title, { body: data.body || '', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: data.tag || undefined, renotify: !!data.tag, data: { url: data.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
