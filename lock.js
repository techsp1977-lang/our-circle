// Face ID (or fingerprint) lock for this phone.
// Turning it on saves a passkey for Our Circle on this device. Then, when the app opens or comes back after
// a minute away, it asks for Face ID before showing anything. "Use password instead" signs out, so the lock
// can't be skipped without the account password.
// This protects the app on the phone itself (someone picking it up). It's a lock on this device, not a
// replacement for the account password, and it's set separately on each phone.
import { icon } from './ui.js';

const KEY = 'oc-lock';
const AWAY_MS = 60 * 1000;

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
function write(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} }

export const lockOn = (uid) => { const v = read(); return !!(v && v.uid === uid && v.id); };

// Does this device have Face ID / Touch ID / fingerprint that a web page can use?
export async function lockAvailable() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch (e) { return false; }
}

// Ask for Face ID once. Resolves true when the person passed.
async function verify(uid) {
  const v = read();
  if (!v || v.uid !== uid) return false;
  try {
    const cred = await navigator.credentials.get({ publicKey: {
      challenge: random(32), rpId: location.hostname, timeout: 60000, userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: unb64u(v.id), transports: ['internal'] }],
    } });
    return !!cred && b64u(cred.rawId) === v.id && cred.response?.authenticatorData && (new Uint8Array(cred.response.authenticatorData)[32] & 0x04) !== 0;
  } catch (e) { console.warn('Face ID check did not finish', e); return false; }
}

// Turn the lock on: saves a passkey named for this person on this device (Face ID asked once).
export async function enableLock(uid, label) {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Our Circle', id: location.hostname },
    user: { id: random(16), name: label || 'Our Circle', displayName: label || 'Our Circle' },
    challenge: random(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000, attestation: 'none',
  } });
  if (!cred) throw new Error('No passkey was made');
  write({ uid, id: b64u(cred.rawId), at: Date.now() });
}

// Turning it off needs Face ID too, so someone holding an unlocked app can't just switch it off.
export async function disableLock(uid) {
  if (!(await verify(uid))) return false;
  write(null);
  return true;
}

// Full-screen lock. Resolves true when unlocked, false when the person chose to use their password instead.
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
      <p class="muted">Unlock with Face ID to see your family and journal.</p>
      <p class="error" role="alert" hidden></p>
      <button class="btn wide" data-unlock>${icon('lock', 18)} Unlock</button>
      <button class="linkish" data-password>Use password instead</button>
    </div>`;
    document.body.appendChild(wrap);
    const err = wrap.querySelector('.error');
    const done = (ok) => { wrap.remove(); resolve(ok); };
    wrap.querySelector('[data-unlock]').onclick = async () => {
      err.hidden = true;
      if (await verify(uid)) done(true);
      else { err.textContent = 'That didn\'t unlock. Try again, or use your password.'; err.hidden = false; }
    };
    wrap.querySelector('[data-password]').onclick = async () => { done(false); await onPassword(); };
    wrap.querySelector('[data-unlock]').focus();
  });
}

let awayWatch = null;
// Called right after sign-in is known. Resolves true to carry on, false if the person went to the password screen.
export async function lockGate(uid, onPassword) {
  if (awayWatch) { document.removeEventListener('visibilitychange', awayWatch); awayWatch = null; }
  if (!lockOn(uid)) return true;
  // Just signed in with the password (for example because Face ID failed): don't ask again right away.
  let fresh = false;
  try { fresh = sessionStorage.getItem('oc-fresh-signin') === '1'; sessionStorage.removeItem('oc-fresh-signin'); } catch (e) {}
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

export const lockLabel = () => (/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? 'Face ID' : 'fingerprint or face');
