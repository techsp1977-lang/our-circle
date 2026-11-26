// Birthdays made easy: everyone's birthday on one screen (Month / Day / Year), and a quiet fix-up of dates that
// were saved as a plain event but are really birthdays.
import * as S from './store.js';
import { esc, sheet, toast, face, mdyHTML, mdyValue, names } from './ui.js';
import { knownYear } from './dates.js';

// The birthday date for one person (a yearly birthday that's only theirs).
export const birthdayOf = (app, mid) => app.state.events.find((ev) => ev.type === 'birthday' && (ev.memberIds || []).length === 1 && ev.memberIds[0] === mid) || null;

// Whose birthdays I can set: circle owners, everyone; household managers, their households; everyone else,
// themselves and the children they look after.
export function canSetBirthday(app, m) {
  const st = app.state;
  return app.isAdmin() || m.id === st.me || (m.managedBy || []).includes(st.me) || app.runs(m.householdId);
}

export async function saveBirthday(app, m, date) {
  const ev = birthdayOf(app, m.id);
  if (!date) { if (ev) await S.del(app.path('events/' + ev.id)); return; }
  if (ev) {
    if (ev.date !== date || !ev.recurring) await S.update(app.path('events/' + ev.id), { date, recurring: true });
    return;
  }
  await S.add(app.path('events'), { type: 'birthday', title: `${m.name}'s birthday`, date, endDate: null, recurring: true, memberIds: [m.id], note: '', shared: true, createdBy: app.state.me, createdAt: Date.now() });
}

export async function openBirthdays(app) {
  const st = app.state;
  const mine = Object.values(st.members).filter((m) => canSetBirthday(app, m));
  const groups = st.households.map((h) => ({ h, people: mine.filter((m) => m.householdId === h.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) })).filter((g) => g.people.length);
  const loose = mine.filter((m) => !st.households.some((h) => h.id === m.householdId));
  if (loose.length) groups.push({ h: { name: 'Others' }, people: loose });
  const row = (m) => {
    const ev = birthdayOf(app, m.id);
    return `<div class="bd-row"><span class="bd-name">${face(m)}${esc(m.name)}${ev && !knownYear(ev.date) ? '<small>No year</small>' : ''}</span>${mdyHTML('b_' + m.id, ev?.date || '')}</div>`;
  };
  const p = sheet({
    title: 'Birthdays',
    intro: app.isAdmin() ? 'Pick the month and day for each person. The year is optional (add it to show their age).'
      : 'Pick the month and day. The year is optional (add it to show their age). You can set your own and the people you look after.',
    submit: 'Save birthdays',
    cancel: 'Cancel',
    body: groups.map((g) => `<div class="bd-group">${names(g.h.name)}</div>${g.people.map(row).join('')}`).join(''),
    fields: [],
  });
  const form = [...document.querySelectorAll('.sheet-wrap')].at(-1)?.querySelector('form');
  const r = await p;
  if (!r || !form) return;
  const changes = mine.map((m) => ({ m, date: mdyValue(form, 'b_' + m.id), before: birthdayOf(app, m.id)?.date || '' })).filter((x) => x.date !== x.before);
  if (!changes.length) { toast('No changes.'); return; }
  let failed = 0;
  for (const { m, date } of changes) { try { await saveBirthday(app, m, date); } catch (e) { failed++; console.warn(e); } }
  toast(failed ? `Saved ${changes.length - failed}. ${failed} couldn't be saved: ask a circle owner to change ${failed === 1 ? 'that one' : 'those'}.` : `Saved ${changes.length} birthday${changes.length === 1 ? '' : 's'}.`, failed ? 9000 : 3000);
}

// Dates typed as "Leah's birthday" but saved as a family event (or not set to repeat) don't show as birthdays:
// no cake, no age, no bubble celebration, and they never come round again. Circle owners' apps fix them quietly.
const fixedFor = new Set();
export async function fixBirthdays(app) {
  const st = app.state;
  if (!app.isAdmin() || fixedFor.has(st.cid)) return;
  fixedFor.add(st.cid);
  const first = (n) => String(n || '').trim().split(/\s+/)[0].toLowerCase();
  const people = Object.values(st.members);
  for (const ev of st.events) {
    if (!ev.date) continue;
    const change = {};
    const isBday = /\b(birthday|bday|b-day)\b/i.test(ev.title || '');
    if (ev.type !== 'birthday' && isBday && !['trip', 'anniversary'].includes(ev.type) && !(ev.endDate && ev.endDate !== ev.date)) { change.type = 'birthday'; change.recurring = true; }
    if (ev.type === 'birthday' && !ev.recurring) change.recurring = true;
    if ((ev.type === 'birthday' || change.type) && !(ev.memberIds || []).length) {
      // "Leah's birthday": attach it to Leah when only one person here has that first name.
      const word = String(ev.title || '').toLowerCase().match(/^\s*([^\s']+)/)?.[1];
      const hits = people.filter((m) => first(m.name) === word);
      if (hits.length === 1) change.memberIds = [hits[0].id];
    }
    if (Object.keys(change).length) await S.update(app.path('events/' + ev.id), change).catch((e) => console.warn('birthday fix', e));
  }
}
