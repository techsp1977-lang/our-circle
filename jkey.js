// Journal lock: end-to-end encryption for one person's journal and goals.
//
// A random journal key (AES-256-GCM) scrambles every page and goal on the phone before it's saved. That key is
// stored only in "wrapped" (itself encrypted) form in journals/{uid}.lock, twice:
//   - wrapped with the journal password (PBKDF2-SHA-256, many rounds, so each guess is slow), and
//   - wrapped with a one-time recovery code shown at setup.
// The server, Google and the app's owner only ever see scrambled text. Each phone remembers the unlocked key
// (as a key the browser won't let anyone read out) until sign-out. Forget the password and the recovery code,
// and the journal can't be recovered by anyone.
import * as S from './store.js';

const ITER = 600000;          // password → key rounds (slows guessing; about a second on a phone)
const RECOVERY_ITER = 100000; // the recovery code is long and random, so fewer rounds are plenty
export const MIN_PASSWORD = 4;

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// ───────── remembered on this phone (IndexedDB holds the key object; it can't be read out) ─────────
const DB = 'oc-journal-key', STORE = 'keys';
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const r = fn(t.objectStore(STORE)); t.oncomplete = () => { db.close(); res(r?.result); }; t.onerror = () => rej(t.error); });
}
const memory = new Map(); // uid → CryptoKey for this visit
async function remember(uid, key) { memory.set(uid, key); try { await idbDo('readwrite', (s) => s.put(key, uid)); } catch (e) { /* private browsing: kept for this visit only */ } }
export async function deviceKey(uid) {
  if (memory.has(uid)) return memory.get(uid);
  try { const k = await idbDo('readonly', (s) => s.get(uid)); if (k) memory.set(uid, k); return k || null; } catch (e) { return null; }
}
export async function forgetDevice(uid) { memory.delete(uid); try { await idbDo('readwrite', (s) => s.delete(uid)); } catch (e) {} }
// Signing out of a phone forgets the unlocked key there.
S.beforeSignOut.add(async () => { const uid = S.auth.uid(); if (uid) await forgetDevice(uid); });

// ───────── keys ─────────
async function stretch(secret, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrap(raw, kek) { const iv = rand(12); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw)) }; }
async function unwrap(w, kek) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, kek, unb64(w.ct))); }
const useKey = (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const normPw = (p) => String(p || '').normalize('NFC').trim();

// 20 characters from an easy-to-read alphabet (no 0/O, 1/I): about 100 bits, shown as five groups of four.
function newRecoveryCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const s = Array.from(rand(20), (b) => abc[b % 32]).join('');
  return s.match(/.{4}/g).join('-');
}

// What's stored in journals/{uid}: { lock: { v, salt, iter, byPassword, rsalt, riter, byRecovery, at } }
const lockOf = async (uid) => (await S.get(`journals/${uid}`).catch(() => null))?.lock || null;
export const isLocked = async (uid) => !!(await lockOf(uid));

// Turn the lock on. Returns the recovery code to show once. (fresh: replace a lock after Start over.)
export async function setUp(uid, password, { fresh = false } = {}) {
  if (normPw(password).length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  if (!fresh && await lockOf(uid)) throw new Error('This journal is already locked.');
  const raw = rand(32), salt = rand(16), rsalt = rand(16), code = newRecoveryCode();
  const lock = {
    v: 1, iter: ITER, riter: RECOVERY_ITER, salt: b64(salt), rsalt: b64(rsalt),
    byPassword: await wrap(raw, await stretch(normPw(password), salt, ITER)),
    byRecovery: await wrap(raw, await stretch(normCode(code), rsalt, RECOVERY_ITER)),
    at: Date.now(),
  };
  const key = await useKey(raw);
  await S.set(`journals/${uid}`, { lock }, true);
  await remember(uid, key);
  return code;
}

// Unlock this phone with the journal password (or the recovery code). Resolves true when it worked.
export async function unlock(uid, password) {
  const l = await lockOf(uid); if (!l) return true;
  try { const raw = await unwrap(l.byPassword, await stretch(normPw(password), unb64(l.salt), l.iter)); await remember(uid, await useKey(raw)); return true; }
  catch (e) { return false; }
}
// Forgot the password: the recovery code unlocks, and a new password is set.
export async function recover(uid, code, newPassword) {
  if (normPw(newPassword).length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  const l = await lockOf(uid); if (!l) return true;
  let raw;
  try { raw = await unwrap(l.byRecovery, await stretch(normCode(code), unb64(l.rsalt), l.riter)); } catch (e) { return false; }
  await rewrap(uid, l, raw, newPassword);
  await remember(uid, await useKey(raw));
  return true;
}
// Change the password (needs the current one, so a phone left unlocked can't change it).
export async function changePassword(uid, current, next) {
  if (normPw(next).length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  const l = await lockOf(uid);
  let raw;
  try { raw = await unwrap(l.byPassword, await stretch(normPw(current), unb64(l.salt), l.iter)); } catch (e) { return false; }
  await rewrap(uid, l, raw, next);
  return true;
}
async function rewrap(uid, l, raw, password) {
  const salt = rand(16);
  await S.set(`journals/${uid}`, { lock: { ...l, salt: b64(salt), iter: ITER, byPassword: await wrap(raw, await stretch(normPw(password), salt, ITER)), at: Date.now() } }, true);
}
// A new recovery code (needs the password). The old code stops working.
export async function newRecovery(uid, password) {
  const l = await lockOf(uid);
  let raw;
  try { raw = await unwrap(l.byPassword, await stretch(normPw(password), unb64(l.salt), l.iter)); } catch (e) { return null; }
  const code = newRecoveryCode(), rsalt = rand(16);
  await S.set(`journals/${uid}`, { lock: { ...l, rsalt: b64(rsalt), riter: RECOVERY_ITER, byRecovery: await wrap(raw, await stretch(normCode(code), rsalt, RECOVERY_ITER)), at: Date.now() } }, true);
  return code;
}

// Lost both the password and the recovery code: no one can open the old pages, so erase them and the goals,
// and lock the journal again with a new password. Returns the new recovery code.
export async function startOver(uid, newPassword) {
  if (normPw(newPassword).length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  const [entries, goals] = await Promise.all([S.getColl(`journals/${uid}/entries`), S.getColl(`journals/${uid}/goals`)]);
  for (const e of entries) await S.del(`journals/${uid}/entries/${e.id}`);
  for (const g of goals) await S.del(`journals/${uid}/goals/${g.id}`);
  await forgetDevice(uid);
  return setUp(uid, newPassword, { fresh: true });
}

// ───────── scrambling pages and goals ─────────
// The document's own path is bound in, so a scrambled page can't be moved to another day or account unnoticed.
export async function seal(key, path, value) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(path) }, key, enc.encode(JSON.stringify(value)));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}
export async function open(key, path, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(path) }, key, unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}
