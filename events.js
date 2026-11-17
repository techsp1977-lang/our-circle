// Shared dates & events: birthdays, anniversaries, graduations, trips, anything.
import * as S from './store.js';
import { sheet, toast, listJoin } from './ui.js';
import { nextOccurrence, today, yearsSince, occurrenceInMonth, monthsFrom } from './dates.js';

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
  const r = await sheet({
    title: ev ? 'Edit date' : 'Add a date',
    intro: 'Shared with the whole family. Everyone gets a nudge on the day.',
    danger: ev && canEdit(app, ev) ? 'Delete' : null,
    fields: [
      { name: 'type', label: 'What is it?', type: 'select', value: cur.type, options: TYPES.map((t) => ({ value: t.value, label: t.label })) },
      { name: 'title', label: 'Title', value: cur.title || '', placeholder: 'Family trip · Cancún', hint: 'Optional for birthdays and anniversaries.' },
      { name: 'date', label: 'Date (or first day)', type: 'date', value: cur.date || '', required: true },
      { name: 'endDate', label: 'Last day (for trips and multi-day events)', type: 'date', value: cur.endDate || '' },
      { name: 'recurring', label: 'Repeats every year', type: 'checkbox', value: cur.recurring ?? typeOf(cur.type).yearly },
      { name: 'memberIds', label: 'Who is it for? (leave empty for everyone)', type: 'checks', value: cur.memberIds || [], options: people.map((m) => ({ value: m.id, label: m.name })) },
      { name: 'note', label: 'Note', type: 'textarea', rows: 2, value: cur.note || '' },
    ],
  });
  if (!r) return null;
  if (r.__danger) {
    await S.del(app.path('events/' + ev.id));
    toast('Date removed.');
    return null;
  }
  const data = {
    type: r.type, title: r.title, date: r.date,
    endDate: r.endDate && r.endDate > r.date ? r.endDate : null,
    recurring: !!r.recurring, memberIds: r.memberIds, note: r.note, shared: true,
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
