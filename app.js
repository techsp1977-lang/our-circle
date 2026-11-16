import { APP_NAME, APP_TAGLINE, DEFAULT_CHECKIN_DAYS } from './config.js';
import * as S from './store.js';
import { esc, icon, toast, $, sheet } from './ui.js';

// ───────────── shared app state ─────────────
const state = {
  uid: null, cid: null, circle: null, access: null, me: null,
  members: {}, households: [], events: [], chats: {}, prefs: {}, ready: false,
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
  checkinDays: () => Number(state.prefs.checkinDays) || DEFAULT_CHECKIN_DAYS,
  chatList: () => Object.values(state.chats).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)),

  // Find or create the conversation for exactly these people (always includes me).
  async chatFor(memberIds, { name = '', kind = 'group', householdId = null } = {}) {
    const ids = [...new Set([...memberIds, state.me])].sort();
    const id = 'p_' + ids.join('_');
    if (!state.chats[id]) {
      const existing = await S.get(app.path('chats/' + id));
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
      const url = await S.upload(app.path(`media/${S.newId()}_${safe}`), f, (p) => onProgress && onProgress((i + p) / files.length));
      out.push({ url, type: f.type || 'application/octet-stream', name: f.name || safe, size: f.size || 0 });
    }
    return out;
  },

  async send(chatId, text, files = [], onProgress) {
    const media = files.length ? await app.uploadFiles(files, onProgress) : [];
    const now = Date.now();
    await S.add(app.path(`chats/${chatId}/messages`), { by: state.me, text: text || '', media, at: now });
    const preview = text || (media.length ? (media[0].type.startsWith('video') ? 'Sent a video' : `Sent ${media.length > 1 ? media.length + ' photos' : 'a photo'}`) : '');
    await S.update(app.path('chats/' + chatId), {
      lastText: preview.slice(0, 140), lastAt: now, lastBy: state.me,
      ['sent.' + state.me]: now, ['reads.' + state.me]: now,
    });
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
};
const TABS = [
  ['family', 'Family', 'family'], ['chats', 'Chats', 'chat'], ['album', 'Album', 'album'],
  ['journal', 'Journal', 'book'], ['me', 'My page', 'user'],
];

async function route() {
  if (!state.ready) return;
  const [name = 'family', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const key = VIEWS[name] ? name : 'family';
  const mod = await VIEWS[key]();
  if (view?.destroy) view.destroy();
  const main = $('#main');
  main.innerHTML = '';
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  const tabKey = { chat: 'chats', book: 'journal', manage: 'me' }[key] || key;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tabKey));
  document.body.dataset.view = key;
  view = mod.mount(main, app, key, args) || null;
  updateBadges();
}

function shell() {
  document.body.innerHTML = `
    <div id="demo-bar"></div>
    <main id="main" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Main">
      ${TABS.map(([k, label, ic]) => `<a href="#/${k}" data-tab="${k}">${icon(ic, 22)}<span>${label}</span><i class="dot" hidden></i></a>`).join('')}
    </nav>`;
  renderDemoBar();
}

function updateBadges() {
  const unread = app.chatList().some((c) => c.lastBy && c.lastBy !== state.me && (c.lastAt || 0) > (c.reads?.[state.me] || 0));
  const dot = document.querySelector('.tabbar a[data-tab="chats"] .dot');
  if (dot) dot.hidden = !unread;
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
  stopSubs();
  Object.assign(state, { cid, circle: null, members: {}, households: [], events: [], chats: {}, ready: false });
  const access = await S.get(`circles/${cid}/access/${state.uid}`);
  if (!access) { renderOnboarding('That family circle is not available on this account.'); return; }
  state.access = access;
  state.me = access.memberId;

  let first = { circle: false, members: false, households: false };
  const maybeReady = async () => {
    if (state.ready || !first.circle || !first.members || !first.households) return;
    state.ready = true;
    shell();
    document.title = (state.circle?.name || APP_NAME);
    await app.ensureEveryone().catch(() => {});
    route();
  };
  const changed = () => { app.emit(); updateBadges(); maybeReady(); };

  subs.push(S.watchDoc(`circles/${cid}`, (c) => { state.circle = c; first.circle = true; changed(); }));
  subs.push(S.watchColl(`circles/${cid}/members`, {}, (rows) => {
    state.members = Object.fromEntries(rows.map((r) => [r.id, r])); first.members = true; changed(); renderDemoBar();
  }));
  subs.push(S.watchColl(`circles/${cid}/households`, { orderBy: ['order', 'asc'] }, (rows) => { state.households = rows; first.households = true; changed(); }));
  subs.push(S.watchColl(`circles/${cid}/events`, {}, (rows) => { state.events = rows; changed(); }));
  subs.push(S.watchColl(`circles/${cid}/chats`, { where: [['memberIds', 'array-contains', state.me]] }, (rows) => {
    for (const k of Object.keys(state.chats)) if (k !== 'everyone') delete state.chats[k];
    rows.forEach((r) => (state.chats[r.id] = r)); changed();
  }));
  subs.push(S.watchDoc(`circles/${cid}/chats/everyone`, (c) => { if (c) state.chats.everyone = c; changed(); }));
  subs.push(S.watchDoc(`users/${state.uid}`, (u) => { state.prefs = u?.prefs || {}; changed(); }));
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

function renderSignIn(msg = '') {
  const joining = pendingJoin();
  document.body.innerHTML = `<div class="auth">
    <div class="auth-card">
      <div class="brand">${icon('family', 30)}<span>${esc(APP_NAME)}</span></div>
      <h1>${joining ? 'You have been invited' : 'Welcome'}</h1>
      <p class="muted">${joining ? 'Create an account or sign in to join your family.' : esc(APP_TAGLINE)}</p>
      ${msg ? `<p class="error" role="alert">${esc(msg)}</p>` : ''}
      <form id="auth-form" class="stack">
        <label class="field" for="email"><span>Email</span><input id="email" type="email" autocomplete="email" required></label>
        <label class="field" for="pw"><span>Password</span><input id="pw" type="password" autocomplete="current-password" minlength="6" required></label>
        <button class="btn wide" type="submit" name="mode" value="in">Sign in</button>
        <button class="btn wide ghost" type="submit" name="mode" value="up">Create account</button>
      </form>
      <button class="btn wide ghost" id="google">Continue with Google</button>
      <button class="linkish" id="forgot">Forgot password?</button>
    </div></div>`;
  const form = $('#auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || 'in';
    const email = $('#email').value.trim(), pw = $('#pw').value;
    try { mode === 'up' ? await S.auth.signUp(email, pw) : await S.auth.signIn(email, pw); }
    catch (err) { renderSignIn(friendlyAuth(err)); }
  };
  $('#google').onclick = async () => { try { await S.auth.google(); } catch (err) { renderSignIn(friendlyAuth(err)); } };
  $('#forgot').onclick = async () => {
    const email = $('#email').value.trim();
    if (!email) { renderSignIn('Type your email first, then tap Forgot password.'); return; }
    try { await S.auth.reset(email); toast('Password reset email sent.'); } catch (err) { renderSignIn(friendlyAuth(err)); }
  };
}
function friendlyAuth(err) {
  const c = String(err?.code || err?.message || '');
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'That email and password do not match. Try again or tap Create account.';
  if (c.includes('email-already-in-use')) return 'That email already has an account. Tap Sign in instead.';
  if (c.includes('weak-password')) return 'Use a password with at least 6 characters.';
  if (c.includes('popup')) return 'The Google window was closed before finishing.';
  return 'Something went wrong signing in. Check your connection and try again.';
}

async function renderOnboarding(msg = '') {
  const join = pendingJoin();
  let invite = null, cid = null, code = null;
  if (join) {
    [cid, code] = join.split('.');
    invite = await S.get(`circles/${cid}/invites/${code}`).catch(() => null);
  }
  document.body.innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand">${icon('family', 30)}<span>${esc(APP_NAME)}</span></div>
    ${msg ? `<p class="error" role="alert">${esc(msg)}</p>` : ''}
    ${invite && !invite.used ? `
      <h1>Join as ${esc(invite.memberName)}</h1>
      <p class="muted">${esc(invite.circleName || 'Your family')} invited you. Your profile, birthday and photo are already set up.</p>
      <button class="btn wide" id="join">Join ${esc(invite.circleName || 'the family')}</button>
    ` : `
      ${join ? '<p class="error">That invite link has already been used or is no longer valid. Ask for a new one.</p>' : ''}
      <h1>Start your family circle</h1>
      <p class="muted">You'll be the organizer. You can add everyone else next.</p>
      <form id="start" class="stack">
        <label class="field" for="cn"><span>Family name</span><input id="cn" required placeholder="The Proctors"></label>
        <label class="field" for="yn"><span>Your first name</span><input id="yn" required placeholder="Spencer"></label>
        <label class="field" for="hn"><span>Your household</span><input id="hn" required placeholder="Spencer & Jeana"><small>Everyone who lives with you, as you'd write it on a card.</small></label>
        <button class="btn wide" type="submit">Create our circle</button>
      </form>
      <p class="muted small">Got an invite link from family? Open that link instead.</p>`}
    <button class="linkish" id="out">Sign out</button>
  </div></div>`;
  $('#out').onclick = () => S.auth.signOut();
  $('#join')?.addEventListener('click', async () => {
    try {
      const uid = state.uid;
      await S.batch([
        { op: 'set', path: `circles/${cid}/access/${uid}`, data: { memberId: invite.memberId, role: 'member', invite: code } },
        { op: 'update', path: `circles/${cid}/invites/${code}`, data: { used: true, usedBy: uid } },
        { op: 'update', path: `circles/${cid}/members/${invite.memberId}`, data: { uid, claimed: true } },
      ]);
      const u = (await S.get(`users/${uid}`)) || {};
      await S.set(`users/${uid}`, { circles: [...new Set([...(u.circles || []), cid])], current: cid, prefs: u.prefs || { checkinDays: DEFAULT_CHECKIN_DAYS } }, true);
      clearJoin();
      await openCircle(cid);
    } catch (e) { console.error(e); renderOnboarding('Joining did not work. The link may have been used already.'); }
  });
  $('#start')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const uid = state.uid, cid2 = S.newId(), mid = S.newId(), hid = S.newId();
      await S.batch([
        { op: 'set', path: `circles/${cid2}`, data: { name: $('#cn').value.trim(), createdBy: uid, createdAt: Date.now(), theme: 'evergreen' } },
        { op: 'set', path: `circles/${cid2}/access/${uid}`, data: { memberId: mid, role: 'admin' } },
      ]);
      await S.batch([
        { op: 'set', path: `circles/${cid2}/households/${hid}`, data: { name: $('#hn').value.trim(), order: 0 } },
        { op: 'set', path: `circles/${cid2}/members/${mid}`, data: { name: $('#yn').value.trim(), householdId: hid, order: 0, photo: null, uid, claimed: true, managedBy: [], createdAt: Date.now() } },
      ]);
      await S.set(`users/${uid}`, { circles: [cid2], current: cid2, prefs: { checkinDays: DEFAULT_CHECKIN_DAYS } }, true);
      clearJoin();
      await openCircle(cid2);
      location.hash = '#/manage';
    } catch (err) { console.error(err); btn.disabled = false; btn.textContent = 'Create our circle'; toast('Could not create the circle. Check your connection.'); }
  });
}

// ───────────── start ─────────────
export async function start() {
  try { await S.initStore(); }
  catch (e) {
    document.body.innerHTML = `<div class="auth"><div class="auth-card"><h1>Can't connect</h1><p class="muted">The app could not reach its database. Check your internet connection, then reload.</p></div></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  S.auth.onChange(async (user) => {
    stopSubs();
    if (view?.destroy) view.destroy();
    view = null;
    Object.assign(state, { uid: user?.uid || null, ready: false, cid: null });
    if (!user) { S.isDemo ? S.demo().switchTo('u_spencer') : renderSignIn(); return; }
    const u = await S.get(`users/${user.uid}`).catch(() => null);
    const join = pendingJoin();
    if (join && !(u?.circles || []).includes(join.split('.')[0])) { renderOnboarding(); return; }
    if (join) clearJoin();
    const cid = u?.current || u?.circles?.[0];
    if (!cid) { renderOnboarding(); return; }
    await openCircle(cid);
  });
  if ('serviceWorker' in navigator && !S.isDemo) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
