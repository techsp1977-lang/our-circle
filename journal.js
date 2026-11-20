// Private journal. Stored under journals/{your account}, which only you can read.
// Also the printable book export (#/book).
import * as S from './store.js';
import { esc, icon, sheet, toast } from './ui.js';
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

function sectionsFrom(tplKey, settings) {
  if (tplKey === 'custom' && settings?.custom?.length) return settings.custom.map((s) => ({ ...s }));
  return (TEMPLATES[tplKey] || TEMPLATES.daily).sections.map((s) => ({ ...s }));
}
// Turn a layout ({title, list: 3}) into stored content ({title, text} or {title, list: [...]})
const blank = (s) => (s.list ? { title: s.title, list: Array.from({ length: typeof s.list === 'number' ? s.list : s.list.length }, () => '') } : { title: s.title, text: '' });

function page(root, app, date) {
  const st = app.state;
  const base = `journals/${st.uid}`;
  let settings = null, entry = null, saveTimer = null, listening = null, stopGoals = null;

  const tplOptions = () => [
    ...Object.entries(TEMPLATES).map(([k, t]) => ({ value: k, label: t.label })),
    ...(settings?.custom?.length ? [{ value: 'custom', label: 'My layout' }] : []),
  ];

  let dirty = false;
  const doSave = async () => {
    clearTimeout(saveTimer); dirty = false;
    collect();
    const hasText = entry.sections.some((s) => (s.text || '').trim() || (s.list || []).some((x) => x.trim()));
    const label = root.querySelector('#saved');
    try {
      if (hasText || entry.saved) { await S.set(`${base}/entries/${date}`, { ...entry, saved: true, updatedAt: Date.now() }); entry.saved = true; }
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
        <span class="pill">${icon('lock', 14)} Private · only you</span>
        <label class="sr" for="tpl">Journal layout</label>
        <select id="tpl" class="select-pill">${tplOptions().map((o) => `<option value="${o.value}" ${o.value === entry.template ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      </div>
      <article class="paper">
        <div class="paper-head">
          <div><div class="paper-day">${weekday(date)}</div><div class="paper-date">${longDate(date)}</div></div>
          <div class="paper-page">Page ${dayOfYear(date)}<br>of ${date.slice(0, 4)}</div>
        </div>
        <p class="paper-prompt">${esc(promptFor(date))}</p>
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
      </div>
      <p class="hint center pad-x swipe-hint">Swipe the page left or right to change days.</p>
      ${SR ? '' : '<p class="hint center pad-x">Tip: tap a box, then the microphone on your phone keyboard to speak your entry.</p>'}`;
    root.querySelectorAll('textarea.ruled').forEach(grow);
    if (enterFrom) { root.querySelector('.paper')?.classList.add('enter-' + enterFrom); enterFrom = null; }
    if (stopGoals) stopGoals();
    stopGoals = goalsBlock(root, base, date);
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
    enterFrom = dir > 0 ? 'right' : 'left';
    const p = paper();
    if (p) { p.style.transition = 'transform 180ms ease-in, opacity 180ms ease-in'; p.style.transform = `translateX(${dir > 0 ? -100 : 100}%)`; p.style.opacity = '0'; }
    setTimeout(() => app.go(`#/journal/${next}`), 170);
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
  root.innerHTML = '<p class="pad muted">Opening your journal…</p>';
  Promise.all([S.get(base).catch(() => null), S.get(`${base}/entries/${date}`).catch(() => null)]).then(([s, e]) => {
    settings = s || {};
    const tpl = settings.defaultTemplate || 'daily';
    entry = e ? { ...e } : { date, template: tpl, sections: sectionsFrom(tpl, settings).map(blank) };
    render();
  });
  return { destroy: () => { if (dirty && entry) doSave(); listening?.stop(); if (stopGoals) stopGoals();
    root.removeEventListener('touchstart', onTouchStart); root.removeEventListener('touchmove', onTouchMove); root.removeEventListener('touchend', onTouchEnd); root.removeEventListener('touchcancel', onTouchEnd); document.removeEventListener('keydown', onKey);
    root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); } };
}

const entryText = (e) => (e.sections || []).map((s) => [s.title, s.text || '', ...(s.list || [])].join(' ')).join(' ');

function past(root, app) {
  const base = `journals/${app.state.uid}/entries`;
  let all = [], q = '';
  const render = () => {
    const rows = q ? all.filter((e) => entryText(e).toLowerCase().includes(q.toLowerCase())) : all;
    root.querySelector('#plist').innerHTML = rows.length ? rows.map((e) => {
      const firstText = (e.sections || []).map((s) => s.text || (s.list || []).filter(Boolean).join(', ')).find((x) => x && x.trim()) || '';
      return `<a class="li" href="#/journal/${e.date}"><span class="datechip"><b>${shortDate(e.date).split(' ')[0]}</b><span>${parse(e.date).getDate()}</span></span>
        <span class="li-main"><span class="li-title">${weekday(e.date)}, ${longDate(e.date)}</span><span class="li-sub">${esc(firstText.slice(0, 90))}</span></span></a>`;
    }).join('') : `<p class="pad muted">${q ? 'No pages match that search.' : 'No pages yet. Today is a good day to start.'}</p>`;
  };
  root.innerHTML = `
    <header class="top"><a class="icon-btn" href="#/journal" aria-label="Back to today">${icon('back')}</a><div class="grow"><h1 class="h1">Past pages</h1><div class="muted small">${icon('lock', 12)} Private · only you</div></div></header>
    <div class="pad-x"><label class="search" for="jq">${icon('search', 18)}<input id="jq" type="search" placeholder="Search your journal"></label></div>
    <section class="block"><div class="card list" id="plist"><p class="pad muted">Loading…</p></div></section>`;
  root.querySelector('#jq').addEventListener('input', (e) => { q = e.target.value.trim(); render(); });
  S.getColl(base, { orderBy: ['date', 'desc'] }).then((rows) => { all = rows; render(); });
  return {};
}

// ───────── Printed book (Blurb-ready PDF via the browser's Save as PDF) ─────────
function book(root, app) {
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
    const rows = (await S.getColl(`journals/${app.state.uid}/entries`, { orderBy: ['date', 'asc'] }))
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

function goalsBlock(root, base, date) {
  const box = root.querySelector('#goals');
  let goals = [];
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
    if (g) await S.update(`${base}/goals/${g.id}`, { title: r.title, freq: r.freq });
    else await S.add(`${base}/goals`, { title: r.title, freq: r.freq, done: {}, archived: false, createdAt: Date.now() });
  };
  const onChange = async (e) => {
    const id = e.target.dataset.goalCheck;
    if (!id) return;
    const g = goals.find((x) => x.id === id);
    await S.update(`${base}/goals/${id}`, { ['done.' + periodKey(g.freq, date)]: e.target.checked });
  };
  box.addEventListener('click', onClick);
  box.addEventListener('change', onChange);
  const unsub = S.watchColl(`${base}/goals`, {}, (rows) => { goals = rows; draw(); });
  return () => { unsub(); };
}
