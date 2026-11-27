// Family hub: coming up, today's big days, weekly check-ins, the family chart.
import * as S from './store.js';
import { planState, fmtGB, pausedText } from './plans.js';
import { mapHTML, drawMap, openHousehold } from './familymap.js';
import { pushCard, pushCardClick, cachedPush } from './push.js';
import { birthdayOf } from './birthdays.js';
import { esc, icon, face, toast, sheet, listJoin, names, hhColor, hhVars, hhLight, why, familyTree } from './ui.js';
import { pickAndCrop } from './crop.js';
import { today, monShort, dayNum, whenText, rangeText, diffDays, weekday, shortDate, monthName, agoText, dayOfYear } from './dates.js';
import { upcoming, happeningToday, headline, editEvent, canEdit, isCalendarType, typeOf, byMonth } from './events.js';


export function mount(root, app) {
  const st = app.state;
  let journalDone = false;
  let sayingShift = 0; // tap the saying to see the next one
  let famView = (() => { try { return localStorage.getItem('oc-famview') || 'circles'; } catch (e) { return 'circles'; } })();

  const render = () => {
    const me = app.myMember();
    if (!me) { root.innerHTML = '<p class="pad muted">Loading…</p>'; return; }
    const t = today();

    // Coming up: trips and family events
    // The next three things coming up, of any kind (the Calendar tab has the full list). Today's big days
    // already have their own card above, so they aren't repeated.
    const shownToday = new Set(happeningToday(app).map((ev) => ev.id));
    const next = upcoming(app, { days: 400 }).filter(({ ev }) => !shownToday.has(ev.id)).slice(0, 3);
    const setup = setupSteps(app);
    // Today's big days
    const todays = happeningToday(app).filter((ev) => !isCalendarType(ev) || ev.date === t);
    // Households past their check-in window
    const due = st.households.filter((h) => checkin(app, h.id)?.overdue);
    // Birthdays & big days: this month and next month only


    root.innerHTML = `
      <header class="top">
        <div><div class="eyebrow">${esc(me.name)}'s circle</div>
          <h1 class="display"><button class="circle-switch" data-act="switch" aria-label="${esc(st.circle?.name || 'Our family')}. Switch circles">${esc(st.circle?.name || 'Our family')}<span class="chev" aria-hidden="true">${icon('next', 18)}</span></button></h1></div>
        <div class="top-btns">
          ${app.isAdmin() || app.runsAny() ? `<a class="icon-btn" href="#/manage" aria-label="${app.isAdmin() ? 'Family' : 'Household'} settings">${icon('gear')}</a>` : ''}
        </div>
      </header>
      ${planNotice(app)}
      ${setup ? setupCard(setup) : ''}
      ${hasWords(app) ? familyWords(app, t, sayingShift) : ''}
      ${todays.length ? `<section class="block stack-sm">${todays.map((ev) => todayCard(app, ev)).join('')}</section>` : ''}
      ${due.length ? `<section class="block"><div class="card checkin-strip">
        <div class="cs-head">${icon('bell', 18)}<b>Time to check in</b><button class="linkish cs-done" data-act="checkin-done">${icon('check', 15)} ${due.length > 1 ? 'Clear…' : 'Done'}</button></div>
        <div class="cs-chips">${due.map((h) => { const ppl = app.membersOf(h.id); const single = ppl.length === 1;
          return `<button class="cs-chip" style="${hhVars(h)}" data-act="${single ? 'msg-member' : 'msg-household'}" data-id="${esc(single ? ppl[0].id : h.id)}">${names(h.name)}</button>`; }).join('')}</div>
      </div></section>` : ''}
      ${famView === 'circles' ? `<section class="block fam-wrap" aria-label="Family circles">${mapHTML()}</section>` : `<section class="block tree" aria-label="Family tree">
        ${familyTree(st.households).map(({ h, depth }) => `<div class="tree-row" style="--depth:${Math.min(depth, 3)}">${householdCard(app, h, h.id === me.householdId)}</div>`).join('')
          || `<div class="card empty-card">${app.isAdmin() ? '<a href="#/manage">Add your family members</a> to see everyone here.' : 'No one else yet.'}</div>`}
      </section>`}
      <p class="center fam-switch"><button class="linkish" data-act="famview" data-id="${famView === 'circles' ? 'list' : 'circles'}">${famView === 'circles' ? `${icon('users', 15)} Show as a list` : `${icon('family', 15)} Show as circles`}</button></p>
      <section class="block">
        <div class="row-btns compact">
          <button class="btn sm" data-act="everyone">${icon('users', 17)} Message everyone</button>
          <button class="btn sm ghost" data-act="new-group">${icon('plus', 16)} New group</button>
        </div>
      </section>
      ${setup ? '' : pushCard()}
      <section class="block">
        <div class="row-head"><h2>Next up</h2><a class="linkish" href="#/calendar">See calendar</a></div>
        ${next.length ? `<div class="card list">${next.map(({ ev, occ }) => `
          <button class="li" data-act="${canEdit(app, ev) ? 'edit-event' : 'noop'}" data-id="${esc(ev.id)}">
            <span class="datechip ${occ.start === t ? 'gold' : isCalendarType(ev) ? 'trip' : ''}"><b>${monShort(occ.start)}</b><span>${ev.endDate && ev.endDate !== ev.date ? rangeText(ev).replace(/^[A-Za-z]+ /, '') : dayNum(occ.start)}</span></span>
            <span class="li-main"><span class="li-title">${esc(isCalendarType(ev) ? ev.title : headline(app, ev, occ.start))}</span><span class="li-sub">${esc(typeOf(ev.type).label)}${ev.endDate ? ` · ${diffDays(ev.date, ev.endDate) + 1} days` : ''}</span></span>
            <span class="li-when">${occ.start <= t ? 'Now' : esc(whenText(occ.start))}</span>
          </button>`).join('')}</div>`
        : `<button class="card empty-card" data-act="add-event">Add a trip, reunion or family event so everyone can see it.</button>`}
      </section>
      ${(() => { const m = new Date().getMonth(), y = new Date().getFullYear() - (m === 0 ? 1 : 0);
        return m === 11 || m === 0 ? `<section class="block"><button class="card yr-card" data-act="year">
          <span class="yr-card-ic" aria-hidden="true">🎬</span><span class="li-main"><span class="li-title">Watch our ${y}</span>
          <span class="li-sub">A 1, 3 or 5 minute video of the family's year, for the TV at your next gathering</span></span>${icon('next', 18)}</button></section>` : ''; })()}
      <section class="block">
        <a class="card link-card" href="#/journal">
          <span class="sq">${icon('book', 22)}</span>
          <span class="li-main"><span class="li-title">Today's journal page</span><span class="li-sub">${weekday(t)}, ${shortDate(t)} · ${journalDone ? 'written' : 'not written yet'}</span></span>
          ${icon('next', 18)}
        </a>
      </section>
      ${hasWords(app) ? '' : familyWords(app, t, sayingShift)}`;
    if (famView === 'circles') drawMap(app, root);
  };

  const onClick = async (e) => {
    if (await pushCardClick(e, st.uid, render, toast)) return;
    const sb = e.target.closest('[data-setup]');
    if (sb) {
      const step = sb.dataset.setup;
      if (step === 'hide') { try { localStorage.setItem('oc-setup-hide-' + st.cid, '1'); } catch (er) {} render(); return; }
      if (step === 'bday') { await editEvent(app, null, { type: 'birthday', recurring: true, memberIds: [st.me] }); return; }
      if (step === 'hi') { app.go('#/chat/everyone'); return; }
      if (step === 'push') { app.go('#/me'); return; }
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'add-event': editEvent(app, null, { type: 'trip' }); break;
      case 'switch': app.openSwitcher(); break;
      case 'edit-words': editWords(app); break;
      case 'next-saying': sayingShift++; render(); break;
      case 'edit-event': { const ev = st.events.find((x) => x.id === id); if (ev) editEvent(app, ev); break; }
      case 'everyone': app.go('#/chat/everyone'); break;
      case 'me': app.go('#/me'); break;
      case 'photo': {
        const f = await pickAndCrop('Your photo');
        if (!f) break;
        toast('Saving photo…');
        try { const [m] = await app.uploadFiles([f]); await app.setMyPhoto(m.url); toast('Photo saved in all your circles.'); }
        catch (er) { toast(why('The photo did not save.', er), 9000); }
        break;
      }
      case 'alerts': showAlerts(app); break;
      case 'checkin-done': {
        if (st.households.filter((h) => checkin(app, h.id)?.overdue).length > 1) { showAlerts(app); break; }
        const hids = st.households.filter((h) => checkin(app, h.id)?.overdue).map((h) => h.id);
        await app.clearNudges({ households: hids });
        toast(`Cleared. You'll get a new nudge in ${app.checkinDays()} days if you haven't messaged them.`, 5000);
        render(); break;
      }
      case 'hh-open': openHousehold(app, id, onClick); break;
      case 'year': import('./yearvideo.js').then((m) => m.openYearVideo(app)); break;
      case 'famview': {
        if (famView === id) break;
        famView = id; try { localStorage.setItem('oc-famview', id); } catch (er) {}
        render();
        break;
      }
      case 'msg-household': app.go('#/chat/' + (await app.chatForHousehold(id))); break;
      case 'msg-member': app.go('#/chat/' + (await app.chatFor([id]))); break;
      case 'celebrate': {
        const ev = st.events.find((x) => x.id === id);
        const ids = (ev.memberIds || []).filter((m) => m !== st.me);
        const chatId = ids.length ? await app.chatFor(ids, { name: listJoin(ids.map((m) => app.member(m)?.name)), kind: 'group' }) : 'everyone';
        try { sessionStorage.setItem('oc-draft-' + chatId, b.dataset.text || ''); } catch (er) {}
        app.go('#/chat/' + chatId);
        break;
      }
      case 'new-group': newGroup(app); break;
    }
  };
  root.addEventListener('click', onClick);
  const off = app.on(render);
  render();
  S.get(`journals/${st.uid}/entries/${today()}`).then((d) => { journalDone = !!d; render(); }).catch(() => {});
  return { destroy: () => { off(); root.removeEventListener('click', onClick); } };
}

// Plan notices (only once the owner has switched plans on): uploads paused, trial ending, storage nearly full.
function planNotice(app) {
  const st = app.state, c = st.circle || {};
  if (!st.billingOn) return '';
  const admin = app.isAdmin(), p = planState(c);
  let text = '', btn = '';
  if (c.paused) { text = pausedText(c, admin); btn = admin ? (c.paused === 'storage' ? 'Get more storage' : 'Choose a plan') : ''; }
  else if (admin && p.plan === 'trial' && p.daysLeft <= 7) { text = `Your family's free trial ends in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}. Choose a plan to keep sharing photos and videos.`; btn = 'Choose a plan'; }
  else if (admin && p.active && p.used >= p.limit * 0.9) { text = `Storage is almost full: ${fmtGB(p.used)} of ${fmtGB(p.limit)} used.`; btn = p.plan === 'family' ? 'Get more storage' : ''; }
  if (!text) return '';
  return `<section class="block"><div class="card plan-notice"><span>${icon('bell', 18)}</span><p>${esc(text)}</p>${btn ? `<a class="btn sm" href="#/manage">${esc(btn)}</a>` : ''}</div></section>`;
}

// The family's motto, a saying (a different one each day) and the family goal, at the top of the Family tab.
// ───────── getting set up ─────────
// A short checklist for new members (and anyone who hasn't done these yet): each step ticks itself off once
// done, and the card goes away when all four are done, or when hidden.
function setupSteps(app) {
  const st = app.state, me = app.myMember();
  try { if (localStorage.getItem('oc-setup-hide-' + st.cid)) return null; } catch (e) {}
  if (!me) return null;
  const push = cachedPush();
  const steps = [
    { key: 'photo', act: 'data-act="photo"', label: 'Add your photo', done: !!me.photo },
    { key: 'bday', act: 'data-setup="bday"', label: 'Add your birthday', done: !!birthdayOf(app, me.id) },
    push === 'install' ? { key: 'home', act: 'href="welcome.html"', label: 'Put Our Circle on your Home Screen', done: false, link: true }
      : { key: 'push', act: 'data-setup="push"', label: 'Turn on notifications', done: push === 'on' || push === 'unsupported' || push === null },
    { key: 'hi', act: 'data-setup="hi"', label: 'Say hi in the family chat', done: !!st.chats.everyone?.sent?.[me.id] },
  ];
  return steps.every((x) => x.done) ? null : steps;
}
function setupCard(steps) {
  const done = steps.filter((x) => x.done).length;
  return `<section class="block"><div class="card setup-card">
    <div class="setup-head"><b>Get set up</b><small>${done} of ${steps.length} done</small><button class="linkish" data-setup="hide">Hide</button></div>
    ${steps.map((x) => {
      const inner = `<span class="setup-tick ${x.done ? 'on' : ''}" aria-hidden="true">${x.done ? icon('check', 14) : ''}</span><span class="li-main"><span class="li-title">${esc(x.label)}</span></span>${x.done ? '' : icon('next', 16)}`;
      return x.done ? `<div class="li setup-step done">${inner}</div>`
        : x.link ? `<a class="li setup-step" ${x.act}>${inner}</a>` : `<button class="li setup-step" ${x.act}>${inner}</button>`;
    }).join('')}
  </div></section>`;
}

const hasWords = (app) => { const c = app.state.circle || {}; return !!(c.motto || (c.sayings || []).some(Boolean) || c.goal?.title); };
function familyWords(app, t, shift) {
  const c = app.state.circle || {};
  const sayings = (c.sayings || []).filter(Boolean);
  const saying = sayings.length ? sayings[(dayOfYear(t) + shift) % sayings.length] : '';
  const g = c.goal?.title ? c.goal : null;
  const p = g && Number.isFinite(+g.progress) && g.progress !== '' && g.progress != null ? Math.max(0, Math.min(100, Math.round(+g.progress))) : null;
  if (!c.motto && !saying && !g) {
    return app.isAdmin() ? `<section class="block"><button class="card empty-card" data-act="edit-words">${icon('star', 18)} Add a family motto, favorite sayings and a family goal. They'll show here for everyone.</button></section>` : '';
  }
  return `<section class="block">
    ${app.isAdmin() ? `<div class="fw-bar"><button class="linkish fw-edit" data-act="edit-words" aria-label="Edit motto, sayings and goal">${icon('edit', 13)} Edit</button></div>` : ''}
    <div class="card family-words">
    ${c.motto ? `<p class="motto">${esc(c.motto)}</p>` : ''}
    ${saying ? `<button class="saying" data-act="next-saying" ${sayings.length > 1 ? 'aria-label="Family saying. Tap for another"' : 'tabindex="-1"'}><span class="eyebrow">Family saying</span><span class="saying-text">“${esc(saying)}”</span></button>` : ''}
    ${g ? `<div class="fgoal"><span class="eyebrow">Family goal${g.due ? ' · by ' + esc(shortDate(g.due)) + (g.due.slice(0, 4) !== t.slice(0, 4) ? ', ' + g.due.slice(0, 4) : '') : ''}</span>
      <span class="fgoal-title">${esc(g.title)}</span>
      ${p != null ? `<span class="progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></span><small class="muted">${p}% there</small>` : ''}</div>` : ''}
  </div></section>`;
}

async function editWords(app) {
  const c = app.state.circle || {};
  const r = await sheet({
    title: 'Motto, sayings & goal',
    intro: 'Shown at the top of the Family tab for everyone in this circle.',
    fields: [
      { name: 'motto', label: 'Family motto', value: c.motto || '', placeholder: 'Love one another' },
      { name: 'sayings', label: 'Family sayings (one per line, a different one shows each day)', type: 'textarea', rows: 4, value: (c.sayings || []).join('\n'), placeholder: "Bennetts don't quit\nFamilies are forever" },
      { name: 'goal', label: 'Family goal', value: c.goal?.title || '', placeholder: 'Read the Book of Mormon together' },
      { name: 'due', label: 'Goal date (optional)', type: 'date', value: c.goal?.due || '' },
      { name: 'progress', label: 'How far along, 0–100% (optional)', type: 'number', value: c.goal?.progress ?? '' },
    ],
  });
  if (!r) return;
  const progress = r.progress === '' ? null : Math.max(0, Math.min(100, Math.round(Number(r.progress) || 0)));
  try {
    await S.update(`circles/${app.state.cid}`, {
      motto: r.motto.slice(0, 200),
      sayings: r.sayings.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50).map((x) => x.slice(0, 300)),
      goal: r.goal ? { title: r.goal.slice(0, 200), due: r.due || null, progress } : null,
    });
    toast('Saved for the whole family.');
  } catch (e) { toast('Only circle owners can change these.'); }
}

function todayCard(app, ev) {
  const mine = (ev.memberIds || []).includes(app.state.me);
  const names_ = listJoin((ev.memberIds || []).filter((m) => m !== app.state.me).map((m) => app.member(m)?.name).filter(Boolean));
  const ic = typeOf(ev.type).icon;
  let line, btn, text;
  const who = names(names_ || '');
  if (ev.type === 'birthday') { line = mine ? 'Happy birthday to you!' : `It's ${who}'s birthday.`; btn = 'Wish happy birthday'; text = 'Happy birthday! '; }
  else if (ev.type === 'anniversary') { line = mine ? 'Happy anniversary!' : `It's ${who}'s anniversary.`; btn = 'Send congratulations'; text = 'Happy anniversary! '; }
  else if (ev.type === 'graduation') { line = mine ? 'Congratulations, graduate!' : `It's ${who}'s graduation day.`; btn = 'Send congratulations'; text = 'Congratulations! '; }
  else { line = esc(ev.title); btn = 'Send a message'; text = ''; }
  const by = app.member(ev.createdBy);
  return `<div class="card card-inverted today">
    <div class="today-row">${icon(ic, 22)}<div><span class="eyebrow">Today</span><div class="today-line">${line}</div>
    <div class="today-sub">${by ? `Added by ${esc(by.name)} · ` : ''}everyone in the family sees this today</div></div></div>
    ${mine && !names_ ? '' : `<div class="right"><button class="btn light sm" data-act="celebrate" data-id="${esc(ev.id)}" data-text="${esc(text)}">${esc(btn)}</button></div>`}
  </div>`;
}

// One household's box. mine: it's your own household (your photo button, no check-in nudge).
function householdCard(app, h, mine = false) {
  const me = app.state.me;
  const people = app.membersOf(h.id);
  const single = people.length === 1;
  const ci = checkin(app, h.id);
  const target = single ? people[0]?.id : h.id;
  const act = single ? 'msg-member' : 'msg-household';
  let tab = '';
  if (ci) {
    const label = ci.overdue
      ? (ci.last ? `Time to check in. Last messaged ${ci.days} days ago` : 'Time to check in. Not messaged yet')
      : `Checked in ${ci.days === 0 ? 'today' : ci.days + ' day' + (ci.days === 1 ? '' : 's') + ' ago'}`;
    tab = `<button class="ci-tab ${ci.overdue ? 'due' : 'ok'}" data-act="${act}" data-id="${esc(target)}" aria-label="${esc(label)}. Message ${esc(h.name)}" title="${esc(label)}">
      ${icon(ci.overdue ? 'bell' : 'check', 16)}
      <b>${ci.overdue ? (ci.last ? ci.days + 'd' : 'New') : ci.days === 0 ? 'Today' : ci.days + 'd'}</b>
      <small>${ci.overdue ? 'Due' : 'Good'}</small>
    </button>`;
  }
  return `<div class="hh-row ${mine ? 'is-mine' : ''}" style="${hhVars(h)}">
    <div class="card hh">
      <div class="hh-head">
        <span class="hh-title">${mine ? '<small class="hh-you">Your family</small>' : ''}<b>${names(h.name)}</b>${people.length > 1 ? `<small>${people.length} people</small>` : ''}</span>
        <button class="icon-btn sm msg-btn" data-act="${act}" data-id="${esc(target)}" aria-label="Message ${esc(h.name)}${single ? '' : ' together'}">${icon('chat', 17)}</button>
      </div>
      <div class="hh-tiles">${people.map((m) => m.id === me ? `
        <button class="tile" data-act="photo" data-id="${esc(m.id)}" aria-label="${m.photo ? 'Change my photo' : 'Add my photo'}">
          ${m.photo ? face(m, 'tile-img') : `<span class="tile-img add">${icon('camera', 20)}<small>Add photo</small></span>`}
          <span class="tile-name">${esc(m.name)}</span>
        </button>` : `
        <button class="tile" data-act="msg-member" data-id="${esc(m.id)}" aria-label="Message ${esc(m.name)} only">
          ${face(m, 'tile-img')}
          <span class="tile-name">${esc(m.name)}</span>
        </button>`).join('')}</div>
    </div>
    ${tab}
  </div>`;
}

// Check-in status for one household: when I last messaged any of them (outside the
// everyone chat), and whether that is past my check-in window. Null if nobody there has a login.
export function checkin(app, hid) {
  const st = app.state;
  const ids = app.membersOf(hid).filter((m) => m.uid).map((m) => m.id);
  if (!ids.length || hid === app.myMember()?.householdId) return null;
  if (!app.checkinDays() || app.checkinMuted(hid)) return null; // nudges off, or off for this household
  let last = 0;
  for (const c of Object.values(st.chats)) {
    if (c.kind === 'everyone') continue;
    if ((c.memberIds || []).some((id) => ids.includes(id))) last = Math.max(last, c.sent?.[st.me] || 0);
  }
  last = Math.max(last, app.checkedIn(hid)); // cleared by hand (a call or a visit counts too)
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  return { last, days, overdue: !last || days >= app.checkinDays() };
}

async function newGroup(app) {
  const st = app.state;
  const people = Object.values(st.members).filter((m) => m.id !== st.me).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const r = await sheet({
    title: 'New group',
    intro: 'For example, a siblings-only chat or a trip-planning group.',
    submit: 'Start group',
    fields: [
      { name: 'name', label: 'Group name', placeholder: 'Siblings', required: true },
      { name: 'ids', label: 'Who is in it?', type: 'checks', value: [], options: people.map((m) => ({ value: m.id, label: m.name })) },
    ],
  });
  if (!r || !r.ids.length) return;
  app.go('#/chat/' + (await app.chatFor(r.ids, { name: r.name, kind: 'group' })));
}

function showAlerts(app) {
  const st = app.state;
  const due = st.households.map((h) => ({ h, ci: checkin(app, h.id) })).filter((x) => x.ci?.overdue);
  const todays = happeningToday(app).filter((ev) => !app.seenToday(ev.id));
  // Each nudge has a checkbox: tick some (or Select all) and Clear selected clears them together.
  const box = (kind, id, label) => `<input type="checkbox" class="nudge-pick" data-kind="${kind}" value="${esc(id)}" aria-label="${esc(label)}">`;
  const rows = [
    ...todays.map((ev) => `<li><label class="nudge-row">${box('ev', ev.id, 'Select ' + headline(app, ev))}${icon(typeOf(ev.type).icon, 18)}<span>Today: ${esc(headline(app, ev))}</span></label></li>`),
    ...due.map(({ h, ci }) => `<li data-hh="${esc(h.id)}"><label class="nudge-row">${box('hh', h.id, 'Select check in with ' + h.name)}${icon('bell', 18)}<span>Check in with ${names(h.name)}${ci.last ? ` · last messaged ${ci.days} days ago` : ' · not messaged yet'}</span></label>
      <button type="button" class="linkish mute" data-mute="${esc(h.id)}" aria-label="Turn off check-in nudges for ${esc(h.name)}">Turn off</button></li>`),
  ];
  const p = sheet({
    title: 'Nudges',
    submit: rows.length ? 'Clear selected' : 'Close',
    cancel: rows.length ? 'Close' : '',
    body: rows.length ? `<div class="nudge-tools"><button type="button" class="btn sm ghost" data-all>${icon('check', 14)} Select all</button><span class="muted small" data-count>None selected</span></div>
      <ul class="alert-list">${rows.join('')}</ul><p class="hint">Clear one after a call or visit. Turn off stops reminders for that family.</p>`
      : '<p class="muted">You are all caught up. Nice work staying in touch.</p>',
    fields: [],
  });
  const wrap = [...document.querySelectorAll('.sheet-wrap')].at(-1);
  const picks = () => [...(wrap?.querySelectorAll('.nudge-pick') || [])];
  const submit = wrap?.querySelector('button[type=submit]');
  const sync = () => {
    const n = picks().filter((x) => x.checked).length, all = picks().length && n === picks().length;
    const c = wrap?.querySelector('[data-count]'); if (c) c.textContent = n ? `${n} selected` : 'None selected';
    const a = wrap?.querySelector('[data-all]'); if (a) a.innerHTML = `${icon('check', 14)} ${all ? 'Select none' : 'Select all'}`;
    if (submit && rows.length) { submit.disabled = !n; submit.textContent = n ? `Clear selected (${n})` : 'Clear selected'; }
  };
  sync();
  wrap?.addEventListener('change', (e) => { if (e.target.closest('.nudge-pick')) sync(); });
  wrap?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-all]')) { const on = !picks().every((x) => x.checked); picks().forEach((x) => { x.checked = on; }); sync(); return; }
    const b = e.target.closest('[data-mute]');
    if (!b) return;
    b.disabled = true;
    await app.setCheckinMuted(b.dataset.mute, true); toast('Check-in reminders turned off for that family.');
    b.closest('li').remove(); sync();
  });
  // Read the ticks before the sheet closes (the sheet removes itself as it answers).
  let chosen = null;
  submit?.addEventListener('click', () => { chosen = picks().filter((x) => x.checked).map((x) => [x.dataset.kind, x.value]); }, true);
  p.then(async (v) => {
    if (!v || !chosen?.length) return;
    await app.clearNudges({ households: chosen.filter(([k]) => k === 'hh').map(([, id]) => id), events: chosen.filter(([k]) => k === 'ev').map(([, id]) => id) });
    toast(chosen.length === 1 ? 'Nudge cleared.' : `${chosen.length} nudges cleared.`);
  });
}
