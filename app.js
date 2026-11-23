import { APP_NAME, APP_TAGLINE, DEFAULT_CHECKIN_DAYS } from './config.js';
import * as S from './store.js';
import { esc, icon, toast, $, sheet, face } from './ui.js';
import { setBadge } from './push.js';
import { THEMES, theme, applyTheme, DEFAULT_THEME } from './themes.js';
import { lockGate, webauthnSupported, phoneHasPasskey, prepared, passkeySignIn, explain, faceLabel } from './lock.js';

// ───────────── shared app state ─────────────
const state = {
  uid: null, cid: null, circle: null, access: null, me: null,
  members: {}, households: [], events: [], chats: {}, prefs: {}, ready: false,
  billingOn: false, // plans switched on by the owner (config/billing)
};
const listeners = new Set();
let subs = [];
let view = null;

const app = {
  state,
  on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  emit: () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }),
  go: (hash) => { if (location.hash === hash) route(); else location.hash = hash; },
  path: (sub) => `circles/${state.cid}/${sub}`,
  member: (id) => state.members[id],
  myMember: () => state.members[state.me],
  isAdmin: () => state.access?.role === 'admin',
  membersOf: (hid) => Object.values(state.members).filter((m) => m.householdId === hid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  household: (hid) => state.households.find((h) => h.id === hid),
  // 0 means check-in nudges are off; households in prefs.noCheckin never get one.
  checkinDays: () => (state.prefs.checkinDays === 0 ? 0 : Number(state.prefs.checkinDays) || DEFAULT_CHECKIN_DAYS),
  checkinMuted: (hid) => (state.prefs.noCheckin || []).includes(hid),
  async setCheckinMuted(hid, muted) {
    const list = new Set(state.prefs.noCheckin || []);
    muted ? list.add(hid) : list.delete(hid);
    await S.set(`users/${state.uid}`, { prefs: { ...state.prefs, noCheckin: [...list] } }, true);
  },
  chatList: () => Object.values(state.chats).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)),

  // Find or create the conversation for exactly these people (always includes me).
  async chatFor(memberIds, { name = '', kind = 'group', householdId = null } = {}) {
    const ids = [...new Set([...memberIds, state.me])].sort();
    const id = 'p_' + ids.join('_');
    if (!state.chats[id]) {
      const existing = await S.get(app.path('chats/' + id));
      // Never reuse a chat that doesn't match exactly these people (one set up ahead of time by someone else).
      if (existing && (existing.kind === 'everyone' || [...(existing.memberIds || [])].sort().join('_') !== ids.join('_'))) {
        throw new Error('This conversation looks wrong. Ask a family organizer to check it.');
      }
      if (!existing) {
        await S.set(app.path('chats/' + id), {
          kind: ids.length === 2 ? 'direct' : kind, name, memberIds: ids, householdId,
          lastText: '', lastAt: Date.now(), lastBy: null, reads: {}, sent: {},
        });
      }
    }
    return id;
  },
  async chatForHousehold(hid) {
    const h = app.household(hid);
    const ids = app.membersOf(hid).map((m) => m.id);
    return app.chatFor(ids, { name: h?.name || '', kind: 'household', householdId: hid });
  },
  // Go to another of your circles; it's remembered as the one to open next time.
  async switchCircle(cid) {
    await S.set(`users/${state.uid}`, { current: cid }, true).catch(() => {});
    location.hash = '#/family';
    if (!(await openCircle(cid))) toast('That circle is no longer available on this account.');
  },
  // Your photo is the same in every circle you belong to.
  async setMyPhoto(url) {
    await S.update(app.path('members/' + state.me), { photo: url });
    const here = state.cid, uid = state.uid;
    const u = (await S.get(`users/${uid}`).catch(() => null)) || {};
    await Promise.all((u.circles || []).filter((cid) => cid !== here).map(async (cid) => {
      const acc = await S.get(`circles/${cid}/access/${uid}`).catch(() => null);
      if (acc?.memberId) await S.update(`circles/${cid}/members/${acc.memberId}`, { photo: url }).catch(() => {});
    }));
  },
  // Joined or started a circle without a photo? Bring yours over from another circle.
  async fillMyPhoto() {
    const cid = state.cid, uid = state.uid;
    if (!state.me || app.myMember()?.photo) return;
    const u = (await S.get(`users/${uid}`).catch(() => null)) || {};
    for (const other of (u.circles || []).filter((c) => c !== cid)) {
      const acc = await S.get(`circles/${other}/access/${uid}`).catch(() => null);
      const m = acc?.memberId && await S.get(`circles/${other}/members/${acc.memberId}`).catch(() => null);
      if (m?.photo) {
        if (state.cid === cid && !app.myMember()?.photo) await S.update(app.path('members/' + state.me), { photo: m.photo }).catch(() => {});
        return;
      }
    }
  },
  newCircle() { renderOnboarding('', { back: state.cid, myName: app.myMember()?.name || '' }); },
  async openSwitcher() { (await import('./circles.js')).openSwitcher(app); },
  async ensureEveryone() {
    const p = app.path('chats/everyone');
    if (!(await S.get(p))) {
      await S.set(p, { kind: 'everyone', name: 'Everyone', memberIds: [], lastText: '', lastAt: Date.now(), lastBy: null, reads: {}, sent: {} });
    }
    return 'everyone';
  },

  // Upload originals (no shrinking) and return media records.
  async uploadFiles(files, onProgress) {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const safe = (f.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
      // Marked as yours: the storage rules require it, and it lets you delete your own files later.
      const url = await S.upload(app.path(`media/${S.newId()}_${safe}`), f, (p) => onProgress && onProgress((i + p) / files.length), { by: state.uid });
      out.push({ url, type: f.type || 'application/octet-stream', name: f.name || safe, size: f.size || 0 });
    }
    return out;
  },

  async send(chatId, text, files = [], onProgress) {
    const media = files.length ? await app.uploadFiles(files, onProgress) : [];
    const now = Date.now();
    const msgId = await S.add(app.path(`chats/${chatId}/messages`), { by: state.me, text: text || '', media, at: now });
    const preview = text || (media.length ? (media[0].type.startsWith('video') ? 'Sent a video' : `Sent ${media.length > 1 ? media.length + ' photos' : 'a photo'}`) : '');
    await S.update(app.path('chats/' + chatId), {
      lastText: preview.slice(0, 140), lastAt: now, lastBy: state.me,
      ['sent.' + state.me]: now, ['reads.' + state.me]: now,
    });
    // Phone notifications for everyone else in the chat (the server checks it's really my new message).
    S.callFn('notify', { action: 'send', cid: state.cid, chatId, msgId }).catch(() => {});
  },
};
window.__app = app; // handy for troubleshooting in the browser console

// ───────────── views ─────────────
const VIEWS = {
  family: () => import('./hub.js'),
  chats: () => import('./chats.js'),
  chat: () => import('./chats.js'),
  album: () => import('./album.js'),
  journal: () => import('./journal.js'),
  book: () => import('./journal.js'),
  me: () => import('./me.js'),
  manage: () => import('./manage.js'),
  calendar: () => import('./calendar.js'),
  admin: () => import('./admin.js'),
};
// The bottom tabs are what the family uses most; the rest live in the ☰ menu (and the computer's sidebar).
const TABS = [['family', 'Our Family', 'family'], ['chats', 'Chats', 'chat'], ['calendar', 'Calendar', 'cal']];
const MENU = [['me', 'My page', 'user'], ['journal', 'Journal', 'book'], ['album', 'Album', 'album']];

// Where you've been, so a Back arrow returns to the page you came from (scrolled where you left it).
const pagesBefore = [], scrollAt = {};
let hereHash = '', goingBack = false;
app.back = (fallback) => {
  let to = pagesBefore.pop();
  while (to && to === location.hash) to = pagesBefore.pop();
  goingBack = true;
  app.go(to || fallback);
};
// Any link marked data-back="#/somewhere" goes back the same way (its href is the fallback).
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-back]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  app.back(a.dataset.back);
});

async function route() {
  if (!state.ready) return;
  const leaving = hereHash, back = goingBack;
  goingBack = false;
  hereHash = location.hash || '#/family';
  if (leaving) scrollAt[leaving] = window.scrollY;
  if (!back && leaving && leaving !== hereHash) { pagesBefore.push(leaving); if (pagesBefore.length > 30) pagesBefore.shift(); }
  const [name = 'family', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const key = VIEWS[name] ? name : 'family';
  const mod = await VIEWS[key]();
  if (view?.destroy) view.destroy();
  document.querySelectorAll('.sheet-wrap').forEach((s) => s.remove());
  closeMenu();
  const main = $('#main');
  main.innerHTML = '';
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  const tabKey = { chat: 'chats', book: 'journal', manage: 'me', admin: 'me' }[key] || key;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tabKey));
  document.body.dataset.view = key;
  view = mod.mount(main, app, key, args) || null;
  if (back && scrollAt[hereHash]) { const y = scrollAt[hereHash]; requestAnimationFrame(() => window.scrollTo(0, y)); }
  updateBadges();
}

function shell() {
  document.body.innerHTML = `
    <div id="demo-bar"></div>
    <main id="main" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Main">
      <button class="side-brand" data-switch aria-label="Switch circles">${icon('family', 22)}<span>${esc(state.circle?.name || APP_NAME)}</span></button>
      ${TABS.map(([k, label, ic]) => `<a href="#/${k}" data-tab="${k}">${icon(ic, 22)}<span>${label}</span><i class="dot" hidden></i></a>`).join('')}
      ${MENU.map(([k, label, ic]) => `<a href="#/${k}" data-tab="${k}" class="tab-more">${icon(ic, 22)}<span>${label}</span></a>`).join('')}
    </nav>
    <button class="menu-btn" id="menu-btn" aria-label="Menu" aria-haspopup="menu" aria-expanded="false">${icon('menu', 22)}</button>`;
  document.body.classList.add('has-menu');
  renderDemoBar();
  document.querySelector('.tabbar [data-switch]').onclick = () => app.openSwitcher();
  document.getElementById('menu-btn').onclick = openMenu;
}

// The ☰ menu: My page, Journal and Album, plus family settings for organizers.
function openMenu() {
  const btn = document.getElementById('menu-btn');
  if (document.querySelector('.menu-wrap')) { closeMenu(); return; }
  const here = document.body.dataset.view;
  const items = [...MENU, ...(app.isAdmin() ? [['manage', 'Family settings', 'gear']] : [])];
  const wrap = document.createElement('div');
  wrap.className = 'menu-wrap';
  wrap.innerHTML = `<nav class="menu-pop" role="menu" aria-label="More">
    ${items.map(([k, label, ic]) => `<a role="menuitem" href="#/${k}" class="${here === k || (k === 'journal' && here === 'book') ? 'on' : ''}">${icon(ic, 20)}<span>${label}</span></a>`).join('')}
    <button role="menuitem" type="button" data-year>${icon('star', 20)}<span>Year in review video</span></button>
    <button role="menuitem" type="button" data-switch>${icon('family', 20)}<span>Switch family circle</span></button>
    <a role="menuitem" href="tour.html">${icon('next', 20)}<span>Quick tour</span></a>
  </nav>`;
  document.body.appendChild(wrap);
  btn.setAttribute('aria-expanded', 'true');
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-switch]')) { closeMenu(); app.openSwitcher(); return; }
    if (e.target.closest('[data-year]')) { closeMenu(); import('./yearvideo.js').then((m) => m.openYearVideo(app)); return; }
    if (e.target === wrap || e.target.closest('a')) closeMenu();
  });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); btn.focus(); } });
  wrap.querySelector('a, button')?.focus({ preventScroll: true });
}
function closeMenu() {
  document.querySelectorAll('.menu-wrap').forEach((w) => w.remove());
  document.getElementById('menu-btn')?.setAttribute('aria-expanded', 'false');
}

const isUnread = (c) => c.lastBy && c.lastBy !== state.me && (c.lastAt || 0) > (c.reads?.[state.me] || 0);
function updateBadges() {
  const unread = app.chatList().filter(isUnread).length;
  const dot = document.querySelector('.tabbar a[data-tab="chats"] .dot');
  if (dot) dot.hidden = !unread;
  setBadge(unread);
}

// In-app alert: a banner when a message arrives while you're somewhere other than that chat.
let lastSeen = {}, openedAt = 0;
function noticeNew(rows) {
  for (const c of rows) {
    const prev = lastSeen[c.id] ?? openedAt;
    lastSeen[c.id] = Math.max(prev, c.lastAt || 0);
    if (!state.ready || !isUnread(c) || (c.lastAt || 0) <= prev) continue;
    if (state.prefs.inAppAlerts === false || document.visibilityState !== 'visible') continue;
    if (decodeURIComponent(location.hash) === '#/chat/' + c.id) continue;
    banner(c);
  }
}
function banner(c) {
  document.querySelectorAll('.banner').forEach((b) => b.remove());
  const who = app.member(c.lastBy);
  const where = c.kind === 'everyone' ? 'Everyone' : c.kind === 'direct' ? '' : (c.name || '');
  const b = document.createElement('button');
  b.className = 'banner';
  b.setAttribute('role', 'status');
  b.innerHTML = `${face(who || { name: '?' }, 'sm')}<span class="banner-text"><b>${esc(who?.name || 'New message')}${where ? ' · ' + esc(where) : ''}</b><span>${esc(c.lastText || 'New message')}</span></span>`;
  b.onclick = () => { b.remove(); app.go('#/chat/' + encodeURIComponent(c.id)); };
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 6000);
}

function renderDemoBar() {
  const bar = $('#demo-bar');
  if (!bar || !S.isDemo) return;
  const d = S.demo();
  const people = d.people();
  bar.innerHTML = `<div class="demo-bar"><b>Demo</b> · sample data on this device. View as
    <select id="demo-who" aria-label="View the app as">${people.map((p) => `<option value="${p.uid}" ${p.uid === state.uid ? 'selected' : ''}>${esc(state.members[p.memberId]?.name || p.uid)}</option>`).join('')}</select>
    <button class="linkish" id="demo-reset">Reset</button></div>`;
  $('#demo-who').onchange = (e) => d.switchTo(e.target.value);
  $('#demo-reset').onclick = () => d.reset();
}

// ───────────── data subscriptions ─────────────
function stopSubs() { subs.forEach((u) => u && u()); subs = []; }

async function openCircle(cid) {
  // Check access first, so a circle that's gone leaves you where you are.
  const access = await S.getFast(`circles/${cid}/access/${state.uid}`).catch(() => null);
  if (!access) return false;
  stopSubs();
  if (view?.destroy) view.destroy();
  view = null;
  Object.assign(state, { cid, circle: null, members: {}, households: [], events: [], chats: {}, ready: false });
  state.access = access;
  state.me = access.memberId;

  lastSeen = {}; openedAt = Date.now();
  let first = { circle: false, members: false, households: false };
  const maybeReady = async () => {
    if (state.ready || !first.circle || !first.members || !first.households) return;
    state.ready = true;
    shell();
    document.title = (state.circle?.name || APP_NAME);
    await app.ensureEveryone().catch(() => {});
    route();
    app.fillMyPhoto().catch(() => {});
  };
  const changed = () => { app.emit(); updateBadges(); maybeReady(); };

  subs.push(S.watchDoc(`circles/${cid}`, (c) => { state.circle = c; applyTheme(c?.theme); first.circle = true; changed(); }));
  subs.push(S.watchColl(`circles/${cid}/members`, {}, (rows) => {
    state.members = Object.fromEntries(rows.map((r) => [r.id, r])); first.members = true; changed(); renderDemoBar();
  }));
  subs.push(S.watchColl(`circles/${cid}/households`, { orderBy: ['order', 'asc'] }, (rows) => { state.households = rows; first.households = true; changed(); }));
  subs.push(S.watchColl(`circles/${cid}/events`, {}, (rows) => { state.events = rows; changed(); }));
  subs.push(S.watchColl(`circles/${cid}/chats`, { where: [['memberIds', 'array-contains', state.me]] }, (rows) => {
    for (const k of Object.keys(state.chats)) if (k !== 'everyone') delete state.chats[k];
    rows.forEach((r) => (state.chats[r.id] = r)); changed(); noticeNew(rows);
  }));
  subs.push(S.watchDoc(`circles/${cid}/chats/everyone`, (c) => { if (c) { state.chats.everyone = c; noticeNew([c]); } changed(); }));
  // Role changes (made an organizer, or stepped down) show up without reopening the app.
  subs.push(S.watchDoc(`circles/${cid}/access/${state.uid}`, (a) => { if (a && a.role !== state.access?.role) { state.access = a; changed(); } }));
  subs.push(S.watchDoc(`users/${state.uid}`, (u) => { state.prefs = u?.prefs || {}; changed(); }));
  subs.push(S.watchDoc('config/billing', (b) => { state.billingOn = !!b?.on; changed(); }));
  return true;
}

// ───────────── sign in & onboarding ─────────────
function pendingJoin() {
  const q = new URLSearchParams(location.search).get('join');
  if (q) { try { localStorage.setItem('oc-join', q); } catch (e) {} return q; }
  try { return localStorage.getItem('oc-join'); } catch (e) { return null; }
}
function clearJoin() {
  try { localStorage.removeItem('oc-join'); } catch (e) {}
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
}

let signInPrep = null;
const MIN_PW = 7; // matches Firebase → Authentication → Settings → Password policy
function renderSignIn(msg = '', email = '') {
  const joining = pendingJoin();
  // The big Face ID button only on a phone where it was set up; otherwise iPhone asks for a QR code or security key.
  const quickFace = webauthnSupported() && phoneHasPasskey();
  document.body.innerHTML = `<div class="auth">
    <div class="auth-card">
      <div class="brand">${icon('family', 30)}<span>${esc(APP_NAME)}</span></div>
      <h1>${joining ? 'You have been invited' : 'Welcome'}</h1>
      <p class="muted">${joining ? 'Create an account or sign in to join your family.' : esc(APP_TAGLINE)}</p>
      ${msg ? `<p class="error" role="alert">${esc(msg)}</p>` : ''}
      ${quickFace ? `<button class="btn wide ${joining ? 'ghost' : ''}" id="faceid">${icon('lock', 18)} Sign in with ${esc(faceLabel())}</button>` : ''}
      <button class="btn wide ${quickFace ? 'ghost' : ''}" id="google">Continue with Google</button>
      <div class="or"><span>or use email</span></div>
      <form id="auth-form" class="stack">
        <label class="field" for="email"><span>Email</span><input id="email" type="email" autocomplete="email" required value="${esc(email)}"></label>
        <label class="field" for="pw"><span>Password</span><input id="pw" type="password" autocomplete="${joining ? 'new-password' : 'current-password'}" required><small>New here? Pick a password of at least ${MIN_PW} characters, then tap Create account.</small></label>
        ${joining
          // Invited: they're almost always new, and the keyboard's Go key presses the first button.
          ? `<button class="btn wide" type="submit" name="mode" value="up">Create account</button>
        <button class="btn wide ghost" type="submit" name="mode" value="in">I already have an account: Sign in</button>`
          : `<button class="btn wide ghost" type="submit" name="mode" value="in">Sign in</button>
        <button class="btn wide ghost" type="submit" name="mode" value="up">Create account</button>`}
      </form>
      <button class="linkish" id="forgot">Forgot password?</button>
      ${webauthnSupported() && !quickFace ? `<p class="muted small center">Want ${esc(faceLabel())}? Sign in with your password once, then go to My page → This phone → Set up. After that, ${esc(faceLabel())} is all you need.</p>
      <button class="linkish" id="faceid">I already set up ${esc(faceLabel())} on this phone</button>` : ''}
      <p class="muted small center"><a href="tour.html">New here? Watch the 1½-minute tour</a> · <a href="about.html">Plans, terms and privacy</a></p>
    </div></div>`;
  const form = $('#auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || 'in';
    const email = $('#email').value.trim(), pw = $('#pw').value;
    if (mode === 'up' && pw.length < MIN_PW) { renderSignIn(`Your password needs at least ${MIN_PW} characters. A short phrase works well, like "sunny porch 77".`, email); return; }
    markFreshSignIn();
    try { mode === 'up' ? await S.auth.signUp(email, pw) : await S.auth.signIn(email, pw); }
    catch (err) { renderSignIn(friendlyAuth(err), email); }
  };
  // Face ID: the server's half is fetched now, so the tap goes straight to Face ID (iPhone requires that).
  if (webauthnSupported()) {
    signInPrep ||= prepared('signInOptions');
    signInPrep.get();
    $('#faceid').onclick = async () => {
      markFreshSignIn();
      try { await S.auth.withToken(await passkeySignIn(signInPrep)); }
      catch (err) { console.warn(err); renderSignIn(err?.name === 'NotAllowedError' ? `${faceLabel()} sign-in was cancelled, or this phone has no Our Circle passkey yet. Sign in with your password once, then go to My page → This phone → Set up.` : explain(err)); }
    };
  }
  $('#google').onclick = async () => { markFreshSignIn(); try { await S.auth.google(); } catch (err) { renderSignIn(friendlyAuth(err)); } };
  $('#forgot').onclick = async () => {
    const email = $('#email').value.trim();
    if (!email) { renderSignIn('Type your email first, then tap Forgot password.'); return; }
    try { await S.auth.reset(email); toast('Password reset email sent.'); } catch (err) { renderSignIn(friendlyAuth(err)); }
  };
}
// A sign-in with the password counts as unlocking, so the Face ID lock doesn't ask again right after it.
function markFreshSignIn() { try { sessionStorage.setItem('oc-fresh-signin', '1'); } catch (e) {} }

function friendlyAuth(err) {
  const c = String(err?.code || err?.message || 'unknown');
  console.warn('Sign-in error:', err);
  const msg = (t) => `${t} (code: ${c.replace('auth/', '')})`;
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-login')) return msg('That email and password do not match. New here? Tap Create account instead.');
  if (c.includes('email-already-in-use')) return msg('That email already has an account. Tap Sign in instead.');
  if (c.includes('weak-password') || c.includes('password-does-not-meet')) return msg(`Use a password with at least ${MIN_PW} characters. A short phrase works well, like "sunny porch 77".`);
  if (c.includes('invalid-email')) return msg('That email address does not look right.');
  if (c.includes('operation-not-allowed')) return msg('This sign-in method is turned off. In Firebase: Authentication → Sign-in method → turn on Email/Password (and Google).');
  if (c.includes('configuration-not-found')) return msg('Firebase sign-in is not set up yet. In Firebase: Authentication → click Get started, then turn on Email/Password.');
  if (c.includes('unauthorized-domain')) return msg('This web address is not approved. In Firebase: Authentication → Settings → Authorized domains → add ' + location.hostname);
  if (c.includes('api-key') || c.includes('invalid-api-key')) return msg('The Firebase settings in config.js look wrong. Re-copy the apiKey from Firebase project settings.');
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return msg('The Google window was closed before finishing.');
  if (c.includes('popup-blocked')) return msg('Your browser blocked the Google window. Allow pop-ups, or use email and password.');
  if (c.includes('network-request-failed')) return msg('Could not reach Firebase. Check your internet connection.');
  if (c.includes('too-many-requests')) return msg('Too many tries. Wait a few minutes and try again.');
  return msg('Sign-in did not work.');
}

// opts.back: the circle to go back to (when starting another circle); opts.myName: prefill your name.
async function renderOnboarding(msg = '', opts = {}) {
  const join = pendingJoin();
  let invite = null, cid = null, code = null;
  if (join) {
    [cid, code] = join.split('.');
    invite = await S.get(`circles/${cid}/invites/${code}`).catch(() => null);
  }
  applyTheme(DEFAULT_THEME);
  document.body.innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand">${icon('family', 30)}<span>${esc(APP_NAME)}</span></div>
    ${msg ? `<p class="error" role="alert">${esc(msg)}</p>` : ''}
    ${invite && !invite.used ? `
      <h1>Join as ${esc(invite.memberName)}</h1>
      <p class="muted">${esc(invite.circleName || 'Your family')} invited you. Your profile, birthday and photo are already set up.</p>
      <button class="btn wide" id="join">Join ${esc(invite.circleName || 'the family')}</button>
    ` : `
      ${join ? '<p class="error">That invite link has already been used or is no longer valid. Ask for a new one.</p>' : ''}
      <h1>${opts.back ? 'Start a new circle' : 'Start your family circle'}</h1>
      <p class="muted">You'll be the organizer. You can add everyone else next.${opts.back ? ' Your other circles stay as they are; switch between them from the family name at the top.' : ''}</p>
      <form id="start" class="stack">
        <label class="field" for="cn"><span>Family name</span><input id="cn" required placeholder="The Bennetts"></label>
        <label class="field" for="yn"><span>Your first name</span><input id="yn" required placeholder="Michael" value="${esc(opts.myName || '')}"></label>
        <label class="field" for="hn"><span>Your household</span><input id="hn" required placeholder="Michael & Sarah"><small>Everyone who lives with you, as you'd write it on a card.</small></label>
        <fieldset class="swatches"><legend>Circle color</legend>${THEMES.map((t, j) => `<label class="swatch" for="tc_${j}" style="--sw:${theme(t.key).swatch}"><input type="radio" id="tc_${j}" name="theme" value="${t.key}" ${j === 0 ? 'checked' : ''}><span class="sw-dot" aria-hidden="true"></span><span class="sw-name">${t.label}</span></label>`).join('')}</fieldset>
        <p class="muted small">Each household gets its own shade of this color. You can change it later in Family settings.</p>
        <button class="btn wide" type="submit">Create our circle</button>
      </form>
      <p class="muted small">Got an invite link from family? Open that link instead.</p>`}
    ${opts.back ? '<button class="btn ghost wide" id="back">Back</button>' : '<button class="linkish" id="out">Sign out</button>'}
  </div></div>`;
  $('#out')?.addEventListener('click', () => S.auth.signOut());
  $('#back')?.addEventListener('click', () => openCircle(opts.back));
  $('#start')?.addEventListener('change', (e) => { if (e.target.name === 'theme') applyTheme(e.target.value); });
  $('#join')?.addEventListener('click', async () => {
    try {
      const uid = state.uid;
      await S.batch([
        { op: 'set', path: `circles/${cid}/access/${uid}`, data: { memberId: invite.memberId, role: invite.organizer === true ? 'admin' : 'member', invite: code } },
        { op: 'update', path: `circles/${cid}/invites/${code}`, data: { used: true, usedBy: uid } },
        { op: 'update', path: `circles/${cid}/members/${invite.memberId}`, data: { uid, claimed: true } },
      ]);
      const u = (await S.get(`users/${uid}`)) || {};
      await S.set(`users/${uid}`, { circles: [...new Set([...(u.circles || []), cid])], current: cid, prefs: u.prefs || { checkinDays: DEFAULT_CHECKIN_DAYS } }, true);
      clearJoin();
      location.hash = '#/family';
      await openCircle(cid);
    } catch (e) { console.error(e); renderOnboarding('Joining did not work. The link may have been used already.'); }
  });
  $('#start')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const uid = state.uid, cid2 = S.newId(), mid = S.newId(), hid = S.newId();
      await S.batch([
        { op: 'set', path: `circles/${cid2}`, data: { name: $('#cn').value.trim(), createdBy: uid, createdAt: Date.now(), theme: $('#start').elements.theme?.value || DEFAULT_THEME } },
        { op: 'set', path: `circles/${cid2}/access/${uid}`, data: { memberId: mid, role: 'admin' } },
      ]);
      await S.batch([
        { op: 'set', path: `circles/${cid2}/households/${hid}`, data: { name: $('#hn').value.trim(), order: 0 } },
        { op: 'set', path: `circles/${cid2}/members/${mid}`, data: { name: $('#yn').value.trim(), householdId: hid, order: 0, photo: null, uid, claimed: true, managedBy: [], createdAt: Date.now() } },
      ]);
      const u = (await S.get(`users/${uid}`).catch(() => null)) || {};
      await S.set(`users/${uid}`, { circles: [...new Set([...(u.circles || []), cid2])], current: cid2, prefs: u.prefs || { checkinDays: DEFAULT_CHECKIN_DAYS } }, true);
      clearJoin();
      await openCircle(cid2);
      location.hash = '#/manage';
    } catch (err) { console.error(err); btn.disabled = false; btn.textContent = 'Create our circle'; toast('Could not create the circle. Check your connection.'); }
  });
}

// A newer version of the app was just saved on this phone. Switch to it now if the app only just opened and
// nothing is being typed or chosen; otherwise the next time the app comes back to the screen.
const openedAppAt = Date.now();
function useUpdate() {
  const busy = () => document.querySelector('.sheet-wrap') || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    || [...document.querySelectorAll('textarea, input[type=text]')].some((x) => x.value);
  if (Date.now() - openedAppAt < 8000 && !busy()) { location.reload(); return; }
  const later = () => { if (document.visibilityState === 'visible' && !busy()) location.reload(); };
  document.addEventListener('visibilitychange', later);
}

// ───────────── start ─────────────
export async function start() {
  try { await S.initStore(); }
  catch (e) {
    document.body.innerHTML = `<div class="auth"><div class="auth-card"><h1>Can't connect</h1><p class="muted">The app could not reach its database. Check your internet connection, then reload.</p></div></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  // Back from Stripe's checkout page.
  const paid = new URLSearchParams(location.search).get('paid');
  if (paid) {
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => toast(paid === '1' ? 'Thank you! Your family plan is starting. It can take a minute to show here.' : 'Checkout was cancelled. Nothing was charged.', 7000), 1500);
  }
  // Messages from the service worker: a notification was tapped (open that chat), or a push arrived.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && /^#\/chat\/[\w%-]+$/.test(e.data.hash || '')) location.hash = e.data.hash;
    if (e.data?.type === 'push') updateBadges();
    if (e.data?.type === 'updated') useUpdate();
  });
  S.auth.onChange(async (user) => {
    stopSubs();
    if (view?.destroy) view.destroy();
    view = null;
    Object.assign(state, { uid: user?.uid || null, ready: false, cid: null });
    if (!user) { S.isDemo ? S.demo().switchTo('u_michael') : renderSignIn(); return; }
    // Face ID lock for this phone, when it's turned on (My page → This phone).
    if (!(await lockGate(user.uid, () => S.auth.signOut()))) return;
    // If the database can't be reached (not created yet, or rules not published), say so instead of waiting forever.
    let u = null;
    try {
      u = await Promise.race([
        S.getFast(`users/${user.uid}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ]);
    } catch (err) {
      console.warn('Database check failed:', err);
      const why = String(err?.code || err?.message || '');
      document.body.innerHTML = `<div class="auth"><div class="auth-card">
        <h1>Signed in, but the database isn't answering</h1>
        <p class="muted">You are signed in as ${esc(user.email || 'your account')}. The app could not reach its database${why.includes('permission') ? ' because the security rules are blocking it' : ''}.</p>
        <p class="error">In Firebase, open <b>Firestore Database</b>. If you see <b>Create database</b>, create it (nam5, production mode). Then open its <b>Rules</b> tab, paste in the contents of firestore.rules, and click <b>Publish</b>. (code: ${esc(why || 'unknown')})</p>
        <button class="btn wide" id="retry">Try again</button>
        <button class="linkish" id="out2">Sign out</button></div></div>`;
      document.getElementById('retry').onclick = () => location.reload();
      document.getElementById('out2').onclick = () => S.auth.signOut();
      return;
    }
    const join = pendingJoin();
    if (join && !(u?.circles || []).includes(join.split('.')[0])) { renderOnboarding(); return; }
    if (join) clearJoin();
    const order = [...new Set([u?.current, ...(u?.circles || [])].filter(Boolean))];
    for (const cid of order) {
      if (await openCircle(cid)) { if (cid !== u?.current) S.set(`users/${user.uid}`, { current: cid }, true).catch(() => {}); return; }
    }
    renderOnboarding(order.length ? 'That family circle is not available on this account.' : '');
  });
  if ('serviceWorker' in navigator && !S.isDemo) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
