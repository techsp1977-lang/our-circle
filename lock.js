// Face ID on this phone: passkey sign-in, and an optional lock when the app opens.
//
// Sign in with Face ID: "Set up Face ID sign-in" (My page) saves a passkey for your account in this phone's
// passwords. The sign-in screen's "Sign in with Face ID" proves you hold it; the passkey function checks the
// proof and hands back a one-time sign-in token.
//
// Lock: when turned on, the app asks for Face ID before showing anything when it opens and after a minute
// away. "Use password instead" signs out, so the lock can't be skipped without the account password.
//
// iPhone only allows Face ID when it starts straight from a tap, so the server's part of each request is
// fetched ahead of time ("prepared") and the tap goes straight to Face ID.
import * as S from './store.js';
import { icon } from './ui.js';

const PASSKEY = 'oc-passkey';   // { uid, id } the passkey saved on this phone
const LOCK = 'oc-lock2';        // { uid } lock turned on for this account on this phone
const AWAY_MS = 60 * 1000;
const PREP_MS = 4 * 60 * 1000;  // server challenges last 5 minutes

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch (e) {} };

export const faceLabel = () => (/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'Face ID' : 'fingerprint or face');
export const hasPasskey = (uid) => { const v = read(PASSKEY); return !!(v && v.uid === uid && v.id); };
export const lockOn = (uid) => hasPasskey(uid) && read(LOCK)?.uid === uid;
export const webauthnSupported = () => !S.isDemo && !!window.PublicKeyCredential && !!navigator.credentials;

// Does this device have Face ID / Touch ID / fingerprint that a web page can use?
export async function faceAvailable() {
  try { return webauthnSupported() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch (e) { return false; }
}

// Plain-words reason when the phone refuses.
export function explain(e) {
  const name = e?.name || '', msg = e?.message || String(e || '');
  const code = String(e?.code || '');
  if (code === 'functions/internal' || code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return `The ${faceLabel()} service didn't answer properly. Sign in with your password for now, and try again in a few minutes. (${code.replace('functions/', '')})`;
  }
  if (code.startsWith('functions/')) return msg;
  if (name === 'NotAllowedError') return `${faceLabel()} was cancelled or not allowed. On iPhone, check Settings → [your name] → iCloud → Passwords & Keychain is on, then try again. (NotAllowedError)`;
  if (name === 'InvalidStateError') return `${faceLabel()} sign-in is already set up on this phone. (InvalidStateError)`;
  if (name === 'SecurityError') return `This address isn't allowed to use ${faceLabel()}. (SecurityError)`;
  if (name === 'NotSupportedError') return `This phone or browser can't save a passkey. (NotSupportedError)`;
  return `${faceLabel()} didn't work: ${name ? name + ': ' : ''}${msg}`.slice(0, 240);
}

// ───────── JSON ⇄ browser formats ─────────
function toCreate(o) {
  return { ...o, challenge: unb64u(o.challenge), user: { ...o.user, id: unb64u(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: unb64u(c.id) })) };
}
function toGet(o) {
  return { ...o, challenge: unb64u(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: unb64u(c.id) })) };
}
function credJSON(c) {
  const r = c.response, out = { id: c.id, rawId: b64u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults?.() || {}, authenticatorAttachment: c.authenticatorAttachment || undefined };
  if (r.attestationObject) {
    out.response = { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject), transports: r.getTransports?.() || [] };
  } else {
    out.response = { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : undefined };
  }
  return out;
}

// A server request fetched ahead of a tap, refreshed before it expires.
export function prepared(action) {
  let p = null, at = 0;
  const load = () => { at = Date.now(); p = S.callFn('passkey', { action }); p.catch(() => {}); return p; };
  return {
    get: () => (p && Date.now() - at < PREP_MS ? p : load()),
    refresh: () => load(),
  };
}

// ───────── sign-in passkey ─────────
export async function setupPasskey(uid, prep, label) {
  const { options, ticket } = await prep.get();
  const cred = await navigator.credentials.create({ publicKey: toCreate(options) });
  prep.refresh();
  if (!cred) throw new Error('No passkey was made');
  const { credentialId } = await S.callFn('passkey', { action: 'registerVerify', ticket, response: credJSON(cred), label });
  write(PASSKEY, { uid, id: credentialId });
}

export async function removePasskey(uid) {
  const v = read(PASSKEY);
  if (v?.uid === uid) await S.callFn('passkey', { action: 'remove', credentialId: v.id }).catch(() => {});
  write(PASSKEY, null);
  if (read(LOCK)?.uid === uid) write(LOCK, null);
}

// Resolves with a sign-in token for whoever's passkey the phone offered.
export async function passkeySignIn(prep) {
  const { options, ticket } = await prep.get();
  const cred = await navigator.credentials.get({ publicKey: toGet(options) });
  prep.refresh();
  if (!cred) throw new Error('No passkey was chosen');
  const { token } = await S.callFn('passkey', { action: 'signInVerify', ticket, response: credJSON(cred) });
  // Remember it, so this phone knows Face ID is set up for that account.
  let uid = null;
  try { uid = new TextDecoder().decode(cred.response.userHandle); } catch (e) {}
  if (uid) write(PASSKEY, { uid, id: cred.id });
  return token;
}

// ───────── lock ─────────
// Face ID check on this phone only (no server); used to unlock and to change the lock setting.
async function verifyHere(uid) {
  const v = read(PASSKEY);
  if (!v || v.uid !== uid) return false;
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: random(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: unb64u(v.id) }],
  } });
  return !!cred && cred.id === v.id && (new Uint8Array(cred.response.authenticatorData)[32] & 0x04) !== 0;
}

export async function enableLock(uid) {
  if (!(await verifyHere(uid))) throw new Error(`${faceLabel()} didn't match`);
  write(LOCK, { uid });
}
export async function disableLock(uid) {
  if (!(await verifyHere(uid))) throw new Error(`${faceLabel()} didn't match`);
  write(LOCK, null);
}

function showLock(uid, onPassword) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'auth lock-screen';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Our Circle is locked');
    wrap.innerHTML = `<div class="auth-card">
      <div class="brand">${icon('lock', 30)}<span>Our Circle</span></div>
      <h1>Locked</h1>
      <p class="muted">Unlock with ${faceLabel()} to see your family and journal.</p>
      <p class="error" role="alert" hidden></p>
      <button class="btn wide" data-unlock>${icon('lock', 18)} Unlock with ${faceLabel()}</button>
      <button class="linkish" data-password>Use password instead</button>
    </div>`;
    document.body.appendChild(wrap);
    const err = wrap.querySelector('.error');
    const done = (ok) => { wrap.remove(); resolve(ok); };
    wrap.querySelector('[data-unlock]').onclick = async () => {
      err.hidden = true;
      try { if (await verifyHere(uid)) return done(true); err.textContent = 'That didn\'t unlock. Try again, or use your password.'; }
      catch (e) { err.textContent = explain(e); }
      err.hidden = false;
    };
    wrap.querySelector('[data-password]').onclick = async () => { done(false); await onPassword(); };
    wrap.querySelector('[data-unlock]').focus();
  });
}

let awayWatch = null;
// Called right after sign-in is known. Resolves true to carry on, false if the person went to the password screen.
export async function lockGate(uid, onPassword) {
  if (awayWatch) { document.removeEventListener('visibilitychange', awayWatch); awayWatch = null; }
  // Just signed in (password or Face ID): don't ask again right away. Used up on the first check either way.
  let fresh = false;
  try { fresh = sessionStorage.getItem('oc-fresh-signin') === '1'; sessionStorage.removeItem('oc-fresh-signin'); } catch (e) {}
  if (!lockOn(uid)) return true;
  if (!fresh && !(await showLock(uid, onPassword))) return false;
  let hiddenAt = 0, locking = false;
  awayWatch = async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!locking && lockOn(uid) && hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
      locking = true;
      await showLock(uid, onPassword);
      locking = false;
    }
  };
  document.addEventListener('visibilitychange', awayWatch);
  return true;
}
