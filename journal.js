// Private journal. Stored under journals/{your account}, which only you can read.
// With "Lock my journal" on, every page and goal is encrypted on the phone before it's saved (jkey.js).
// Also the printable book export (#/book).
import * as S from './store.js';
import * as J from './jkey.js';
import { esc, icon, sheet, toast, confirmBox } from './ui.js';
import { today, addDays, weekday, longDate, dayOfYear, shortDate, parse } from './dates.js';

export const TEMPLATES = {
  daily: { label: 'Daily Journal', sections: [{ title: 'How my day went' }, { title: "Three things I'm grateful for", list: 3 }] },
  gratitude: { label: 'Gratitude', sections: [{ title: "Three things I'm grateful for", list: 3 }, { title: 'Someone who blessed my life today' }, { title: 'A small miracle I noticed' }] },
  spiritual: { label: 'Spiritual Impressions', sections: [{ title: 'Impressions and promptings' }, { title: "What I'm pondering" }, { title: 'What I want to act on' }] },
  legacy: { label: 'Leaving a Legacy', sections: [{ title: 'A story I want my family to remember' }, { title: "A lesson I've learned" }, { title: 'What I hope for you' }] },
};

const PROMPTS = [
  'Where did you feel peace today?', 'Who made you smile today?', 'What did you notice that others might have missed?',
  'What prayer was answered, even in a small way?', 'What are you looking forward to?', 'What did you learn today?',
  'Who could use a kind word from you this week?', 'What made today different from yesterday?', 'Where did you see kindness today?',
  'What is something you want your grandchildren to know about this season of life?', 'What was hard today, and what helped?',
  'What is one thing you did well today?', 'What memory came back to you today?', 'What are you grateful for that you usually overlook?',
  'What did someone teach you today?', 'When did you feel most like yourself today?', 'What would you tell yourself a year ago?',
  'What tender mercy did you notice?', 'What made you laugh?', 'What do you want to remember about today?',
];
const promptFor = (d) => PROMPTS[dayOfYear(d) % PROMPTS.length];
let enterFrom = null; // 'left' | 'right': which side the next page slides in from after a swipe
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function mount(root, app, key, args) {
  if (key === 'book') return book(root, app);
  if (args[0] === 'past') return past(root, app);
  return page(root, app, /^\d{4}-\d{2}-\d{2}$/.test(args[0] || '') ? args[0] : today());
}

// ───────── the journal lock ─────────
const entryPath = (uid, d) => `journals/${uid}/entries/${d}`;
const goalPath = (uid, id) => `journals/${uid}/goals/${id}`;

// Journal settings, fresh from the server when online (so a lock set on another phone is seen).
async function journalSettings(uid) {
  try { return (await S.get(`journals/${uid}`)) || {}; } catch (e) { return (await S.getFast(`journals/${uid}`).catch(() => null)) || {}; }
}

// The key for this journal: null when it isn't locked; otherwise this phone's unlocked key, asking for the
// journal password first if this phone hasn't been unlocked yet. Resolves { key, settings }.
async function journalKey(root, uid) {
  const settings = await journalSettings(uid);
  if (!settings.lock) return { key: null, settings };
  const k = await J.deviceKey(uid);
  if (k) { sealLeftovers(uid, k); return { key: k, settings }; }
  return new Promise((resolve) => unlockScreen(root, uid, async () => { const key = await J.deviceKey(uid); sealLeftovers(uid, key); resolve({ key, settings }); }));
}

function unlockScreen(root, uid, done) {
  let recovering = false, busy = false;
  const paint = (msg = '') => {
    root.innerHTML = `<div class="unlock-wrap"><div class="card unlock">
      <span class="unlock-ic">${icon('lock', 28)}</span>
      <h1 class="h1">Your journal is locked</h1>
      <p class="muted">${recovering ? 'Enter the recovery code you saved when you locked your journal, and choose a new journal password.' : 'Enter your journal password to open it on this phone. This phone will remember it until you sign out.'}</p>
      ${msg ? `<p class="error" role="alert">${esc(msg)}</p>` : ''}
      <form id="uf" class="stack">
        ${recovering ? `<label class="field" for="rc"><span>Recovery code</span><input id="rc" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-EFGH-…" required></label>` : ''}
        <label class="field" for="pw"><span>${recovering ? 'New journal password' : 'Journal password'}</span><input id="pw" type="password" autocomplete="${recovering ? 'new-password' : 'current-password'}" required minlength="${J.MIN_PASSWORD}"></label>
        <button class="btn wide" type="submit">${recovering ? 'Unlock and set new password' : 'Unlock'}</button>
      </form>
      <button class="linkish" data-toggle>${recovering ? 'Back to journal password' : 'Forgot it? Use your recovery code'}</button>
      ${recovering ? '<button class="linkish danger-link" data-startover>Lost the recovery code too? Start over</button>' : ''}
    </div></div>`;
    root.querySelector('[data-startover]')?.addEventListener('click', async () => {
      const ok = await confirmBox('Start over with an empty journal?',
        "Without your journal password or recovery code, no one can open your old pages, not even Our Circle. Starting over permanently erases those pages and your goals, and locks your journal again with a new password. Your family's chats, photos and calendar aren't affected.",
        'Erase and start over');
      if (!ok) return;
      const r = await sheet({ title: 'New journal password', submit: 'Start over', fields: [
        { name: 'pw', label: 'New journal password', type: 'password', required: true, hint: `At least ${J.MIN_PASSWORD} characters.` },
        { name: 'pw2', label: 'Type it again', type: 'password', required: true },
      ] });
      if (!r) return;
      if (r.pw !== r.pw2 || r.pw.length < J.MIN_PASSWORD) { toast(r.pw !== r.pw2 ? "The passwords didn't match." : `Use at least ${J.MIN_PASSWORD} characters.`); return; }
      try {
        toast('Starting over…', 15000);
        const code = await J.startOver(uid, r.pw);
        await J.unlock(uid, r.pw);
        await showRecoveryCode(code, false);
        toast('Your journal is ready, locked with your new password.');
        done();
      } catch (e) { toast(e?.message || 'That did not work. Try again.'); }
    });
    root.querySelector('[data-toggle]').onclick = () => { recovering = !recovering; paint(); };
    root.querySelector('#uf').onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return; busy = true;
      const btn = root.querySelector('#uf button'); btn.disabled = true; btn.textContent = 'Opening…';
      try {
        const ok = recovering ? await J.recover(uid, root.querySelector('#rc').value, root.querySelector('#pw').value) : await J.unlock(uid, root.querySelector('#pw').value);
        busy = false;
        if (ok) { if (recovering) toast('Unlocked. Your new journal password is set.'); done(); }
        else paint(recovering ? "That recovery code didn't work. Check it and try again." : "That's not the journal password. Try again, or use your recovery code.");
      } catch (er) { busy = false; paint(er?.message || 'That did not work. Try again.'); }
    };
    setTimeout(() => root.querySelector(recovering ? '#rc' : '#pw')?.focus(), 50);
  };
  paint();
}

// Pages and goals from before the lock (or a lock that was interrupted) get encrypted the first time this
// phone opens the locked journal in a visit.
const sealedThisVisit = new Set();
async function sealLeftovers(uid, key, onProgress) {
  if (!key || sealedThisVisit.has(uid)) return 0;
  sealedThisVisit.add(uid);
  let n = 0;
  try {
    const [entries, goals] = await Promise.all([S.getColl(`journals/${uid}/entries`), S.getColl(`journals/${uid}/goals`)]);
    const todo = entries.filter((e) => e.sections && !e.enc).length + goals.filter((g) => 'title' in g && !g.enc).length;
    for (const e of entries.filter((x) => x.sections && !x.enc)) {
      const { sections, id, ...rest } = e;
      await S.set(entryPath(uid, id), { ...rest, enc: await J.seal(key, entryPath(uid, id), { sections }) });
      onProgress?.(++n, todo);
    }
    for (const g of goals.filter((x) => 'title' in x && !x.enc)) {
      const { title, id, ...rest } = g;
      await S.set(goalPath(uid, id), { ...rest, enc: await J.seal(key, goalPath(uid, id), { title }) });
      onProgress?.(++n, todo);
    }
  } catch (e) { console.warn('Some journal pages could not be encrypted yet; will try again next time.', e); sealedThisVisit.delete(uid); }
  return n;
}

// A stored page, ready to show: decrypted when it was saved encrypted.
async function readEntry(uid, key, e) {
  if (!e?.enc) return e;
  if (!key) return { ...e, sections: [], unreadable: true };
  try { return { ...e, sections: (await J.open(key, entryPath(uid, e.id || e.date), e.enc)).sections }; }
  catch (er) { console.warn('Could not decrypt', e.date, er); return { ...e, sections: [], unreadable: true }; }
}
const readEntries = (uid, key, rows) => Promise.all(rows.map((e) => readEntry(uid, key, e)));

// Turn the lock on: choose a password, save the recovery code, encrypt everything already written.
async function lockJournal(app, after) {
  const uid = app.state.uid;
  const r = await sheet({
    title: 'Lock my journal',
    intro: "Your journal and goals will be encrypted on this phone before they're saved, so no one else can read them, not even the people who run Our Circle. You'll type this password once on each phone you use.",
    submit: 'Lock my journal',
    fields: [
      { name: 'pw', label: 'Journal password', type: 'password', required: true, hint: `At least ${J.MIN_PASSWORD} characters. Short is fine; a few words like "blue bike 77" are easy to remember and much harder to guess.` },
      { name: 'pw2', label: 'Type it again', type: 'password', required: true },
    ],
  });
  if (!r) return;
  if (r.pw !== r.pw2) { toast("The two passwords didn't match. Try again."); return lockJournal(app, after); }
  if (r.pw.length < J.MIN_PASSWORD) { toast(`Use at least ${J.MIN_PASSWORD} characters.`); return lockJournal(app, after); }
  let code;
  try { toast('Locking your journal…', 15000); code = await J.setUp(uid, r.pw); }
  catch (e) { toast(e?.message || "The journal couldn't be locked. Try again."); return; }
  await showRecoveryCode(code, true);
  const n = await sealLeftovers(uid, await J.deviceKey(uid), (i, t) => toast(`Encrypting your pages… ${i} of ${t}`, 15000));
  toast(n ? `Locked. ${n} page${n === 1 ? '' : 's'} and goal${n === 1 ? '' : 's'} encrypted.` : 'Your journal is locked.', 5000);
  after?.();
}

// The one time the recovery code is shown: copy it, save it, or print it, and confirm it's kept.
function showRecoveryCode(code, first) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap recovery-sheet';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Your recovery code">
      <div class="sheet-head"><h2>Save your recovery code</h2></div>
      <p class="muted">If you ever forget your journal password, this code is the only way back into your journal. No one else has a copy, not even Our Circle. Keep it somewhere safe, like your password manager or a printed page with your important papers.</p>
      <p class="recovery-code" aria-label="Recovery code">${esc(code)}</p>
      <div class="row-btns"><button class="btn ghost grow" data-copy>Copy</button><button class="btn ghost grow" data-save>Save as file</button><button class="btn ghost grow" data-print>Print</button></div>
      <label class="check" for="rc_ok"><input type="checkbox" id="rc_ok"> <span>I've saved my recovery code</span></label>
      <div class="sheet-actions"><span></span><button class="btn" data-done disabled>${first ? 'Done, encrypt my journal' : 'Done'}</button></div>
    </div>`;
    document.body.appendChild(wrap);
    const text = `Our Circle journal recovery code

${code}

Use it if you forget your journal password: Journal → Forgot it? Use your recovery code.
Keep it private. Anyone with this code and your account sign-in can open your journal.
`;
    wrap.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Copied. Paste it somewhere safe.'); } catch (e) { toast('Select the code and copy it.'); } };
    wrap.querySelector('[data-save]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'our-circle-journal-recovery-code.txt'; document.body.appendChild(a); a.click(); a.remove(); };
    wrap.querySelector('[data-print]').onclick = () => { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print, or use Copy.'); w.document.write(`<pre style="font:16px/1.5 -apple-system,sans-serif;white-space:pre-wrap">${esc(text)}</pre>`); w.document.close(); w.print(); };
    wrap.querySelector('#rc_ok').onchange = (e) => { wrap.querySelector('[data-done]').disabled = !e.target.checked; };
    wrap.querySelector('[data-done]').onclick = () => { wrap.remove(); resolve(); };
  });
}

// Journal password menu (when locked): change it, get a new recovery code, or lock this phone now.
async function passwordMenu(app, relock) {
  const uid = app.state.uid;
  const r = await sheet({
    title: 'Journal password',
    intro: 'Your journal is encrypted. Only your journal password or your recovery code can open it.',
    submit: 'Done',
    fields: [{ name: 'what', label: 'What would you like to do?', type: 'select', value: 'none', options: [
      { value: 'none', label: 'Nothing, just checking' },
      { value: 'change', label: 'Change my journal password' },
      { value: 'code', label: 'Get a new recovery code' },
      { value: 'lock', label: 'Lock this phone now (ask for the password next time)' },
    ] }],
  });
  if (!r || r.what === 'none') return;
  if (r.what === 'lock') { await J.forgetDevice(uid); toast('Locked on this phone.'); relock(); return; }
  const p = await sheet({ title: r.what === 'change' ? 'Change journal password' : 'New recovery code', submit: 'Continue', fields: [
    { name: 'cur', label: 'Current journal password', type: 'password', required: true },
    ...(r.what === 'change' ? [{ name: 'next', label: 'New journal password', type: 'password', required: true, hint: `At least ${J.MIN_PASSWORD} characters.` }] : []),
  ] });
  if (!p) return;
  try {
    if (r.what === 'change') { if (await J.changePassword(uid, p.cur, p.next)) toast('Journal password changed. Use the new one on your other phones.'); else toast("That's not your current journal password."); }
    else { const code = await J.newRecovery(uid, p.cur); if (code) { await showRecoveryCode(code, false); toast('New recovery code saved. The old one no longer works.'); } else toast("That's not your current journal password."); }
  } catch (e) { toast(e?.message || 'That did not work. Try again.'); }
}

function sectionsFrom(tplKey, settings) {
  if (tplKey === 'custom' && settings?.custom?.length) return settings.custom.map((s) => ({ ...s }));
  return (TEMPLATES[tplKey] || TEMPLATES.daily).sections.map((s) => ({ ...s }));
}
// Turn a layout ({title, list: 3}) into stored content ({title, text} or {title, list: [...]})
const blank = (s) => (s.list ? { title: s.title, list: Array.from({ length: typeof s.list === 'number' ? s.list : s.list.length }, () => '') } : { title: s.title, text: '' });

function page(root, app, date) {
  const st = app.state;
  const base = `journals/${st.uid}`;
  let settings = null, entry = null, saveTimer = null, listening = null, stopGoals = null, key = null;
  // Entries already fetched (date → saved entry, or null for a blank day), so moving between days is instant.
  const loaded = new Map();
  const fetchDay = (d) => {
    if (loaded.has(d)) return Promise.resolve(loaded.get(d));
    return S.getFast(`${base}/entries/${d}`).catch(() => null).then((e) => readEntry(st.uid, key, e)).then((e) => { if (!loaded.has(d)) loaded.set(d, e); return loaded.get(d); });
  };
  // A page that couldn't be decrypted on this phone is shown as such and never edited, so it can't be overwritten.
  const entryFor = (d, e) => (e?.unreadable ? { date: d, template: e.template || 'daily', sections: [], unreadable: true }
    : e ? { ...e, sections: (e.sections || []).map((s) => ({ ...s, list: s.list ? [...s.list] : undefined })) }
    : { date: d, template: settings.defaultTemplate || 'daily', sections: sectionsFrom(settings.defaultTemplate || 'daily', settings).map(blank) });
  const prefetch = () => { fetchDay(addDays(date, -1)); if (addDays(date, 1) <= today()) fetchDay(addDays(date, 1)); };
  // Move to another day in place: save this one, show the next straight away, slide it in.
  const showDay = async (d, from) => {
    if (d === date || d > today()) return;
    if (dirty && entry) doSave();
    listening?.stop();
    const e = loaded.has(d) ? loaded.get(d) : await fetchDay(d);
    date = d; entry = entryFor(d, e);
    enterFrom = from;
    history.replaceState(null, '', `#/journal/${d}`);
    render();
    prefetch();
  };

  const tplOptions = () => [
    ...Object.entries(TEMPLATES).map(([k, t]) => ({ value: k, label: t.label })),
    ...(settings?.custom?.length ? [{ value: 'custom', label: 'My layout' }] : []),
  ];

  let dirty = false;
  const doSave = async () => {
    clearTimeout(saveTimer); dirty = false;
    if (entry?.unreadable) return;
    collect();
    const e = entry, day = date;
    const hasText = e.sections.some((s) => (s.text || '').trim() || (s.list || []).some((x) => x.trim()));
    const label = root.querySelector('#saved');
    try {
      if (hasText || e.saved) {
        const data = { ...e, saved: true, updatedAt: Date.now() };
        loaded.set(day, data);
        const { sections, unreadable, id, ...rest } = data;
        // Locked: only the date and layout name are stored readable; the writing itself is encrypted.
        await S.set(`${base}/entries/${day}`, key ? { ...rest, date: day, enc: await J.seal(key, entryPath(st.uid, day), { sections }) } : { ...rest, date: day, sections });
        e.saved = true;
      }
      if (label) label.textContent = hasText ? 'Saved' : '';
    } catch (e) { if (label) label.textContent = 'Not saved. Check your connection.'; }
  };
  const save = () => {
    dirty = true;
    clearTimeout(saveTimer);
    const label = root.querySelector('#saved');
    if (label) label.textContent = 'Saving…';
    saveTimer = setTimeout(doSave, 700);
  };

  const collect = () => {
    root.querySelectorAll('[data-sec]').forEach((el) => {
      const i = Number(el.dataset.sec);
      if (el.dataset.li != null) entry.sections[i].list[Number(el.dataset.li)] = el.value;
      else entry.sections[i].text = el.value;
    });
  };

  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.max(112, ta.scrollHeight) + 'px'; };

  const render = () => {
    const t = today();
    root.innerHTML = `
      <div class="jr-top">
        <span class="pill">${icon('lock', 14)} ${key ? 'Encrypted' : 'Private'} · only you</span>
        <label class="sr" for="tpl">Journal layout</label>
        <select id="tpl" class="select-pill">${tplOptions().map((o) => `<option value="${o.value}" ${o.value === entry.template ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      </div>
      <article class="paper">
        <div class="paper-head">
          <div><div class="paper-day">${weekday(date)}</div><div class="paper-date">${longDate(date)}</div></div>
          <div class="paper-page">Page ${dayOfYear(date)}<br>of ${date.slice(0, 4)}</div>
        </div>
        <p class="paper-prompt">${esc(promptFor(date))}</p>
        ${entry.unreadable ? `<p class="error">This page couldn't be opened on this phone. It's still saved safely. Try "Lock this phone now" under Journal password, then unlock again with your journal password.</p>` : ''}
        ${entry.sections.map((s, i) => `
          <div class="sec">
            <div class="sec-head"><span class="sec-title">${esc(s.title)}</span>
              ${SR ? `<button class="mic-sm" data-mic="${i}" aria-label="Speak into ${esc(s.title)}">${icon('mic', 16)}</button>` : ''}</div>
            ${s.list
              ? `<ol class="lines">${s.list.map((v, j) => `<li><label class="sr" for="s${i}_${j}">${esc(s.title)} ${j + 1}</label><input id="s${i}_${j}" data-sec="${i}" data-li="${j}" value="${esc(v)}" placeholder="${j === 0 ? 'Type or tap the mic on your keyboard' : ''}"></li>`).join('')}</ol>`
              : `<label class="sr" for="s${i}">${esc(s.title)}</label><textarea id="s${i}" class="ruled" data-sec="${i}" placeholder="Tap here, then the microphone on your keyboard to speak.">${esc(s.text || '')}</textarea>`}
          </div>`).join('')}
        <div class="paper-foot"><button class="linkish" data-act="layout">${icon('edit', 15)} Edit layout</button><span id="saved" class="muted small">${entry.saved ? 'Saved' : ''}</span></div>
        <div id="goals" class="goals"></div>
      </article>
      <div class="jr-nav">
        <a class="btn ghost sm" href="#/journal/${addDays(date, -1)}" aria-label="Previous day">${icon('back', 16)} ${shortDate(addDays(date, -1))}</a>
        <a class="btn ghost sm" href="#/journal/past">${icon('cal', 16)} Past pages</a>
        ${date < t ? `<a class="btn ghost sm" href="#/journal/${addDays(date, 1)}" aria-label="Next day">${shortDate(addDays(date, 1))} ${icon('next', 16)}</a>` : '<span class="btn-spacer"></span>'}
      </div>
      <div class="jr-actions">
        ${date !== t ? `<a class="linkish" href="#/journal">Go to today</a>` : ''}
        <a class="linkish" href="#/book">${icon('print', 15)} Make a printed book</a>
        ${key ? `<button class="linkish" data-act="jpw">${icon('lock', 15)} Journal password</button>` : `<button class="linkish" data-act="jlock">${icon('lock', 15)} Lock my journal</button>`}
      </div>
      <p class="hint center pad-x swipe-hint">Swipe the page left or right to change days.</p>
      ${SR ? '' : '<p class="hint center pad-x">Tip: tap a box, then the microphone on your phone keyboard to speak your entry.</p>'}`;
    root.querySelectorAll('textarea.ruled').forEach(grow);
    if (enterFrom) { root.querySelector('.paper')?.classList.add('enter-' + enterFrom); enterFrom = null; }
    if (stopGoals) stopGoals();
    stopGoals = goalsBlock(root, base, date, st.uid, key);
  };

  const onInput = (e) => { if (e.target.matches('textarea.ruled')) grow(e.target); if (e.target.dataset.sec != null) save(); };
  const onChange = async (e) => {
    if (e.target.id !== 'tpl') return;
    collect();
    const old = entry.sections;
    const next = sectionsFrom(e.target.value, settings).map(blank);
    // keep anything already written
    next.forEach((s) => { const o = old.find((x) => x.title === s.title); if (o) Object.assign(s, o); });
    old.forEach((o) => { const used = (o.text || '').trim() || (o.list || []).some((x) => x.trim()); if (used && !next.find((s) => s.title === o.title)) next.push(o); });
    entry.template = e.target.value; entry.sections = next;
    render(); save();
    await S.set(base, { defaultTemplate: entry.template }, true).catch(() => {});
  };
  const onClick = async (e) => {
    const mic = e.target.closest('[data-mic]');
    if (mic) { dictate(Number(mic.dataset.mic), mic); return; }
    if (e.target.closest('[data-act="layout"]')) editLayout();
    if (e.target.closest('[data-act="jlock"]')) { collect(); if (dirty) await doSave(); lockJournal(app, start); }
    if (e.target.closest('[data-act="jpw"]')) passwordMenu(app, start);
    const day = e.target.closest('a[href^="#/journal/"]');
    const m = day && day.getAttribute('href').match(/^#\/journal\/(\d{4}-\d{2}-\d{2})$/);
    if (m) { e.preventDefault(); showDay(m[1], m[1] > date ? 'right' : 'left'); }
  };

  function dictate(i, btn) {
    if (listening) { listening.stop(); return; }
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true; rec.interimResults = false;
    listening = rec; btn.classList.add('on');
    rec.onresult = (ev) => {
      let said = '';
      for (let k = ev.resultIndex; k < ev.results.length; k++) if (ev.results[k].isFinal) said += ev.results[k][0].transcript;
      if (!said) return;
      collect();
      const s = entry.sections[i];
      if (s.list) { const k = s.list.findIndex((x) => !x.trim()); s.list[k < 0 ? s.list.length - 1 : k] = said.trim(); }
      else s.text = (s.text ? s.text.trimEnd() + ' ' : '') + said.trim();
      render(); save();
    };
    rec.onend = () => { listening = null; root.querySelectorAll('.mic-sm.on').forEach((b) => b.classList.remove('on')); };
    rec.onerror = () => toast('The microphone is not available here. Use the mic on your keyboard instead.');
    try { rec.start(); } catch (er) { listening = null; }
  }

  async function editLayout() {
    collect();
    const lines = entry.sections.map((s) => (s.list ? `${s.title} [${s.list.length}]` : s.title)).join('\n');
    const r = await sheet({
      title: 'Edit layout',
      intro: 'One section per line. Add [3] after a title to make a numbered list of 3, like the gratitude list.',
      fields: [
        { name: 'lines', label: 'Sections', type: 'textarea', rows: 6, value: lines },
        { name: 'keep', label: 'Use this layout for new pages (saved as "My layout")', type: 'checkbox', value: false },
      ],
    });
    if (!r) return;
    const layout = r.lines.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)\s*\[(\d+)\]$/);
      return m ? { title: m[1].trim(), list: Math.min(10, Math.max(1, Number(m[2]))) } : { title: l };
    });
    if (!layout.length) return;
    const next = layout.map((s) => {
      const o = entry.sections.find((x) => x.title === s.title);
      if (o && !!o.list === !!s.list) return s.list ? { title: s.title, list: Array.from({ length: s.list }, (_, k) => o.list[k] || '') } : o;
      return blank(s);
    });
    entry.sections = next;
    if (r.keep) {
      settings = { ...(settings || {}), custom: layout, defaultTemplate: 'custom' };
      entry.template = 'custom';
      await S.set(base, { custom: layout, defaultTemplate: 'custom' }, true).catch(() => {});
    }
    render(); save();
  }

  // Swipe the page: right for the day before, left for the day after (not past today).
  // The page follows your finger; off while typing so it never fights selecting text.
  let sx = 0, sy = 0, dx = 0, tracking = false, decided = false, horizontal = false;
  const paper = () => root.querySelector('.paper');
  const typing = () => document.activeElement?.matches?.('input, textarea, select');
  const turnTo = (dir) => {
    const next = addDays(date, dir);
    if (dir > 0 && next > today()) return false;
    showDay(next, dir > 0 ? 'right' : 'left');
    return true;
  };
  const onTouchStart = (e) => {
    if (e.touches.length !== 1 || typing() || !e.target.closest('.paper') || e.target.closest('.goals')) { tracking = false; return; }
    tracking = true; decided = false; horizontal = false; dx = 0;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  };
  const onTouchMove = (e) => {
    if (!tracking) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (!decided && (Math.abs(x) > 10 || Math.abs(y) > 10)) { decided = true; horizontal = Math.abs(x) > Math.abs(y) * 1.4; }
    if (!horizontal) return;
    e.preventDefault();
    const atToday = x < 0 && addDays(date, 1) > today();
    dx = atToday ? x / 4 : x; // a little give at today, so it's clear there's no next page
    const p = paper(); if (p) { p.style.transition = 'none'; p.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`; }
  };
  const onTouchEnd = () => {
    if (!tracking) return;
    tracking = false;
    const p = paper();
    if (horizontal && Math.abs(dx) > Math.min(90, window.innerWidth * 0.22) && turnTo(dx < 0 ? 1 : -1)) return;
    if (p) { p.style.transition = 'transform 220ms cubic-bezier(.2,.9,.3,1.2)'; p.style.transform = ''; }
  };
  // Left and right arrow keys do the same on a computer (when not typing).
  const onKey = (e) => { if (!typing() && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) turnTo(e.key === 'ArrowRight' ? 1 : -1); };
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('touchend', onTouchEnd);
  root.addEventListener('touchcancel', onTouchEnd);
  document.addEventListener('keydown', onKey);

  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  // Open (or reopen after locking): get the key if the journal is locked, then load the day.
  const start = async () => {
    root.innerHTML = '<p class="pad muted">Opening your journal…</p>';
    const k = await journalKey(root, st.uid);
    key = k.key; settings = k.settings; loaded.clear();
    entry = entryFor(date, await fetchDay(date));
    render();
    prefetch();
  };
  start();
  return { destroy: () => { if (dirty && entry) doSave(); listening?.stop(); if (stopGoals) stopGoals();
    root.removeEventListener('touchstart', onTouchStart); root.removeEventListener('touchmove', onTouchMove); root.removeEventListener('touchend', onTouchEnd); root.removeEventListener('touchcancel', onTouchEnd); document.removeEventListener('keydown', onKey);
    root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); } };
}

const entryText = (e) => (e.sections || []).map((s) => [s.title, s.text || '', ...(s.list || [])].join(' ')).join(' ');

function past(root, app) {
  const uid = app.state.uid;
  const base = `journals/${uid}/entries`;
  let all = [], q = '';
  const render = () => {
    const rows = q ? all.filter((e) => entryText(e).toLowerCase().includes(q.toLowerCase())) : all;
    root.querySelector('#plist').innerHTML = rows.length ? rows.map((e) => {
      const firstText = (e.sections || []).map((s) => s.text || (s.list || []).filter(Boolean).join(', ')).find((x) => x && x.trim()) || '';
      return `<a class="li" href="#/journal/${e.date}"><span class="datechip"><b>${shortDate(e.date).split(' ')[0]}</b><span>${parse(e.date).getDate()}</span></span>
        <span class="li-main"><span class="li-title">${weekday(e.date)}, ${longDate(e.date)}</span><span class="li-sub">${esc(firstText.slice(0, 90))}</span></span></a>`;
    }).join('') : `<p class="pad muted">${q ? 'No pages match that search.' : 'No pages yet. Today is a good day to start.'}</p>`;
  };
  journalKey(root, uid).then(async ({ key }) => {
    root.innerHTML = `
      <header class="top"><a class="icon-btn" href="#/journal" aria-label="Back to today">${icon('back')}</a><div class="grow"><h1 class="h1">Past pages</h1><div class="muted small">${icon('lock', 12)} ${key ? 'Encrypted' : 'Private'} · only you</div></div></header>
      <div class="pad-x"><label class="search" for="jq">${icon('search', 18)}<input id="jq" type="search" placeholder="Search your journal"></label></div>
      <section class="block"><div class="card list" id="plist"><p class="pad muted">Loading…</p></div></section>`;
    root.querySelector('#jq').addEventListener('input', (e) => { q = e.target.value.trim(); render(); });
    // Searching happens on this phone, after decrypting, so the server never sees what you search for.
    all = await readEntries(uid, key, await S.getColl(base, { orderBy: ['date', 'desc'] }));
    render();
  });
  return {};
}

// ───────── Printed book (Blurb-ready PDF via the browser's Save as PDF) ─────────
function book(root, app) {
  journalKey(root, app.state.uid).then(({ key }) => bookForm(root, app, key));
  return {};
}
function bookForm(root, app, key) {
  const me = app.myMember();
  const t = today();
  root.innerHTML = `
    <header class="top no-print"><a class="icon-btn" href="#/journal" aria-label="Back to journal">${icon('back')}</a><div class="grow"><h1 class="h1">Make a printed book</h1><div class="muted small">Your journal, laid out as book pages</div></div></header>
    <form class="block card stack no-print" id="bk">
      <label class="field" for="bt"><span>Book title</span><input id="bt" value="${esc((me?.name || 'My') + "'s Journal")}"></label>
      <div class="two"><label class="field" for="bf"><span>From</span><input id="bf" type="date" value="${t.slice(0, 4)}-01-01"></label>
      <label class="field" for="bu"><span>To</span><input id="bu" type="date" value="${t}"></label></div>
      <label class="field" for="bs"><span>Page size</span><select id="bs"><option value="6in 9in">6 × 9 in (trade book)</option><option value="8in 10in">8 × 10 in</option><option value="5.5in 8.5in">5.5 × 8.5 in</option></select></label>
      <label class="check" for="bo"><input type="checkbox" id="bo"> <span>Start each day on a new page</span></label>
      <button class="btn" type="submit">Preview book</button>
      <p class="hint">Then tap <b>Print / Save as PDF</b>. Upload that PDF to Blurb (their PDF-to-Book option) using the same page size. Check Blurb's current page-size and margin guide before ordering.</p>
    </form>
    <div id="bookout"></div>`;
  root.querySelector('#bk').onsubmit = async (e) => {
    e.preventDefault();
    const from = root.querySelector('#bf').value, to = root.querySelector('#bu').value;
    const size = root.querySelector('#bs').value, each = root.querySelector('#bo').checked;
    const title = root.querySelector('#bt').value.trim() || 'My Journal';
    const rows = (await readEntries(app.state.uid, key, await S.getColl(`journals/${app.state.uid}/entries`, { orderBy: ['date', 'asc'] })))
      .filter((x) => x.date >= from && x.date <= to && entryText(x).replace(/\s+/g, ' ').trim().length > 0);
    let pageStyle = document.getElementById('book-page-style');
    if (!pageStyle) { pageStyle = document.createElement('style'); pageStyle.id = 'book-page-style'; document.head.appendChild(pageStyle); }
    pageStyle.textContent = `@page { size: ${size}; margin: 0.75in 0.6in 0.7in 0.75in; }`;
    const out = root.querySelector('#bookout');
    out.innerHTML = `
      <div class="no-print block row-btns"><button class="btn grow" id="printbtn">${icon('print')} Print / Save as PDF</button></div>
      <p class="no-print hint center">${rows.length} day${rows.length === 1 ? '' : 's'} included.</p>
      <div class="bookdoc ${each ? 'each' : ''}">
        <section class="b-title"><h1>${esc(title)}</h1><p>${esc(me?.name || '')}</p><p class="b-years">${from.slice(0, 4)}${to.slice(0, 4) !== from.slice(0, 4) ? '–' + to.slice(0, 4) : ''}</p></section>
        ${rows.map((x) => `<section class="b-day">
          <h2>${weekday(x.date)}</h2><div class="b-date">${longDate(x.date)}</div>
          ${(x.sections || []).filter((s) => (s.text || '').trim() || (s.list || []).some((v) => v.trim())).map((s) => `
            <h3>${esc(s.title)}</h3>
            ${s.list ? `<ol>${s.list.filter((v) => v.trim()).map((v) => `<li>${esc(v)}</li>`).join('')}</ol>` : esc(s.text).split(/\n+/).map((p) => `<p>${p}</p>`).join('')}`).join('')}
        </section>`).join('')}
      </div>`;
    out.querySelector('#printbtn').onclick = () => window.print();
    out.scrollIntoView({ behavior: 'smooth' });
  };
  return {};
}

// ───────── Goals (private, under journals/{you}/goals) ─────────
const FREQ = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
// The period a date belongs to: the day, the week (starting Sunday), or the month.
export function periodKey(freq, date) {
  if (freq === 'monthly') return date.slice(0, 7);
  if (freq === 'weekly') return addDays(date, -parse(date).getDay());
  return date;
}
function recentPeriods(freq, date) {
  const out = [];
  if (freq === 'daily') for (let i = 6; i >= 0; i--) out.push(addDays(date, -i));
  else if (freq === 'weekly') { const w = periodKey('weekly', date); for (let i = 7; i >= 0; i--) out.push(addDays(w, -7 * i)); }
  else { const d = parse(date); for (let i = 5; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); } }
  return out;
}
const periodWord = { daily: 'today', weekly: 'this week', monthly: 'this month' };
const periodSpan = { daily: 'last 7 days', weekly: 'last 8 weeks', monthly: 'last 6 months' };

function goalsBlock(root, base, date, uid, key) {
  const box = root.querySelector('#goals');
  let goals = [];
  let live = true;
  // Locked journals store each goal's name encrypted; decrypt for showing.
  const readGoals = (rows) => Promise.all(rows.map(async (g) => {
    if (!g.enc) return g;
    if (!key) return { ...g, title: '(locked)' };
    try { return { ...g, title: (await J.open(key, goalPath(uid, g.id), g.enc)).title }; } catch (e) { return { ...g, title: '(could not open)' }; }
  }));
  const draw = () => {
    if (!box.isConnected) return;
    const active = goals.filter((g) => !g.archived).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    box.innerHTML = `
      <div class="goals-head"><span class="sec-title">My goals</span><button class="linkish" data-goal="add">${icon('plus', 15)} Add goal</button></div>
      ${active.length ? ['daily', 'weekly', 'monthly'].map((f) => {
        const gs = active.filter((g) => g.freq === f);
        if (!gs.length) return '';
        return `<div class="goal-group"><div class="goal-freq">${FREQ[f]}</div>${gs.map((g) => {
          const key = periodKey(f, date);
          const done = !!g.done?.[key];
          const ps = recentPeriods(f, date);
          const hits = ps.filter((p) => g.done?.[p]).length;
          return `<div class="goal">
            <label class="goal-check" for="g_${g.id}"><input type="checkbox" id="g_${g.id}" data-goal-check="${g.id}" ${done ? 'checked' : ''}><span class="sr">Done ${periodWord[f]}:</span></label>
            <button class="goal-title" data-goal="edit" data-id="${g.id}">${esc(g.title)}</button>
            <span class="goal-track" title="${hits} of ${ps.length}, ${periodSpan[f]}" aria-label="${hits} of ${ps.length} in the ${periodSpan[f]}">${ps.map((p) => `<i class="${g.done?.[p] ? 'on' : ''} ${p === key ? 'now' : ''}"></i>`).join('')}<small>${hits}/${ps.length}</small></span>
          </div>`;
        }).join('')}</div>`;
      }).join('') : '<p class="goal-empty">Add something you want to keep up with, like reading scriptures daily, a date night weekly, or calling Grandma monthly.</p>'}`;
  };
  const onClick = async (e) => {
    const b = e.target.closest('[data-goal]');
    if (!b) return;
    const g = goals.find((x) => x.id === b.dataset.id);
    const r = await sheet({
      title: g ? 'Edit goal' : 'Add a goal',
      intro: 'Goals are private, like the rest of your journal.',
      danger: g ? 'Delete goal' : null,
      fields: [
        { name: 'title', label: 'Goal', value: g?.title || '', placeholder: 'Read scriptures', required: true },
        { name: 'freq', label: 'How often?', type: 'select', value: g?.freq || 'daily', options: Object.entries(FREQ).map(([value, label]) => ({ value, label })) },
      ],
    });
    if (!r) return;
    if (r.__danger) { await S.del(`${base}/goals/${g.id}`); return; }
    const id = g?.id || S.newId();
    const name = key ? { enc: await J.seal(key, goalPath(uid, id), { title: r.title }) } : { title: r.title };
    if (g) await S.update(`${base}/goals/${id}`, { ...name, freq: r.freq });
    else await S.set(`${base}/goals/${id}`, { ...name, freq: r.freq, done: {}, archived: false, createdAt: Date.now() });
  };
  const onChange = async (e) => {
    const id = e.target.dataset.goalCheck;
    if (!id) return;
    const g = goals.find((x) => x.id === id);
    await S.update(`${base}/goals/${id}`, { ['done.' + periodKey(g.freq, date)]: e.target.checked });
  };
  box.addEventListener('click', onClick);
  box.addEventListener('change', onChange);
  const unsub = S.watchColl(`${base}/goals`, {}, async (rows) => { const g = await readGoals(rows); if (live) { goals = g; draw(); } });
  return () => { live = false; unsub(); };
}
