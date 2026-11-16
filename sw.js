// Lets the app install to the home screen and open quickly. Always tries the network first,
// so updates you publish show up right away; falls back to the saved copy when offline.
const CACHE = 'our-circle-v1';
const SHELL = ['./', './index.html', './css/app.css', './js/app.js', './js/store.js', './js/ui.js', './js/dates.js', './js/events.js', './js/config.js',
  './js/views/hub.js', './js/views/chats.js', './js/views/album.js', './js/views/journal.js', './js/views/me.js', './js/views/manage.js', './manifest.webmanifest', './icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // never touch Firebase traffic
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
