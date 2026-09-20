// WorkBook service worker: push notifications + click-through, and a cache for the big vendored files
// (KaTeX, fonts, icons). App code and API calls always go to the network so updates land instantly.
const CACHE = 'dwb-static-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const cacheable = e.request.method === 'GET' && (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/') || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'cdnjs.cloudflare.com');
  if (!cacheable) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;
    try { const res = await fetch(e.request); if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone()); return res; } catch (err) { return hit || Response.error(); }
  })());
});
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
