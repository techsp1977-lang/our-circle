// Family hub: coming up, today's big days, weekly check-ins, the family chart.
import * as S from './store.js';
import { esc, icon, face, toast, sheet, listJoin } from './ui.js';
import { today, monShort, dayNum, whenText, rangeText, diffDays, weekday, shortDate } from './dates.js';
import { upcoming, happeningToday, headline, editEvent, canEdit, isCalendarType, typeOf } from './events.js';


export function mount(root, app) {
  const st = app.state;
  let journalDone = false;

  const render = () => {
    const me = app.myMember();
    if (!me) { root.innerHTML = '<p class="pad muted">Loading…</p>'; return; }
    const t = today();

    // Coming up: trips and family events
    const coming = upcoming(app, { filter: isCalendarType, days: 730 }).slice(0, 4);
    // Today's big days
    const todays = happeningToday(app).filter((ev) => !isCalendarType(ev) || ev.date === t);
    // Weekly check-ins
    // Birthdays & big days list
    const big = upcoming(app, { filter: (ev) => !isCalendarType(ev), days: 366 }).slice(0, 6);

    const others = st.households.filter((h) => h.id !== me.householdId);
    const mine = app.household(me.householdId);

    root.innerHTML = `
      <header class="top">
        <div><div class="eyebrow">${esc(me.name)}'s circle</div><h1 class="display">${esc(st.circle?.name || 'Our family')}</h1></div>
        ${app.isAdmin() ? `<a class="icon-btn" href="#/manage" aria-label="Family settings">${icon('gear')}</a>` : ''}
      </header>

      <section class="block">
        <div class="row-head"><h2>Coming up</h2><button class="linkish" data-act="add-event">${icon('plus', 16)} Add event</button></div>
        ${coming.length ? `<div class="card list">${coming.map(({ ev, occ }) => `
          <div class="li">
            <span class="datechip trip"><b>${monShort(occ.start)}</b><span>${ev.endDate && ev.endDate !== ev.date ? rangeText(ev).replace(/^[A-Za-z]+ /, '') : dayNum(occ.start)}</span></span>
            <span class="li-main"><span class="li-title">${esc(ev.title)}</span><span class="li-sub">${esc(ev.note || (ev.memberIds?.length ? listJoin(ev.memberIds.map((id) => app.member(id)?.name).filter(Boolean)) : 'Everyone'))}${ev.endDate ? ` · ${diffDays(ev.date, ev.endDate) + 1} days` : ''}</span></span>
            <span class="li-when">${occ.start <= t ? 'Now' : esc(whenText(occ.start))}</span>
            ${canEdit(app, ev) ? `<button class="icon-btn sm" data-act="edit-event" data-id="${ev.id}" aria-label="Edit ${esc(ev.title)}">${icon('edit', 16)}</button>` : ''}
          </div>`).join('')}</div>`
        : `<button class="card empty-card" data-act="add-event">Add a trip, reunion or family event so everyone can see it.</button>`}
      </section>

      ${todays.length ? `<section class="block stack-sm">${todays.map((ev) => todayCard(app, ev)).join('')}</section>` : ''}

      <section class="block">
        <div class="row-btns">
          <button class="btn dark grow" data-act="everyone">${icon('users')} Message everyone</button>
          <button class="btn ghost" data-act="new-group">New group</button>
        </div>
      </section>

      <section class="block chart" aria-label="Family">
        <div class="chart-mine">
          <div class="mine-card">
            <a href="#/me" class="mine-head"><span class="eyebrow light">Your household</span><span class="mine-name">${esc(mine?.name || me.name)}</span></a>
            ${app.membersOf(me.householdId).map((m) => `
              <button class="tile mine-tile" data-act="${m.id === st.me ? 'me' : 'msg-member'}" data-id="${m.id}" aria-label="${m.id === st.me ? 'My page' : 'Message ' + esc(m.name) + ' only'}">
                ${m.photo || m.id !== st.me ? face(m, 'tile-img') : `<span class="tile-img add">${icon('camera', 20)}<small>Add photo</small></span>`}
                <span class="tile-name">${esc(m.name)}</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="chart-others">
          ${others.map((h) => householdCard(app, h)).join('') || `<div class="card empty-card">${app.isAdmin() ? '<a href="#/manage">Add your family members</a> to see everyone here.' : 'No one else yet.'}</div>`}
        </div>
      </section>
      <p class="hint center">Message goes to the whole household. Tap a photo to message one person.</p>

      <section class="block">
        <div class="row-head"><h2>Birthdays &amp; big days</h2><a class="linkish" href="#/me">My dates</a></div>
        ${big.length ? `<div class="card list">${big.map(({ ev, occ }) => `
          <button class="li" data-act="${canEdit(app, ev) ? 'edit-event' : 'noop'}" data-id="${ev.id}">
            <span class="datechip ${occ.start === t ? 'gold' : ''}"><b>${monShort(occ.start)}</b><span>${dayNum(occ.start)}</span></span>
            <span class="li-main"><span class="li-title">${esc(headline(app, ev, occ.start))}</span><span class="li-sub">${esc(typeOf(ev.type).label)}${ev.createdBy && app.member(ev.createdBy) ? ' · added by ' + esc(app.member(ev.createdBy).name) : ''}</span></span>
            <span class="li-when ${occ.start === t ? 'warm' : ''}">${esc(whenText(occ.start))}</span>
          </button>`).join('')}</div>`
        : `<div class="card empty-card">Add birthdays and anniversaries on <a href="#/me">My page</a>.</div>`}
      </section>

      <section class="block">
        <a class="card link-card" href="#/journal">
          <span class="sq">${icon('book', 22)}</span>
          <span class="li-main"><span class="li-title">Today's journal page</span><span class="li-sub">${weekday(t)}, ${shortDate(t)} · ${journalDone ? 'written' : 'not written yet'}</span></span>
          ${icon('next', 18)}
        </a>
      </section>`;
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'add-event': editEvent(app, null, { type: 'trip' }); break;
      case 'edit-event': { const ev = st.events.find((x) => x.id === id); if (ev) editEvent(app, ev); break; }
      case 'everyone': app.go('#/chat/everyone'); break;
      case 'me': app.go('#/me'); break;
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

function todayCard(app, ev) {
  const mine = (ev.memberIds || []).includes(app.state.me);
  const names = listJoin((ev.memberIds || []).filter((m) => m !== app.state.me).map((m) => app.member(m)?.name).filter(Boolean));
  const ic = typeOf(ev.type).icon;
  let line, btn, text;
  if (ev.type === 'birthday') { line = mine ? 'Happy birthday to you!' : `It's ${names}'s birthday.`; btn = 'Wish happy birthday'; text = 'Happy birthday! '; }
  else if (ev.type === 'anniversary') { line = mine ? 'Happy anniversary!' : `It's ${names}'s anniversary.`; btn = 'Send congratulations'; text = 'Happy anniversary! '; }
  else if (ev.type === 'graduation') { line = mine ? 'Congratulations, graduate!' : `It's ${names}'s graduation day.`; btn = 'Send congratulations'; text = 'Congratulations! '; }
  else { line = esc(ev.title); btn = 'Send a message'; text = ''; }
  const by = app.member(ev.createdBy);
  return `<div class="card today">
    <div class="today-row">${icon(ic, 22)}<div><span class="eyebrow gold">Today</span><div class="today-line">${esc(line)}</div>
    <div class="today-sub">${by ? `Added by ${esc(by.name)} · ` : ''}everyone in the family sees this today</div></div></div>
    ${mine && !names ? '' : `<div class="right"><button class="btn gold sm" data-act="celebrate" data-id="${ev.id}" data-text="${esc(text)}">${esc(btn)}</button></div>`}
  </div>`;
}

function householdCard(app, h) {
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
    tab = `<button class="ci-tab ${ci.overdue ? 'due' : 'ok'}" data-act="${act}" data-id="${target}" aria-label="${esc(label)}. Message ${esc(h.name)}" title="${esc(label)}">
      ${icon(ci.overdue ? 'bell' : 'check', 16)}
      <b>${ci.overdue ? (ci.last ? ci.days + 'd' : 'New') : ci.days === 0 ? 'Today' : ci.days + 'd'}</b>
      <small>${ci.overdue ? 'Due' : 'Good'}</small>
    </button>`;
  }
  return `<div class="hh-row">
    <div class="card hh">
      <div class="hh-head">
        <span class="hh-title"><b>${esc(h.name)}</b>${people.length > 1 ? `<small>${people.length} people</small>` : ''}</span>
        <button class="icon-btn sm msg-btn" data-act="${act}" data-id="${target}" aria-label="Message ${esc(h.name)}${single ? '' : ' together'}">${icon('chat', 17)}</button>
      </div>
      <div class="hh-tiles">${people.map((m) => `
        <button class="tile" data-act="msg-member" data-id="${m.id}" aria-label="Message ${esc(m.name)} only">
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
