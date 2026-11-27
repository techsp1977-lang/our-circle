// Shared dates & events: birthdays, anniversaries, graduations, trips, anything.
import * as S from './store.js';
import { sheet, toast, listJoin, why } from './ui.js';
import { nextOccurrence, today, yearsSince, occurrenceInMonth, monthsFrom, shortDate } from './dates.js';

export const TYPES = [
  { value: 'birthday', label: 'Birthday', icon: 'gift', yearly: true },
  { value: 'anniversary', label: 'Anniversary', icon: 'heart', yearly: true },
  { value: 'graduation', label: 'Graduation', icon: 'cap', yearly: false },
  { value: 'mission', label: 'Mission', icon: 'star', yearly: false },
  { value: 'baptism', label: 'Baptism', icon: 'star', yearly: false },
  { value: 'wedding', label: 'Wedding', icon: 'heart', yearly: false },
  { value: 'trip', label: 'Trip', icon: 'plane', yearly: false },
  { value: 'event', label: 'Family event', icon: 'cal', yearly: false },
  { value: 'other', label: 'Something else', icon: 'star', yearly: false },
];
export const typeOf = (v) => TYPES.find((t) => t.value === v) || TYPES[TYPES.length - 1];
export const isCalendarType = (ev) => ['trip', 'event'].includes(ev.type) || (!!ev.endDate && ev.endDate !== ev.date);

export function canEdit(app, ev) {
  return app.isAdmin() || ev.createdBy === app.state.me || (ev.memberIds || []).includes(app.state.me);
}

// Upcoming occurrences, soonest first.
export function upcoming(app, { filter = () => true, days = 400 } = {}) {
  const t = today();
  return app.state.events
    .filter(filter)
    .map((ev) => ({ ev, occ: nextOccurrence(ev, t) }))
    .filter((x) => x.occ && (new Date(x.occ.start) - new Date(t)) / 864e5 <= days)
    .sort((a, b) => (a.occ.start < b.occ.start ? -1 : a.occ.start > b.occ.start ? 1 : 0));
}

// Everything in this month and the next (or `months` months), grouped by month, earliest first.
// Days earlier this month are included so a missed birthday can still get a wish.
export function byMonth(app, { filter = () => true, months = 2, from = today() } = {}) {
  return monthsFrom(from, months).map((ym) => ({
    ym,
    items: app.state.events.filter(filter)
      .map((ev) => ({ ev, occ: { start: occurrenceInMonth(ev, ym) } }))
      .filter((x) => x.occ.start)
      .sort((a, b) => (a.occ.start < b.occ.start ? -1 : a.occ.start > b.occ.start ? 1 : 0)),
  }));
}

// Events happening today (start <= today <= end).
export function happeningToday(app) {
  const t = today();
  return app.state.events.filter((ev) => {
    const o = nextOccurrence(ev, t);
    return o && o.start <= t && o.end >= t;
  });
}

export function headline(app, ev, onDate = today()) {
  const names = (ev.memberIds || []).map((id) => app.member(id)?.name).filter(Boolean);
  const who = listJoin(names);
  const n = yearsSince(ev, onDate);
  if (ev.type === 'birthday') return `${who ? who + "'s" : 'A'} birthday${n ? ` · turns ${n}` : ''}`;
  if (ev.type === 'anniversary') return `${who ? who + "'s" : ''} anniversary${n ? ` · ${n} years` : ''}`.trim();
  return ev.title || typeOf(ev.type).label;
}

export async function editEvent(app, ev = null, defaults = {}) {
  const st = app.state;
  const people = Object.values(st.members).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const cur = ev || { type: 'event', recurring: false, memberIds: [], ...defaults };
  const p = sheet({
    title: ev ? 'Edit date' : 'Add a date',
    intro: 'The whole family sees it.',
    danger: ev && canEdit(app, ev) ? 'Delete' : null,
    fields: [
      { name: 'type', label: 'What is it?', type: 'select', value: cur.type, options: TYPES.map((t) => ({ value: t.value, label: t.label })) },
      { name: 'title', label: 'Title', value: cur.title || '', placeholder: 'Family trip · Cancún', hint: 'Optional for birthdays and anniversaries.' },
      { name: 'ymd', label: 'Date', type: 'mdy', value: cur.date || '', hint: 'The year is optional.' },
      { name: 'date', label: 'Date (or first day)', type: 'date', value: cur.date || '', required: true },
      { name: 'endDate', label: 'Last day (for trips and multi-day events)', type: 'date', value: cur.endDate || '' },
      { name: 'recurring', label: 'Repeats every year', type: 'checkbox', value: cur.recurring ?? typeOf(cur.type).yearly },
      { name: 'memberIds', label: 'Who is it for? (leave empty for everyone)', type: 'checks', value: cur.memberIds || [], options: people.map((m) => ({ value: m.id, label: m.name })) },
      { name: 'note', label: 'Note', type: 'textarea', rows: 2, value: cur.note || '' },
    ],
  });
  // Birthdays and anniversaries get Month / Day / Year pickers, always repeat, and need no last day.
  const form = [...document.querySelectorAll('.sheet-wrap')].at(-1)?.querySelector('form');
  if (form) {
    const box = (n) => form.querySelector(`[name="${n}"], [name="${n}__m"]`)?.closest('.field, .check');
    const yearlyType = () => ['birthday', 'anniversary'].includes(form.elements.type.value);
    const sync = () => {
      const y = yearlyType();
      box('ymd').hidden = !y; box('date').hidden = y; box('endDate').hidden = y; box('recurring').hidden = y;
      form.elements.date.required = !y;
      form.querySelectorAll('[name="ymd__m"], [name="ymd__d"]').forEach((x) => { x.required = y; });
    };
    form.elements.type.addEventListener('change', () => {
      form.elements.recurring.checked = typeOf(form.elements.type.value).yearly;
      // Carry the date across when switching between the two kinds of picker.
      if (yearlyType() && form.elements.date.value && !form.elements.ymd__m.value) {
        const [y, m, d] = form.elements.date.value.split('-');
        form.elements.ymd__m.value = String(Number(m)); form.elements.ymd__d.value = String(Number(d)); form.elements.ymd__y.value = y;
      }
      sync();
    });
    // Typing "birthday" or "anniversary" in the title picks that kind.
    form.elements.title.addEventListener('change', () => {
      const t = form.elements.title.value, cur = form.elements.type.value;
      if (['event', 'other'].includes(cur) && /\b(birthday|bday|b-day)\b/i.test(t)) { form.elements.type.value = 'birthday'; form.elements.type.dispatchEvent(new Event('change')); }
      else if (['event', 'other'].includes(cur) && /\banniversary\b/i.test(t)) { form.elements.type.value = 'anniversary'; form.elements.type.dispatchEvent(new Event('change')); }
    });
    sync();
  }
  const r = await p;
  if (!r) return null;
  if (r.__danger) {
    await S.del(app.path('events/' + ev.id));
    toast('Date removed.');
    return null;
  }
  const yearly = ['birthday', 'anniversary'].includes(r.type);
  const date = yearly ? r.ymd : r.date;
  if (!date) { toast('Pick the month and day.'); return null; }
  const data = {
    type: r.type, title: r.title, date,
    endDate: !yearly && r.endDate && r.endDate > date ? r.endDate : null,
    recurring: yearly || !!r.recurring, memberIds: r.memberIds, note: r.note, shared: true,
  };
  if (!data.title) {
    const names = listJoin(data.memberIds.map((id) => app.member(id)?.name).filter(Boolean));
    data.title = data.type === 'birthday' ? `${names}'s birthday` : data.type === 'anniversary' ? `${names} · anniversary` : `${names ? names + ' · ' : ''}${typeOf(data.type).label}`;
  }
  if (ev) await S.update(app.path('events/' + ev.id), data);
  else await S.add(app.path('events'), { ...data, createdBy: st.me, createdAt: Date.now() });
  toast(ev ? 'Saved.' : 'Added. The family will see it.');
  return data;
}

// ───────── Copy dates from another of your circles ─────────
// Birthdays, anniversaries and other yearly dates come across matched to the same people by first name.
// Dates this circle already has are left out, and a date for someone who isn't in this circle starts unticked.
const norm = (s) => String(s || '').trim().toLowerCase();
const mmdd = (d) => String(d || '').slice(5, 10);

export async function copyFromCircle(app, others) {
  const st = app.state;
  if (!others?.length) { toast('You are only in this one circle.'); return; }
  let src = others[0];
  if (others.length > 1) {
    const r = await sheet({ title: 'Copy dates from…', submit: 'Next', fields: [
      { name: 'cid', label: 'Which circle?', type: 'select', value: others[0].id, options: others.map((c) => ({ value: c.id, label: c.name })) },
    ] });
    if (!r) return;
    src = others.find((c) => c.id === r.cid) || others[0];
  }
  let srcMembers, srcEvents;
  try { [srcMembers, srcEvents] = await Promise.all([S.getColl(`circles/${src.id}/members`), S.getColl(`circles/${src.id}/events`)]); }
  catch (e) { toast(`Could not read ${src.name}. Check your connection.`); return; }

  // People here, by first name (only names that are unique here, so nobody gets the wrong birthday).
  const here = new Map();
  Object.values(st.members).forEach((m) => { const k = norm(m.name); here.set(k, here.has(k) ? null : m.id); });
  const srcName = Object.fromEntries(srcMembers.map((m) => [m.id, m.name]));

  const yearly = srcEvents.filter((ev) => ev.recurring || typeOf(ev.type).yearly);
  const rows = yearly
    .map((ev) => {
      const ids = (ev.memberIds || []).map((id) => here.get(norm(srcName[id])) || null);
      const mapped = ids.filter(Boolean);
      const allFound = ids.every(Boolean);
      const dup = st.events.some((x) => x.type === ev.type && mmdd(x.date) === mmdd(ev.date)
        && (norm(x.title) === norm(ev.title) || (mapped.length && mapped.every((id) => (x.memberIds || []).includes(id)))));
      return { ev, mapped, allFound, dup };
    })
    .filter((r) => !r.dup && (r.mapped.length || !(r.ev.memberIds || []).length))
    .sort((a, b) => mmdd(a.ev.date).localeCompare(mmdd(b.ev.date)));

  const missing = yearly.filter((ev) => (ev.memberIds || []).length && !(ev.memberIds || []).some((id) => here.get(norm(srcName[id])))).length;
  const skipped = missing ? ` ${missing} date${missing === 1 ? ' is' : 's are'} left out because ${missing === 1 ? 'that person isn\'t' : 'those people aren\'t'} in this circle yet. Add them in Family settings, then copy again.` : '';
  if (!rows.length) { toast(`Nothing new to copy.${skipped}`, skipped ? 8000 : 2600); return; }
  const r = await sheet({
    title: `Copy from ${src.name}`,
    intro: `Tick the dates to add here. They are matched to people with the same first name in this circle.${skipped}`,
    submit: 'Copy dates',
    fields: [{ name: 'pick', label: `${rows.length} date${rows.length === 1 ? '' : 's'} not here yet`, type: 'checks',
      value: rows.filter((x) => x.allFound).map((x) => x.ev.id),
      options: rows.map((x) => ({ value: x.ev.id, label: `${x.ev.title} · ${shortDate(x.ev.date)}${x.allFound ? '' : ' (only some of these people are here)'}` })) }],
  });
  if (!r || !r.pick?.length) return;
  const now = Date.now();
  const ops = rows.filter((x) => r.pick.includes(x.ev.id)).map(({ ev, mapped }) => {
    const names = listJoin(mapped.map((id) => app.member(id)?.name).filter(Boolean));
    const title = !mapped.length ? ev.title : ev.type === 'birthday' ? `${names}'s birthday` : ev.type === 'anniversary' ? `${names} · anniversary` : ev.title;
    return { op: 'set', path: app.path('events/' + S.newId()), data: {
      type: ev.type, title, date: ev.date, endDate: ev.endDate || null, recurring: !!ev.recurring,
      memberIds: mapped, note: ev.note || '', shared: true, createdBy: st.me, createdAt: now } };
  });
  try { await S.batch(ops); toast(`Copied ${ops.length} date${ops.length === 1 ? '' : 's'} from ${src.name}.`); }
  catch (e) { toast(why('The dates did not copy.', e), 9000); }
}
