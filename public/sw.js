// Service worker: makes the app installable and lets it open without a
// signal (it keeps a copy of the app's own files, refreshed whenever there's
// a connection), shows phone notifications (such as fish waiting for the
// secretary) and opens the right page when one is tapped. Catches, points
// and other data always come from the server.

const CACHE = 'app-v3';
const APP_FILES = [
  '/', '/index.html', '/app.js', '/styles.css', '/scoring.js', '/rules.js', '/manifest.webmanifest',
  '/marlin.svg', '/logo.svg', '/jhmmc-logo.png', '/favicon.png', '/icon-192.png', '/icon-512.png',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The app's own files: from the network when there is one (so updates show at
// once) and kept for later; from the copy when there isn't. Pages of the app
// all load index.html. The species list and who's signed in are kept the same
// way, so the app (and Fish on) still opens at sea. Everything else (the API,
// photos) goes straight through.
const KEEP_API = ['/api/meta', '/api/me'];
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const page = req.mode === 'navigate';
  if (!page && !APP_FILES.includes(url.pathname) && !KEEP_API.includes(url.pathname)) return;
  const key = page ? '/index.html' : url.pathname;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(key, res.clone());
      }
      return res;
    } catch (err) {
      const copy = await caches.match(key);
      if (copy) return copy;
      throw err;
    }
  })());
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'West Africa Big Game', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.url || 'general',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      return client.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});
