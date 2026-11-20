// Phone notifications for new messages, on this device.
// Turning them on asks the phone for permission and saves where to reach this phone in users/{you}.pushSubs
// (only you and the notify function can read it). Turning them off, or signing out, removes it.
// On iPhone this only works in the Home Screen app (Share → Add to Home Screen), iOS 16.4 or later.
import * as S from './store.js';

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
export async function pushState(uid) {
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
