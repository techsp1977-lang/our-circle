// First code to run. On the app's own address it starts the app.
// On the old shared GitHub Pages address it wipes this app's saved sign-in and offline data from that
// shared address (other sites there could read it), then sends people to the new address
// (only once the new address is live),
// keeping invite links (?join=…) and the screen they asked for (#/…).
import { FIREBASE } from './config.js';

export const HOME = 'https://our-circle-3da6a.web.app/';
const OLD_HOSTS = ['techsp1977-lang.github.io'];

// The journal's book typeface loads in the background; nothing waits for it.
function loadFonts() {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,500&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap';
  document.head.appendChild(l);
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

function deleteDb(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch (e) { resolve(); }
  });
}

// Remove only what belongs to Our Circle on the shared address.
export async function forgetThisAddress() {
  const jobs = [];
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    regs.filter((r) => new URL(r.scope).pathname.startsWith(location.pathname.replace(/[^/]*$/, ''))).forEach((r) => jobs.push(r.unregister()));
  } catch (e) {}
  try { jobs.push(caches.delete('our-circle-shell')); } catch (e) {}
  const names = new Set(['firebaseLocalStorageDb', `firestore/[DEFAULT]/${FIREBASE.projectId}/main`]);
  try { (await indexedDB.databases?.())?.forEach((d) => { if (d.name?.startsWith(`firestore/[DEFAULT]/${FIREBASE.projectId}`)) names.add(d.name); }); } catch (e) {}
  names.forEach((n) => jobs.push(deleteDb(n)));
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('oc-') || (k.startsWith('firebase:') && k.includes(FIREBASE.apiKey))).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch (e) {}
  await withTimeout(Promise.allSettled(jobs), 2000);
}

export function newAddress(loc = location, savedJoin = null) {
  const q = new URLSearchParams(loc.search);
  if (!q.get('join') && savedJoin) q.set('join', savedJoin);
  const qs = q.toString();
  return HOME + (qs ? '?' + qs : '') + (loc.hash || '');
}

async function moved() {
  let savedJoin = null;
  try { savedJoin = localStorage.getItem('oc-join'); } catch (e) {}
  const target = newAddress(location, savedJoin);
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  document.body.innerHTML = `<div class="auth"><div class="auth-card">
    <h1>Our Circle has a new address</h1>
    <p class="muted">The family app now lives at its own private address. Tap below and sign in once more.</p>
    <a class="btn wide" id="go" href="${target.replace(/"/g, '&quot;')}">Open Our Circle</a>
    ${installed ? '<p class="muted small">On your home screen: delete this old Our Circle icon, then in the new page tap Share → Add to Home Screen (iPhone) or ⋮ → Install app (Android).</p>' : ''}
  </div></div>`;
  await forgetThisAddress();
  if (!installed) location.replace(target);
}

function startHere() {
  loadFonts();
  import('./app.js').then((m) => m.start());
}

// Move only once the new address is really live (here.json answers there); otherwise keep working here.
async function newHomeIsLive() {
  try {
    const r = await withTimeout(fetch(HOME + 'here.json', { cache: 'no-store' }), 4000);
    return !!r?.ok && (await r.json()).app === 'our-circle';
  } catch (e) { return false; }
}

if (OLD_HOSTS.includes(location.hostname)) {
  newHomeIsLive().then((live) => (live ? moved() : startHere()));
} else {
  startHere();
}
