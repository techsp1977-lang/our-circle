// Opens the app instantly from the copy saved on the phone. Each time the app is opened,
// it downloads the newest version of every file in the background and swaps the whole set
// in at once, so the next open has your latest update (never a mix of old and new files).
// Firebase traffic (messages, photos, sign-in) is never touched here.
const CACHE = 'our-circle-shell';
const SHELL = ['./index.html', './start.js', './apple-tokens.css', './app.css', './app.js', './config.js', './store.js', './ui.js', './themes.js', './dates.js',
  './events.js', './crop.js', './lock.js', './push.js', './photos.js', './jkey.js', './plans.js', './admin.js', './calendar.js', './circles.js', './hub.js', './chats.js', './album.js', './journal.js', './me.js', './manage.js', './demo-seed.js',
  './manifest.webmanifest', './oc-icon-192.png'];

async function refreshAll() {
  const fresh = await Promise.all(SHELL.map((p) => fetch(p, { cache: 'no-cache' }).then((r) => (r.ok ? [p, r] : null)).catch(() => null)));
  if (fresh.some((x) => !x)) return; // offline or a file failed: keep the complete old set
  const cache = await caches.open(CACHE);
  const hadOld = !!(await cache.match('./index.html'));
  // Did anything change since the saved copy? (Compared by content, so it works with or without ETags.)
  const same = await Promise.all(fresh.map(async ([p, r]) => {
    const old = await cache.match(p);
    return !!old && (await old.text()) === (await r.clone().text());
  }));
  await Promise.all(fresh.map(([p, r]) => cache.put(p, r)));
  // Tell the open app a newer version is saved, so it can switch to it right away instead of next time.
  if (hadOld && same.includes(false)) {
    (await self.clients.matchAll({ type: 'window' })).forEach((c) => c.postMessage({ type: 'updated' }));
  }
}

self.addEventListener('install', (e) => { e.waitUntil(refreshAll().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Videos stream straight from the web (phones fetch them in pieces).
  if (e.request.headers.has('range') || /\.(mp4|webm|mov)$/i.test(u.pathname)) return;
  // Only opening the app itself (its folder or index.html) gets the saved app. Anything else opened directly,
  // like /about, an icon or a photo link, comes from the web as normal.
  const isPage = e.request.mode === 'navigate' && /\/(index\.html)?$/.test(u.pathname);
  if (e.request.mode === 'navigate' && !isPage) return;
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

// ───────── Phone notifications for new messages ─────────
// The server sends { title, body, tag, url }. iPhone requires every push to show a notification.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { body: e.data?.text?.() || '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Our Circle', {
      body: d.body || 'New message',
      tag: d.tag || 'our-circle',
      renotify: true,
      icon: './oc-icon-192.png',
      badge: './oc-icon-192.png',
      data: { url: d.url || '#/chats' },
    });
    try { await self.navigator.setAppBadge?.(); } catch (er) {}
    // An open app updates its own unread dot and banner from the database; tell it to refresh the badge.
    (await self.clients.matchAll({ type: 'window' })).forEach((c) => c.postMessage({ type: 'push' }));
  })());
});

// Tapping a notification opens that chat, in the open app if there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = String(e.notification.data?.url || '#/chats');
  const target = new URL('./' + (hash.startsWith('#') ? hash : '#/chats'), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (w) { await w.focus(); w.postMessage({ type: 'open', hash }); return; }
    await self.clients.openWindow(target);
  })());
});
