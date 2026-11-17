// My page: my photo and name, my shared dates, profiles I manage, my nudge settings.
import * as S from './store.js';
import { esc, icon, face, sheet, toast, listJoin } from './ui.js';
import { monShort, dayNum, today, nextOccurrence } from './dates.js';
import { TYPES, typeOf, editEvent, headline } from './events.js';
import { inviteLink } from './manage.js';
import { cropFile } from './crop.js';

export function mount(root, app) {
  const st = app.state;
  const render = () => {
    const me = app.myMember();
    if (!me) return;
    const hh = app.household(me.householdId);
    const housemates = app.membersOf(me.householdId).filter((m) => m.id !== st.me);
    const myDates = st.events.filter((e) => (e.memberIds || []).includes(st.me))
      .sort((a, b) => ((nextOccurrence(a)?.start || '9') < (nextOccurrence(b)?.start || '9') ? -1 : 1));
    const hasBday = myDates.some((e) => e.type === 'birthday');
    const managed = Object.values(st.members).filter((m) => (m.managedBy || []).includes(st.me));
    const days = app.checkinDays();

    root.innerHTML = `
      <header class="top"><div><div class="eyebrow">${esc(st.circle?.name || '')}</div><h1 class="display">My page</h1></div>
        ${app.isAdmin() ? `<a class="btn ghost sm" href="#/manage">${icon('gear', 16)} Family settings</a>` : ''}</header>

      <div class="privacy">${icon('lock', 18)}<span><b>Private page.</b> Only you see this page and your journal. Your photo, name and the dates below marked <b>Shared</b> are the only things the family sees.</span></div>

      <section class="block profile">
        <label class="photo-pick" for="photo" aria-label="Change my photo">
          ${me.photo ? `<img src="${esc(me.photo)}" alt="">` : `${icon('camera', 28)}<span>Add your photo</span>`}
        </label>
        <input id="photo" type="file" accept="image/*" hidden>
        <div class="profile-text">
          <div class="display sm">${esc(me.name)}</div>
          <div class="muted">${esc(hh?.name || '')}</div>
          <button class="linkish" data-act="edit-name">${icon('edit', 14)} Edit name</button>
        </div>
      </section>

      <section class="block">
        <div class="row-head"><h2>My important dates</h2></div>
        <p class="hint">Each date here is shared on the family calendar, and everyone gets a nudge on the day.</p>
        <div class="card list">
          ${!hasBday ? `<button class="li" data-act="add" data-type="birthday"><span class="sq soft">${icon('gift')}</span><span class="li-main"><span class="li-title">My birthday</span><span class="li-sub">Add it so the family remembers</span></span><span class="btn sm ghost">Add date</span></button>` : ''}
          ${myDates.map((ev) => { const o = nextOccurrence(ev); return `
            <button class="li" data-act="edit" data-id="${ev.id}">
              <span class="datechip"><b>${o ? monShort(o.start) : '—'}</b><span>${o ? dayNum(o.start) : ''}</span></span>
              <span class="li-main"><span class="li-title">${esc(ev.type === 'birthday' && (ev.memberIds || []).length === 1 ? 'My birthday' : headline(app, ev, o?.start || today()))} <span class="tag">Shared</span></span>
              <span class="li-sub">${esc(typeOf(ev.type).label)}${(ev.memberIds || []).length > 1 ? ' · with ' + esc(listJoin(ev.memberIds.filter((x) => x !== st.me).map((x) => app.member(x)?.name).filter(Boolean))) : ''}${o ? '' : ' · past'}</span></span>
              ${icon('edit', 16)}
            </button>`; }).join('')}
          <div class="li col">
            <span class="li-title">Add a big day</span>
            <div class="chips">${TYPES.filter((t) => !['trip', 'event'].includes(t.value)).map((t) => `<button class="chip" data-act="add" data-type="${t.value}">${esc(t.label)}</button>`).join('')}</div>
          </div>
        </div>
      </section>

      <section class="block">
        <div class="row-head"><h2>Profiles I manage</h2></div>
        <div class="card list">
          ${managed.map((m) => `<div class="li">
            ${face(m)}
            <span class="li-main"><span class="li-title">${esc(m.name)}</span><span class="li-sub">${m.uid ? 'Has their own login now' : 'Managed by you'}</span></span>
            <button class="btn sm ghost" data-act="kid" data-id="${m.id}">Edit</button>
            ${!m.uid ? `<button class="btn sm ghost" data-act="invite" data-id="${m.id}">${icon('link', 14)} Invite</button>` : ''}
          </div>`).join('')}
          <button class="li" data-act="add-kid"><span class="sq soft">${icon('plus')}</span><span class="li-main"><span class="li-title">Add a child's profile</span><span class="li-sub">Name, photo and birthday. When they get a phone, send an invite and the profile becomes theirs.</span></span></button>
        </div>
      </section>

      <section class="block">
        <div class="row-head"><h2>My nudges</h2></div>
        <div class="card list">
          <div class="li"><span class="li-main"><span class="li-title">Check in with each household</span><span class="li-sub">A nudge on the Family tab when it's been this long</span></span>
            <label class="sr" for="ci">Check-in frequency</label>
            <select id="ci" class="select-pill">${[[3, 'Every 3 days'], [7, 'Weekly'], [14, 'Every 2 weeks'], [30, 'Monthly']].map(([v, l]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="li"><span class="li-main"><span class="li-title">Daily journal reminder</span><span class="li-sub">Adds a repeating reminder to your phone's calendar</span></span>
            <label class="sr" for="jt">Reminder time</label><input id="jt" type="time" value="${esc(st.prefs.journalTime || '21:00')}" class="select-pill">
            <button class="btn sm" data-act="ics">Add</button></div>
        </div>
      </section>

      <section class="block row-btns">
        <button class="btn ghost grow" data-act="signout">Sign out</button>
        ${S.isDemo ? '<button class="btn ghost" data-act="reset">Reset demo</button>' : ''}
      </section>
      <p class="hint center">${housemates.length ? 'Household: ' + esc(listJoin([me.name, ...housemates.map((m) => m.name)])) : ''}</p>`;
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const me = app.myMember();
    switch (b.dataset.act) {
      case 'edit-name': {
        const r = await sheet({ title: 'Edit name', fields: [{ name: 'name', label: 'Name', value: me.name, required: true }] });
        if (r) await S.update(app.path('members/' + st.me), { name: r.name });
        break;
      }
      case 'add': {
        const type = b.dataset.type;
        const spouse = app.membersOf(me.householdId).filter((m) => m.id !== st.me && m.uid).map((m) => m.id);
        await editEvent(app, null, { type, recurring: typeOf(type).yearly, memberIds: type === 'anniversary' ? [st.me, ...spouse.slice(0, 1)] : [st.me] });
        break;
      }
      case 'edit': { const ev = st.events.find((x) => x.id === b.dataset.id); if (ev) await editEvent(app, ev); break; }
      case 'add-kid': await addKid(app); break;
      case 'kid': await editKid(app, b.dataset.id); break;
      case 'invite': await inviteLink(app, b.dataset.id); break;
      case 'ics': downloadICS(root.querySelector('#jt').value || '21:00', app); break;
      case 'signout': await S.auth.signOut(); break;
      case 'reset': S.demo().reset(); break;
    }
  };
  const onChange = async (e) => {
    if (e.target.id === 'photo' && e.target.files[0]) {
      try {
        const cropped = await cropFile(e.target.files[0], 'Your photo');
        e.target.value = '';
        if (!cropped) return;
        toast('Saving photo…');
        const [m] = await app.uploadFiles([cropped]);
        await S.update(app.path('members/' + st.me), { photo: m.url });
        toast('Photo updated.');
      } catch (er) { toast('Photo did not upload. Try again.'); }
    }
    if (e.target.id === 'ci') {
      await S.set(`users/${st.uid}`, { prefs: { ...st.prefs, checkinDays: Number(e.target.value) } }, true);
      toast('Saved.');
    }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  const off = app.on(render);
  render();
  return { destroy: () => { off(); root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); } };
}

async function addKid(app) {
  const st = app.state;
  const me = app.myMember();
  const r = await sheet({
    title: "Add a child's profile",
    intro: 'They will appear in your household and in family chats. You manage it until they have their own login.',
    submit: 'Add',
    fields: [
      { name: 'name', label: 'First name', required: true },
      { name: 'bday', label: 'Birthday', type: 'date' },
      { name: 'photo', label: 'Photo (optional)', type: 'file', accept: 'image/*' },
    ],
  });
  if (!r) return;
  const managers = app.membersOf(me.householdId).filter((m) => m.uid).map((m) => m.id);
  const mid = S.newId();
  let photo = null;
  if (r.photo?.length) { const c = await cropFile(r.photo[0], `${r.name}'s photo`); if (c) { try { photo = (await app.uploadFiles([c]))[0].url; } catch (e) {} } }
  await S.set(app.path('members/' + mid), {
    name: r.name, householdId: me.householdId, order: Object.keys(st.members).length, photo,
    uid: null, claimed: false, managedBy: [...new Set([st.me, ...managers])], createdAt: Date.now(),
  });
  if (r.bday) await S.add(app.path('events'), { type: 'birthday', title: `${r.name}'s birthday`, date: r.bday, endDate: null, recurring: true, memberIds: [mid], note: '', shared: true, createdBy: st.me, createdAt: Date.now() });
  toast(`${r.name} added to your household.`);
}

async function editKid(app, id) {
  const m = app.member(id);
  const r = await sheet({
    title: 'Edit ' + m.name, danger: m.uid ? null : 'Remove profile',
    fields: [
      { name: 'name', label: 'Name', value: m.name, required: true },
      { name: 'photo', label: 'New photo (optional)', type: 'file', accept: 'image/*' },
    ],
  });
  if (!r) return;
  if (r.__danger) { await S.del(app.path('members/' + id)); toast('Profile removed.'); return; }
  const data = { name: r.name };
  if (r.photo?.length) { const c = await cropFile(r.photo[0], `${r.name}'s photo`); if (c) { try { data.photo = (await app.uploadFiles([c]))[0].url; } catch (e) {} } }
  await S.update(app.path('members/' + id), data);
  toast('Saved. Add or change their birthday under Birthdays & big days.');
}

function downloadICS(time, app) {
  const [hh, mm] = time.split(':');
  const d = new Date(); d.setHours(Number(hh), Number(mm), 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const url = location.origin + location.pathname + '#/journal';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Our Circle//Journal//EN', 'BEGIN:VEVENT',
    `UID:journal-${app.state.uid}@ourcircle`, `DTSTAMP:${stamp}`, `DTSTART:${stamp}`, `DTEND:${stamp}`,
    'RRULE:FREQ=DAILY', 'SUMMARY:Write in my journal', `DESCRIPTION:Open your journal: ${url}`, `URL:${url}`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Write in my journal', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'journal-reminder.ics';
  document.body.appendChild(a); a.click(); a.remove();
  S.set(`users/${app.state.uid}`, { prefs: { ...app.state.prefs, journalTime: time } }, true).catch(() => {});
  toast('Open the downloaded file to add the daily reminder to your calendar.');
}
