// Calendar tab: the whole year as one scrolling list. This month first, then the next eleven, with every
// birthday, anniversary, big day and trip under its month. Tap one to open it.
import { esc, icon } from './ui.js';
import { today, shortDate, diffDays, monthName, agoText, whenText } from './dates.js';
import { headline, typeOf, isCalendarType, canEdit, editEvent, byMonth, copyFromCircle } from './events.js';
import { listCircles } from './circles.js';

function itemHTML(app, ev, day, t) {
  const trip = ev.endDate && ev.endDate > ev.date && !ev.recurring;
  const who = ev.memberIds?.length ? '' : 'Everyone';
  const sub = [typeOf(ev.type).label, trip ? `${shortDate(ev.date)} – ${shortDate(ev.endDate)} · ${diffDays(ev.date, ev.endDate) + 1} days` : '', ev.note || (isCalendarType(ev) ? who : '')].filter(Boolean).join(' · ');
  const past = day < t && !(trip && ev.endDate >= t);
  const when = day === t || (trip && day <= t && ev.endDate >= t) ? 'Today' : past ? agoText(day, t) : whenText(day, t);
  return `<button class="li ${past ? 'past' : ''}" data-ev="${esc(ev.id)}" ${canEdit(app, ev) ? '' : 'data-readonly'}>
    <span class="datechip ${when === 'Today' ? 'gold' : ''}"><b>${esc(shortDate(day).split(' ')[0])}</b><span>${+day.slice(8)}</span></span>
    <span class="li-main"><span class="li-title">${esc(headline(app, ev, day))}</span><span class="li-sub">${esc(sub)}</span></span>
    <span class="li-when ${when === 'Today' ? 'warm' : ''}">${esc(when)}</span>
  </button>`;
}

export function mount(root, app) {
  let others = []; // your other circles, for "Copy dates from another circle"
  const render = () => {
    const t = today(), st = app.state;
    const months = byMonth(app, { months: 12, from: `${t.slice(0, 7)}-01` });
    const any = months.some((m) => m.items.length);
    root.innerHTML = `
      <header class="top"><div><div class="eyebrow">${esc(st.circle?.name || '')}</div><h1 class="display">Calendar</h1></div>
        <button class="btn sm" data-add>${icon('plus', 16)} Add</button></header>
      <p class="hint pad-x">The next 12 months.</p>
      ${others.length ? `<p class="pad-x"><button class="linkish" data-copy style="text-align:left">${icon('plus', 16)} Copy dates from ${others.length === 1 ? esc(others[0].name) : 'another circle'}</button></p>` : ''}
      ${any ? months.filter(({ items }) => items.length).map(({ ym, items }) => `
        <section class="block year-month">
          <h2 class="month-head">${esc(monthName(ym))}${ym.slice(0, 4) !== t.slice(0, 4) ? ' ' + ym.slice(0, 4) : ''}</h2>
          <div class="card list">${items.map(({ ev, occ }) => itemHTML(app, ev, occ.start, t)).join('')}</div>
        </section>`).join('')
      : '<section class="block"><button class="card empty-card" data-add>Nothing on the calendar yet. Add a trip or family event, and add birthdays and anniversaries on My page.</button></section>'}`;
  };
  const onClick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-add')) return editEvent(app, null, { type: 'trip' });
    if (b.hasAttribute('data-copy')) return copyFromCircle(app, others);
    if (b.dataset.ev && !b.hasAttribute('data-readonly')) {
      const ev = app.state.events.find((x) => x.id === b.dataset.ev);
      if (ev) editEvent(app, ev);
    }
  };
  root.addEventListener('click', onClick);
  const off = app.on(render);
  render();
  listCircles(app).then((rows) => { others = rows.filter((c) => !c.current); if (others.length) render(); }).catch(() => {});
  return { destroy: () => { off(); root.removeEventListener('click', onClick); } };
}
