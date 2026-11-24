// Family hub: coming up, today's big days, weekly check-ins, the family chart.
import * as S from './store.js';
import { planState, fmtGB, pausedText } from './plans.js';
import { mapHTML, drawMap, openHousehold } from './familymap.js';
import { esc, icon, face, toast, sheet, listJoin, names, hhColor, why, familyTree } from './ui.js';
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
    const coming = upcoming(app, { filter: isCalendarType, days: 730 }).slice(0, 4);
    // Today's big days
    const todays = happeningToday(app).filter((ev) => !isCalendarType(ev) || ev.date === t);
    // Households past their check-in window
    const due = st.households.filter((h) => checkin(app, h.id)?.overdue);
    const alerts = due.length + todays.length;
    // Birthdays & big days: this month and next month only
    const big = byMonth(app, { filter: (ev) => !isCalendarType(ev), months: 2 });


    root.innerHTML = `
      <header class="top">
        <div><div class="eyebrow">${esc(me.name)}'s circle</div>
          <h1 class="display"><button class="circle-switch" data-act="switch" aria-label="${esc(st.circle?.name || 'Our family')}. Switch circles">${esc(st.circle?.name || 'Our family')}<span class="chev" aria-hidden="true">${icon('next', 18)}</span></button></h1></div>
        <div class="top-btns">
          <button class="icon-btn bell" data-act="alerts" aria-label="${alerts ? alerts + ' nudge' + (alerts === 1 ? '' : 's') : 'No nudges right now'}">${icon('bell')}${alerts ? `<span class="badge">${alerts}</span>` : ''}</button>
          ${app.isAdmin() || app.runsAny() ? `<a class="icon-btn" href="#/manage" aria-label="${app.isAdmin() ? 'Family' : 'Household'} settings">${icon('gear')}</a>` : ''}
        </div>
      </header>
      ${planNotice(app)}
      ${familyWords(app, t, sayingShift)}
      ${due.length ? `<section class="block"><div class="card checkin-strip">
        <div class="cs-head">${icon('bell', 18)}<b>Check in this week</b><small>${due.length} household${due.length === 1 ? '' : 's'}</small></div>
        <div class="cs-chips">${due.map((h) => { const ppl = app.membersOf(h.id); const single = ppl.length === 1;
          return `<button class="cs-chip" style="--hh:${hhColor(h)}" data-act="${single ? 'msg-member' : 'msg-household'}" data-id="${esc(single ? ppl[0].id : h.id)}">${names(h.name)}</button>`; }).join('')}</div>
      </div></section>` : ''}

      <section class="block">
        <div class="row-head"><h2>Coming up</h2><button class="linkish" data-act="add-event">${icon('plus', 16)} Add event</button></div>
        ${coming.length ? `<div class="card list">${coming.map(({ ev, occ }) => `
          <div class="li">
            <span class="datechip trip"><b>${monShort(occ.start)}</b><span>${ev.endDate && ev.endDate !== ev.date ? rangeText(ev).replace(/^[A-Za-z]+ /, '') : dayNum(occ.start)}</span></span>
            <span class="li-main"><span class="li-title">${esc(ev.title)}</span><span class="li-sub">${esc(ev.note || (ev.memberIds?.length ? listJoin(ev.memberIds.map((id) => app.member(id)?.name).filter(Boolean)) : 'Everyone'))}${ev.endDate ? ` · ${diffDays(ev.date, ev.endDate) + 1} days` : ''}</span></span>
            <span class="li-when">${occ.start <= t ? 'Now' : esc(whenText(occ.start))}</span>
            ${canEdit(app, ev) ? `<button class="icon-btn sm" data-act="edit-event" data-id="${esc(ev.id)}" aria-label="Edit ${esc(ev.title)}">${icon('edit', 16)}</button>` : ''}
          </div>`).join('')}</div>`
        : `<button class="card empty-card" data-act="add-event">Add a trip, reunion or family event so everyone can see it.</button>`}
      </section>

      ${todays.length ? `<section class="block stack-sm">${todays.map((ev) => todayCard(app, ev)).join('')}</section>` : ''}

      <section class="block">
        <div class="row-btns compact">
          <button class="btn sm" data-act="everyone">${icon('users', 17)} Message everyone</button>
          <button class="btn sm ghost" data-act="new-group">${icon('plus', 16)} New group</button>
        </div>
      </section>

      ${(() => { const m = new Date().getMonth(), y = new Date().getFullYear() - (m === 0 ? 1 : 0);
        return m === 11 || m === 0 ? `<section class="block"><button class="card yr-card" data-act="year">
          <span class="yr-card-ic" aria-hidden="true">🎬</span><span class="li-main"><span class="li-title">Watch our ${y}</span>
          <span class="li-sub">A 1, 3 or 5 minute video of the family's year, for the TV at your next gathering</span></span>${icon('next', 18)}</button></section>` : ''; })()}
      <section class="block">
        <div class="seg" role="radiogroup" aria-label="How to show the family" data-on="${famView}">
          <button type="button" role="radio" aria-checked="${famView === 'circles'}" data-act="famview" data-id="circles">${icon('family', 15)} Circles</button>
          <button type="button" role="radio" aria-checked="${famView === 'list'}" data-act="famview" data-id="list">${icon('users', 15)} Cards</button>
        </div>
      </section>
      ${famView === 'circles' ? `<section class="block fam-wrap" aria-label="Family circles">${mapHTML()}</section>` : `<section class="block tree" aria-label="Family tree">
        ${familyTree(st.households).map(({ h, depth }) => `<div class="tree-row" style="--depth:${Math.min(depth, 3)}">${householdCard(app, h, h.id === me.householdId)}</div>`).join('')
          || `<div class="card empty-card">${app.isAdmin() ? '<a href="#/manage">Add your family members</a> to see everyone here.' : 'No one else yet.'}</div>`}
      </section>`}
      ${famView === 'list' ? '<p class="hint center">Message goes to the whole household. Tap a photo to message one person.</p>' : ''}

      <section class="block">
        <div class="row-head"><h2>Birthdays &amp; big days</h2><a class="linkish" href="#/me">My dates</a></div>
        ${big.map(({ ym, items }) => `
          <div class="month-head">${esc(monthName(ym))}</div>
          ${items.length ? `<div class="card list">${items.map(({ ev, occ }) => {
            const past = occ.start < t, now = occ.start === t;
            return `
          <button class="li ${past ? 'past' : ''}" data-act="${canEdit(app, ev) ? 'edit-event' : 'noop'}" data-id="${esc(ev.id)}">
            <span class="datechip ${now ? 'gold' : ''}"><b>${monShort(occ.start)}</b><span>${dayNum(occ.start)}</span></span>
            <span class="li-main"><span class="li-title">${esc(headline(app, ev, occ.start))}</span><span class="li-sub">${esc(typeOf(ev.type).label)}${ev.createdBy && app.member(ev.createdBy) ? ' · added by ' + esc(app.member(ev.createdBy).name) : ''}</span></span>
            <span class="li-when ${now ? 'warm' : ''}">${esc(past ? agoText(occ.start) : whenText(occ.start))}</span>
          </button>`; }).join('')}</div>`
          : `<div class="card empty-card muted">No birthdays or big days in ${esc(monthName(ym))}.</div>`}`).join('')}
        ${st.events.some((ev) => !isCalendarType(ev)) ? '' : `<p class="hint">Add birthdays and anniversaries on <a href="#/me">My page</a>.</p>`}
      </section>

      <section class="block">
        <a class="card link-card" href="#/journal">
          <span class="sq">${icon('book', 22)}</span>
          <span class="li-main"><span class="li-title">Today's journal page</span><span class="li-sub">${weekday(t)}, ${shortDate(t)} · ${journalDone ? 'written' : 'not written yet'}</span></span>
          ${icon('next', 18)}
        </a>
      </section>`;
    if (famView === 'circles') drawMap(app, root);
  };

  const onClick = async (e) => {
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
      case 'hh-open': openHousehold(app, id, onClick); break;
      case 'year': import('./yearvideo.js').then((m) => m.openYearVideo(app)); break;
      case 'famview': {
        if (famView === id) break;
        famView = id; try { localStorage.setItem('oc-famview', id); } catch (er) {}
        b.closest('.seg')?.setAttribute('data-on', id);
        setTimeout(render, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
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
  } catch (e) { toast('Only family organizers can change these.'); }
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
  return `<div class="hh-row ${mine ? 'is-mine' : ''}" style="--hh:${hhColor(h)}">
    <div class="card hh">
      <div class="hh-head">
        <span class="hh-title">${mine ? '<small class="hh-you">Your household</small>' : ''}<b>${names(h.name)}</b>${people.length > 1 ? `<small>${people.length} people</small>` : ''}</span>
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
  const todays = happeningToday(app);
  const rows = [
    ...todays.map((ev) => `<li>${icon(typeOf(ev.type).icon, 18)}<span>Today: ${esc(headline(app, ev))}</span></li>`),
    ...due.map(({ h, ci }) => `<li data-hh="${esc(h.id)}">${icon('bell', 18)}<span>Check in with ${names(h.name)}${ci.last ? ` · last messaged ${ci.days} days ago` : ' · not messaged yet'}</span>
      <button type="button" class="linkish mute" data-mute="${esc(h.id)}" aria-label="Turn off check-in nudges for ${esc(h.name)}">Turn off</button></li>`),
  ];
  sheet({
    title: 'Nudges',
    submit: 'Done',
    body: rows.length ? `<ul class="alert-list">${rows.join('')}</ul>${due.length ? '<p class="hint">Turn off stops check-in nudges for that household. Change them all on My page → My nudges.</p>' : ''}`
      : '<p class="muted">You are all caught up. Nice work staying in touch.</p>',
    fields: [],
  });
  // The sheet is on screen now: wire up its Turn off buttons.
  [...document.querySelectorAll('.sheet-wrap')].at(-1)?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mute]');
    if (!b) return;
    b.disabled = true;
    await app.setCheckinMuted(b.dataset.mute, true);
    b.closest('li').remove();
    toast('Check-in nudges turned off for that household.');
  });
}
