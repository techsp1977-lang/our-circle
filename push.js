// Phone notifications for new messages, on this device.
// Turning them on asks the phone for permission and saves where to reach this phone in users/{you}.pushSubs
// (only you and the notify function can read it). Turning them off, or signing out, removes it.
// On iPhone this only works in the Home Screen app (Share → Add to Home Screen), iOS 16.4 or later.
import * as S from './store.js';
import { icon } from './ui.js';

const LOCAL = 'oc-push'; // { uid, id } this phone's entry in pushSubs

const read = () => { try { return JSON.parse(localStorage.getItem(LOCAL) || 'null'); } catch (e) { return null; } };
const write = (v) => { try { v ? localStorage.setItem(LOCAL, JSON.stringify(v)) : localStorage.removeItem(LOCAL); } catch (e) {} };
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export const pushSupported = () => !S.isDemo && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register('./sw.js');
}
async function subId(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const keyBytes = (b64u) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4)), (c) => c.charCodeAt(0));

// 'on' | 'off' | 'blocked' | 'install' (iPhone, not opened from the Home Screen) | 'unsupported'
let cached = null; // the last state checked on this phone, for the "turn on notifications" card
export const cachedPush = () => cached;
export async function pushState(uid) { cached = await pushStateNow(uid); return cached; }
async function pushStateNow(uid) {
  if (!pushSupported()) return isApple() && !installed() && !S.isDemo ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const mine = read();
  if (!mine || mine.uid !== uid || Notification.permission !== 'granted') return 'off';
  try { return (await (await registration()).pushManager.getSubscription()) ? 'on' : 'off'; } catch (e) { return 'off'; }
}

// The server's public key, fetched ahead of the tap (iPhone wants the permission request straight from a tap).
let keyPromise = null;
export function prepareKey() {
  if (pushSupported() && !keyPromise) { keyPromise = S.callFn('notify', { action: 'publicKey' }); keyPromise.catch(() => { keyPromise = null; }); }
  return keyPromise;
}

export async function turnOnPush(uid) {
  const { publicKey } = await (prepareKey() || Promise.reject(new Error('Notifications are not available here')));
  const reg = await registration();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const j = sub.toJSON();
  const id = await subId(j.endpoint);
  await S.set(`users/${uid}`, { pushSubs: { [id]: { endpoint: j.endpoint, keys: j.keys, device: isApple() ? 'iPhone' : (navigator.userAgentData?.platform || 'browser'), at: Date.now() } } }, true);
  write({ uid, id });
}

export async function turnOffPush(uid) {
  const mine = read();
  if (mine?.uid === uid) await S.removeField(`users/${uid}`, `pushSubs.${mine.id}`).catch(() => {});
  try { await (await (await registration()).pushManager.getSubscription())?.unsubscribe(); } catch (e) {}
  write(null);
}

// Signing out stops this phone's notifications, so message previews never reach a signed-out phone.
S.beforeSignOut.add(async () => {
  const mine = read();
  if (mine && S.auth.uid() === mine.uid) await turnOffPush(mine.uid);
});

// The number on the Home Screen icon: how many chats have unread messages.
let lastBadge = -1;
export function setBadge(n) {
  if (n === lastBadge) return;
  lastBadge = n;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch (e) {}
}

// Keep this phone's notifications working: phones (iPhones especially) sometimes renew or drop their push
// address, and a phone that stopped getting pushes was also removed on the server. Each time the app opens with
// notifications allowed, save the current address again (or get a new one).
export async function keepPushFresh(uid) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const mine = read();
  if (!mine || mine.uid !== uid) return;
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { await turnOnPush(uid); return; }
    const j = sub.toJSON(), id = await subId(j.endpoint);
    await S.set(`users/${uid}`, { pushSubs: { [id]: { endpoint: j.endpoint, keys: j.keys, device: isApple() ? 'iPhone' : (navigator.userAgentData?.platform || 'browser'), at: Date.now() } } }, true);
    if (id !== mine.id) { await S.removeField(`users/${uid}`, `pushSubs.${mine.id}`).catch(() => {}); write({ uid, id }); }
  } catch (e) { console.warn('Could not refresh notifications', e); }
}

// ───────── the "turn on notifications" card ─────────
// Asked once the person knows the app (from the second time they open it), never on the first open. "Not now"
// waits two weeks and asks once more; after that it's only on My page. On an iPhone in Safari it explains the
// Home Screen step instead, since notifications only work there.
const ASK = 'oc-push-ask', OPENS = 'oc-opens';
const getJ = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const setJ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let counted = false;
export function countOpen() { if (counted) return; counted = true; setJ(OPENS, getJ(OPENS, 0) + 1); }
function wantsAsk() {
  const a = getJ(ASK, { n: 0, until: 0 });
  return getJ(OPENS, 0) >= 2 && a.n < 2 && Date.now() > a.until;
}
export function pushCard() {
  if (!(cached === 'off' || cached === 'install') || !wantsAsk()) return '';
  if (cached === 'install') return `<section class="block"><div class="card push-card">
      <span class="push-ic" aria-hidden="true">${icon('bell', 22)}</span>
      <div class="push-main"><b>Get a notification when family texts you</b>
        <p>On iPhone, notifications work in the Home Screen app: tap Share, then <b>Add to Home Screen</b>, and open Our Circle from there.</p>
        <div class="push-btns"><button class="btn sm ghost" data-act="push-later">Not now</button></div></div></div></section>`;
  prepareKey();
  return `<section class="block"><div class="card push-card">
      <span class="push-ic" aria-hidden="true">${icon('bell', 22)}</span>
      <div class="push-main"><b>Get a notification when family texts you</b>
        <p>We'll let you know on this phone when someone messages the whole family, your household, or you. Turn it off any time on My page.</p>
        <div class="push-btns"><button class="btn sm" data-act="push-yes">Turn on</button><button class="btn sm ghost" data-act="push-later">Not now</button></div></div></div></section>`;
}
// Handles the card's buttons; returns true if the click was one of them. rerender() redraws the page.
export async function pushCardClick(e, uid, rerender, toast) {
  const b = e.target.closest('[data-act="push-yes"], [data-act="push-later"]');
  if (!b) return false;
  if (b.dataset.act === 'push-later') {
    const a = getJ(ASK, { n: 0, until: 0 }); setJ(ASK, { n: a.n + 1, until: Date.now() + 14 * 864e5 });
    rerender(); return true;
  }
  b.disabled = true;
  try {
    await turnOnPush(uid);
    toast?.('Notifications are on for this phone.');
  } catch (er) {
    toast?.(Notification.permission === 'denied' ? "Notifications are blocked for Our Circle. Turn them on in your phone's Settings → Notifications." : "Notifications couldn't be turned on. Try again from My page.", 8000);
  }
  await pushState(uid); rerender(); return true;
}

// "Send me a test notification": asks the server to push to this person's phones, and says in plain words
// which step is broken if it doesn't work. Returns { ok, text }.
export async function testPush(uid) {
  let r;
  try { r = await S.callFn('notify', { action: 'test' }); }
  catch (e) {
    const code = String(e?.code || '').replace('functions/', '');
    if (code === 'resource-exhausted') return { ok: false, text: 'Wait a few seconds before sending another test.' };
    if (code === 'unauthenticated') return { ok: false, text: 'Sign in again, then try the test.' };
    return { ok: false, text: "The notification server didn't answer. The circle's owner needs to finish the one-time \"Message notifications\" setup (SETUP.md). Check your connection too." };
  }
  const mine = read();
  const mineFailed = r.failed?.find((f) => f.subId === mine?.id);
  if (mineFailed && (mineFailed.code === 404 || mineFailed.code === 410)) {
    // Apple or Google forgot this phone: sign it up again and try once more.
    try { await turnOnPush(uid); r = await S.callFn('notify', { action: 'test' }).catch(() => r); } catch (e) {}
  }
  if (!r.phones) return { ok: false, text: "This phone isn't signed up for notifications on the server yet. Tap Turn off, then Turn on again." };
  if (!r.sent) {
    const f = r.failed?.[0];
    return { ok: false, text: `The notification couldn't be delivered${f?.code ? ` (error ${f.code})` : ''}. Tap Turn off, then Turn on again, and try once more.` };
  }
  return { ok: true, text: isApple()
    ? 'Sent! It should pop up within a few seconds, even with the app closed. If it doesn\'t: iPhone Settings → Notifications → Our Circle → turn on Allow Notifications, Lock Screen and Banners, and check Focus/Do Not Disturb is off.'
    : 'Sent! It should pop up within a few seconds. If it doesn\'t, check this device allows notifications from Our Circle.' };
}
