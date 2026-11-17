// Opens the app instantly from the copy saved on the phone. Each time the app is opened,
// it downloads the newest version of every file in the background and swaps the whole set
// in at once, so the next open has your latest update (never a mix of old and new files).
// Firebase traffic (messages, photos, sign-in) is never touched here.
const CACHE = 'our-circle-shell';
const SHELL = ['./index.html', './start.js', './apple-tokens.css', './app.css', './app.js', './config.js', './store.js', './ui.js', './dates.js',
  './events.js', './crop.js', './hub.js', './chats.js', './album.js', './journal.js', './me.js', './manage.js', './demo-seed.js',
  './manifest.webmanifest', './oc-icon-192.png'];

async function refreshAll() {
  const fresh = await Promise.all(SHELL.map((p) => fetch(p, { cache: 'no-cache' }).then((r) => (r.ok ? [p, r] : null)).catch(() => null)));
  if (fresh.some((x) => !x)) return; // offline or a file failed: keep the complete old set
  const cache = await caches.open(CACHE);
  await Promise.all(fresh.map(([p, r]) => cache.put(p, r)));
}

self.addEventListener('install', (e) => { e.waitUntil(refreshAll().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const isPage = e.request.mode === 'navigate';
  const key = isPage ? './index.html' : './' + u.pathname.split('/').pop();
  e.respondWith((async () => {
    const saved = await caches.match(key, { ignoreSearch: true });
    if (saved) {
      if (isPage) e.waitUntil(refreshAll());
      return saved;
    }
    return fetch(e.request);
  })());
});
