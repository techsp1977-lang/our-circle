// Family calendar: birthdays, anniversaries, big days and trips, as a month grid (#/calendar, #/calendar/2026-11-23)
// or the whole year as a list (#/calendar/year). The Family tab shows the current month small at the bottom.
import { esc, icon } from './ui.js';
import { today, parse, toISO, addDays, monthName, occurrenceInMonth, longDate, weekday, shortDate, diffDays, pad } from './dates.js';
import { headline, typeOf, isCalendarType, canEdit, editEvent, byMonth } from './events.js';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ymOf = (d) => d.slice(0, 7);
const shiftMonth = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const lastDay = (ym) => toISO(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0));

// "YYYY-MM-DD" → events on that day, for one month. Trips and multi-day events cover each of their days.
export function monthMap(app, ym) {
  const map = {};
  const put = (d, ev) => (map[d] ||= []).push(ev);
  const first = `${ym}-01`, last = lastDay(ym);
  for (const ev of app.state.events) {
    if (!ev.date) continue;
    if (ev.recurring) { const d = occurrenceInMonth(ev, ym); if (d) put(d, ev); continue; }
    const end = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
    if (end < first || ev.date > last) continue;
    for (let d = ev.date < first ? first : ev.date, n = 0; d <= end && d <= last && n < 62; d = addDays(d, 1), n++) put(d, ev);
  }
  return map;
}

// A month grid. compact: the small one on the Family tab.
export function gridHTML(app, ym, { selected = null, compact = false } = {}) {
  const map = monthMap(app, ym), t = today();
  const lead = parse(`${ym}-01`).getDay(), days = +lastDay(ym).slice(8);
  const cells = Array.from({ length: lead }, () => '<span class="cal-pad"></span>');
  for (let n = 1; n <= days; n++) {
    const d = `${ym}-${pad(n)}`, evs = map[d] || [];
    const dots = evs.slice(0, 3).map((ev) => `<i class="${isCalendarType(ev) ? 'cal' : 'big'}"></i>`).join('');
    const label = `${weekday(d)}, ${longDate(d)}${evs.length ? ': ' + evs.map((ev) => headline(app, ev, d)).join(', ') : ''}`;
    cells.push(`<button class="cal-day${d === t ? ' today' : ''}${d === selected ? ' sel' : ''}${evs.length ? ' has' : ''}" data-day="${d}" aria-label="${esc(label)}"${d === selected ? ' aria-pressed="true"' : ''}>
      <span class="n">${n}</span>${compact ? '' : `<span class="dots">${dots}</span>`}${compact && evs.length ? `<span class="dots">${dots}</span>` : ''}</button>`);
  }
  return `<div class="cal-grid${compact ? ' compact' : ''}" role="group" aria-label="${esc(monthName(ym))} ${ym.slice(0, 4)}">
    ${WEEK.map((w) => `<span class="cal-wd" aria-hidden="true">${w}</span>`).join('')}${cells.join('')}</div>`;
}

function itemHTML(app, ev, day) {
  const range = ev.endDate && ev.endDate > ev.date && !ev.recurring ? `${shortDate(ev.date)} – ${shortDate(ev.endDate)} · ${diffDays(ev.date, ev.endDate) + 1} days` : '';
  const who = ev.memberIds?.length ? '' : 'Everyone';
  const sub = [typeOf(ev.type).label, range, ev.note || who].filter(Boolean).join(' · ');
  return `<button class="li" data-ev="${esc(ev.id)}" ${canEdit(app, ev) ? '' : 'data-readonly'}>
    <span class="sq soft ${isCalendarType(ev) ? 'cal' : 'big'}">${icon(typeOf(ev.type).icon, 20)}</span>
    <span class="li-main"><span class="li-title">${esc(headline(app, ev, day))}</span><span class="li-sub">${esc(sub)}</span></span>
    ${canEdit(app, ev) ? icon('edit', 16) : ''}
  </button>`;
}

export function mount(root, app, key, args) {
  const t = today();
  const arg = args[0] || '';
  let mode = arg === 'year' ? 'year' : 'month';
  let selected = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : null;
  let ym = selected ? ymOf(selected) : /^\d{4}-\d{2}$/.test(arg) ? arg : ymOf(t);

  const render = () => {
    const st = app.state;
    let body;
    if (mode === 'month') {
      const map = monthMap(app, ym);
      const seen = new Set();
      const monthItems = Object.keys(map).sort().flatMap((d) => map[d].filter((ev) => !seen.has(ev.id) && seen.add(ev.id)).map((ev) => ({ ev, d })));
      const dayItems = selected ? (map[selected] || []).map((ev) => ({ ev, d: selected })) : null;
      const items = dayItems || monthItems;
      body = `
        <section class="block">
          <div class="cal-nav">
            <button class="icon-btn" data-nav="-1" aria-label="Previous month">${icon('back')}</button>
            <h2>${esc(monthName(ym))} ${ym.slice(0, 4)}</h2>
            <button class="icon-btn" data-nav="1" aria-label="Next month">${icon('next')}</button>
          </div>
          <div class="card cal-big" id="grid">${gridHTML(app, ym, { selected })}</div>
          <div class="cal-legend"><span><i class="big"></i> Birthdays &amp; big days</span><span><i class="cal"></i> Trips &amp; events</span>${ymOf(t) !== ym || selected ? '<button class="linkish" data-today>Today</button>' : ''}</div>
        </section>
        <section class="block">
          <div class="row-head"><h2>${selected ? esc(`${weekday(selected)}, ${longDate(selected)}`) : `All of ${esc(monthName(ym))}`}</h2>
            ${selected ? '<button class="linkish" data-clear>Whole month</button>' : ''}</div>
          ${items.length ? `<div class="card list">${items.map(({ ev, d }) => itemHTML(app, ev, d)).join('')}</div>`
            : `<div class="card empty-card muted">${selected ? 'Nothing on this day yet.' : `Nothing in ${esc(monthName(ym))} yet.`}</div>`}
          <button class="btn ghost wide" data-add>${icon('plus', 16)} Add ${selected ? `something on ${esc(shortDate(selected))}` : 'a date'}</button>
        </section>`;
    } else {
      const months = byMonth(app, { months: 12, from: `${ymOf(t)}-01` });
      body = months.map(({ ym: m, items }) => `
        <section class="block">
          <button class="month-head as-link" data-month="${m}">${esc(monthName(m))} ${m.slice(0, 4)} ${icon('next', 14)}</button>
          ${items.length ? `<div class="card list">${items.map(({ ev, occ }) => `
            <button class="li ${occ.start < t ? 'past' : ''}" data-ev="${esc(ev.id)}" ${canEdit(app, ev) ? '' : 'data-readonly'}>
              <span class="datechip ${occ.start === t ? 'gold' : ''}"><b>${esc(shortDate(occ.start).split(' ')[0])}</b><span>${+occ.start.slice(8)}</span></span>
              <span class="li-main"><span class="li-title">${esc(headline(app, ev, occ.start))}</span><span class="li-sub">${esc(typeOf(ev.type).label)}</span></span>
            </button>`).join('')}</div>` : '<p class="hint pad-x">Nothing yet.</p>'}
        </section>`).join('');
    }
    root.innerHTML = `
      <header class="top"><a class="icon-btn" href="#/family" aria-label="Back to family">${icon('back')}</a>
        <div class="grow"><h1 class="h1">Calendar</h1><div class="muted small">${esc(st.circle?.name || '')}</div></div>
        <div class="seg" role="tablist" aria-label="Calendar view">
          <button role="tab" data-mode="month" aria-selected="${mode === 'month'}" class="${mode === 'month' ? 'on' : ''}">Month</button>
          <button role="tab" data-mode="year" aria-selected="${mode === 'year'}" class="${mode === 'year' ? 'on' : ''}">Year</button>
        </div></header>
      ${body}`;
  };

  const go = (n) => { ym = shiftMonth(ym, n); selected = null; render(); };
  const onClick = async (e) => {
    const b = e.target.closest('button,a');
    if (!b) return;
    if (b.dataset.nav) return go(+b.dataset.nav);
    if (b.dataset.day) { selected = selected === b.dataset.day ? null : b.dataset.day; return render(); }
    if (b.hasAttribute('data-today')) { ym = ymOf(t); selected = t; return render(); }
    if (b.hasAttribute('data-clear')) { selected = null; return render(); }
    if (b.dataset.mode) { mode = b.dataset.mode; return render(); }
    if (b.dataset.month) { mode = 'month'; ym = b.dataset.month; selected = null; return render(); }
    if (b.hasAttribute('data-add')) return editEvent(app, null, { type: 'event', date: selected || (ymOf(t) === ym ? t : `${ym}-01`) });
    if (b.dataset.ev && !b.hasAttribute('data-readonly')) {
      const ev = app.state.events.find((x) => x.id === b.dataset.ev);
      if (ev) editEvent(app, ev);
    }
  };
  // Swipe the month grid left or right to change months.
  let x0 = null;
  const onTouchStart = (e) => { x0 = e.target.closest('#grid') ? e.touches[0].clientX : null; };
  const onTouchEnd = (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); };
  root.addEventListener('click', onClick);
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchend', onTouchEnd);
  const off = app.on(render);
  render();
  return { destroy: () => { off(); root.removeEventListener('click', onClick); root.removeEventListener('touchstart', onTouchStart); root.removeEventListener('touchend', onTouchEnd); } };
}

