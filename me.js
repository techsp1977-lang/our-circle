// My page: my photo and name, my shared dates, profiles I manage, my nudge settings.
import * as S from './store.js';
import { esc, icon, face, sheet, toast, listJoin, safeUrl, confirmBox, why } from './ui.js';
import { monShort, dayNum, today, nextOccurrence } from './dates.js';
import { TYPES, typeOf, editEvent, headline } from './events.js';
import { inviteLink } from './manage.js';
import { openBirthdays } from './birthdays.js';
import { cropFile } from './crop.js';
import { pushState, prepareKey, turnOnPush, turnOffPush, testPush } from './push.js';
import { faceAvailable, faceLabel, hasPasskey, lockOn, enableLock, disableLock, setupPasskey, removePasskey, prepared, explain } from './lock.js';

const PUSH_TEXT = {
  on: 'On. New messages show on this phone even when the app is closed.',
  off: 'Show new messages on this phone, even when the app is closed.',
  blocked: "Blocked in your phone's settings. Turn on in Settings → Notifications → Our Circle.",
  install: 'On iPhone, add Our Circle to your Home Screen first (Share → Add to Home Screen), then open it from there.',
  unsupported: "This browser can't show notifications.",
};

export function mount(root, app) {
  const st = app.state;
  let canLock = false;
  let pushSt = null; // phone notifications on this device: on | off | blocked | install | unsupported
  let prep = null; // the server's half of "Set up Face ID", fetched before the tap
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
    const others = st.households.filter((h) => h.id !== me.householdId && app.membersOf(h.id).some((m) => m.uid));

    root.innerHTML = `
      <header class="top"><div><div class="eyebrow">${esc(st.circle?.name || '')}</div><h1 class="display">My page</h1></div>
        ${app.isAdmin() ? `<a class="btn ghost sm" href="#/manage">${icon('gear', 16)} Family settings</a>` : app.runsAny() ? `<a class="btn ghost sm" href="#/manage">${icon('gear', 16)} Household settings</a>` : ''}</header>

      <div class="privacy">${icon('lock', 18)}<span><b>Private page.</b> Only you see this page and your journal. Your photo, name and the dates below marked <b>Shared</b> are the only things the family sees.</span></div>

      <section class="block profile">
        <label class="photo-pick" for="photo" aria-label="Change my photo">
          ${me.photo ? `<img src="${esc(safeUrl(me.photo))}" alt="">` : `${icon('camera', 28)}<span>Add your photo</span>`}
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
            <button class="li" data-act="edit" data-id="${esc(ev.id)}">
              <span class="datechip"><b>${o ? monShort(o.start) : '—'}</b><span>${o ? dayNum(o.start) : ''}</span></span>
              <span class="li-main"><span class="li-title">${esc(ev.type === 'birthday' && (ev.memberIds || []).length === 1 ? 'My birthday' : headline(app, ev, o?.start || today()))} <span class="tag">Shared</span></span>
              <span class="li-sub">${esc(typeOf(ev.type).label)}${(ev.memberIds || []).length > 1 ? ' · with ' + esc(listJoin(ev.memberIds.filter((x) => x !== st.me).map((x) => app.member(x)?.name).filter(Boolean))) : ''}${o ? '' : ' · past'}</span></span>
              ${icon('edit', 16)}
            </button>`; }).join('')}
          <button class="li" data-act="birthdays"><span class="sq soft">${icon('gift')}</span><span class="li-main"><span class="li-title">${app.isAdmin() ? "Everyone's birthdays" : 'Birthdays on one screen'}</span><span class="li-sub">${app.isAdmin() ? 'Add or fix anyone\'s birthday' : 'Yours and the people you look after'}</span></span>${icon('next', 16)}</button>
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
            <button class="btn sm ghost" data-act="kid" data-id="${esc(m.id)}">Edit</button>
            ${!m.uid ? `<button class="btn sm ghost" data-act="invite" data-id="${esc(m.id)}">${icon('link', 14)} Invite</button>` : ''}
          </div>`).join('')}
          <button class="li" data-act="add-kid"><span class="sq soft">${icon('plus')}</span><span class="li-main"><span class="li-title">Add a child's profile</span><span class="li-sub">Name, photo and birthday. When they get a phone, send an invite and the profile becomes theirs.</span></span></button>
        </div>
      </section>

      <section class="block">
        <div class="row-head"><h2>My nudges</h2></div>
        <div class="card list">
          <div class="li"><span class="li-main"><span class="li-title">Check in with each household</span><span class="li-sub">A nudge on the Family tab when it's been this long</span></span>
            <label class="sr" for="ci">Check-in frequency</label>
            <select id="ci" class="select-pill">${[[3, 'Every 3 days'], [7, 'Weekly'], [14, 'Every 2 weeks'], [30, 'Monthly'], [0, 'Off']].map(([v, l]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          ${days && others.length ? `<div class="li col"><span class="li-title">Check-in nudges for</span>
            ${others.map((h) => `<label class="check" for="nc_${esc(h.id)}"><input type="checkbox" id="nc_${esc(h.id)}" data-checkin="${esc(h.id)}" ${app.checkinMuted(h.id) ? '' : 'checked'}> <span>${esc(h.name)}</span></label>`).join('')}</div>` : ''}
          <div class="li"><span class="li-main"><span class="li-title">Daily journal reminder</span><span class="li-sub">Adds a repeating reminder to your phone's calendar</span></span>
            <label class="sr" for="jt">Reminder time</label><input id="jt" type="time" value="${esc(st.prefs.journalTime || '21:00')}" class="select-pill">
            <button class="btn sm" data-act="ics">Add</button></div>
        </div>
      </section>

      ${pushSt ? `<section class="block">
        <div class="row-head"><h2>Notifications</h2></div>
        <div class="card list">
          <div class="li"><span class="li-main"><span class="li-title">New messages on this phone</span><span class="li-sub">${esc(PUSH_TEXT[pushSt])}</span></span>
            ${pushSt === 'on' ? '<button class="btn sm ghost" data-act="push-off">Turn off</button>' : pushSt === 'off' ? '<button class="btn sm" data-act="push-on">Turn on</button>' : ''}</div>
          ${pushSt === 'on' ? `<div class="li"><span class="li-main"><span class="li-title">Check it works</span><span class="li-sub">Sends a notification to your phones. Close the app or lock your phone to see it arrive.</span></span>
            <button class="btn sm ghost" data-act="push-test">Send a test</button></div>` : ''}
          <div class="li"><span class="li-main"><span class="li-title">Alerts inside the app</span><span class="li-sub">A banner when a message arrives while you're on another screen</span></span>
            <label class="sr" for="inapp">Alerts inside the app</label>
            <select id="inapp" class="select-pill"><option value="on" ${st.prefs.inAppAlerts === false ? '' : 'selected'}>On</option><option value="off" ${st.prefs.inAppAlerts === false ? 'selected' : ''}>Off</option></select></div>
        </div>
      </section>` : ''}

      ${canLock ? `<section class="block">
        <div class="row-head"><h2>This phone</h2></div>
        <div class="card list">
          <div class="li"><span class="li-main"><span class="li-title">Sign in with ${esc(faceLabel())}</span><span class="li-sub">${hasPasskey(st.uid) ? `On. Use "Sign in with ${esc(faceLabel())}" on the sign-in screen.` : `Skip typing your password on this phone.`}</span></span>
            <button class="btn sm ${hasPasskey(st.uid) ? 'ghost' : ''}" data-act="${hasPasskey(st.uid) ? 'pk-remove' : 'pk-setup'}">${hasPasskey(st.uid) ? 'Turn off' : 'Set up'}</button></div>
          ${hasPasskey(st.uid) ? `<div class="li"><span class="li-main"><span class="li-title">Lock the app with ${esc(faceLabel())}</span><span class="li-sub">Asks for ${esc(faceLabel())} when you open Our Circle, and after a minute away</span></span>
            <button class="btn sm ghost" data-act="${lockOn(st.uid) ? 'lock-off' : 'lock-on'}">${lockOn(st.uid) ? 'Turn off' : 'Turn on'}</button></div>` : ''}
        </div>
      </section>` : ''}

      ${(() => { try { return localStorage.getItem('oc-owner') ? `<section class="block"><a class="card link-card" href="#/admin"><span class="sq">${icon('gear', 22)}</span><span class="li-main"><span class="li-title">Admin</span><span class="li-sub">Circles, payments and revenue</span></span>${icon('next', 18)}</a></section>` : ''; } catch (e) { return ''; } })()}

      <section class="block row-btns">
        <button class="btn ghost grow" data-act="signout">Sign out</button>
        ${S.isDemo ? '<button class="btn ghost" data-act="reset">Reset demo</button>' : ''}
      </section>
      <p class="hint center">${housemates.length ? 'Household: ' + esc(listJoin([me.name, ...housemates.map((m) => m.name)])) + ' · ' : ''}<a href="tour.html">Quick tour</a> · <a href="about.html">Plans, terms and privacy</a></p>`;
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
      case 'birthdays': await openBirthdays(app); break;
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
      // Each of these goes straight to Face ID from the tap (iPhone requires that).
      case 'pk-setup': {
        try { await setupPasskey(st.uid, prep, `${me.name} · ${navigator.platform || 'phone'}`); toast(`${faceLabel()} sign-in is on for this phone.`); }
        catch (er) { console.warn(er); toast(explain(er), 9000); prep?.refresh(); }
        render(); break;
      }
      case 'pk-remove': {
        if (!(await confirmBox(`Turn off ${faceLabel()} sign-in?`, `You'll sign in with your password on this phone. You can set it up again any time. To remove the saved passkey completely, delete it in the iPhone Passwords app too.`, 'Turn off'))) break;
        await removePasskey(st.uid); toast(`${faceLabel()} sign-in is off.`); render(); break;
      }
      case 'push-on': {
        try { await turnOnPush(st.uid); toast('Notifications are on for this phone.'); }
        catch (er) {
          console.warn(er);
          toast(window.Notification?.permission === 'denied' ? 'Notifications are blocked. Turn them on in your phone\'s Settings → Notifications → Our Circle.' : `Notifications didn't turn on: ${er?.message || er}`, 9000);
        }
        pushSt = await pushState(st.uid); render(); break;
      }
      case 'push-test': {
        b.disabled = true; b.textContent = 'Sending…';
        const r = await testPush(st.uid);
        toast(r.text, r.ok ? 9000 : 12000);
        pushSt = await pushState(st.uid); render(); break;
      }
      case 'push-off': {
        await turnOffPush(st.uid); toast('Notifications are off for this phone.');
        pushSt = await pushState(st.uid); render(); break;
      }
      case 'lock-on': case 'lock-off': {
        try { await (b.dataset.act === 'lock-on' ? enableLock : disableLock)(st.uid); toast(b.dataset.act === 'lock-on' ? `The app now locks with ${faceLabel()}.` : 'The app lock is off.'); }
        catch (er) { toast(explain(er), 9000); }
        render(); break;
      }
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
        await app.setMyPhoto(m.url);
        toast('Photo updated in all your circles.');
      } catch (er) { toast(why('Photo did not upload.', er), 9000); }
    }
    if (e.target.id === 'inapp') {
      await S.set(`users/${st.uid}`, { prefs: { ...st.prefs, inAppAlerts: e.target.value === 'on' } }, true);
      toast(e.target.value === 'on' ? 'In-app alerts are on.' : 'In-app alerts are off.');
    }
    if (e.target.dataset.checkin) {
      await app.setCheckinMuted(e.target.dataset.checkin, !e.target.checked);
      toast(e.target.checked ? 'Check-in nudges on for that household.' : 'Check-in nudges off for that household.');
    }
    if (e.target.id === 'ci') {
      await S.set(`users/${st.uid}`, { prefs: { ...st.prefs, checkinDays: Number(e.target.value) } }, true);
      toast(Number(e.target.value) ? 'Saved.' : 'Check-in nudges are off.');
    }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  const off = app.on(render);
  render();
  pushState(st.uid).then((s) => { pushSt = s; if (s === 'off') prepareKey(); render(); });
  // Show the Admin link to the app owner: ask the server once per visit (it checks the owner's email).
  let checked = false;
  try { checked = !!localStorage.getItem('oc-owner') || !!sessionStorage.getItem('oc-owner-checked'); } catch (e) {}
  if (!checked && !S.isDemo) {
    try { sessionStorage.setItem('oc-owner-checked', '1'); } catch (e) {}
    S.callFn('admin', { action: 'whoami' }).then(() => { try { localStorage.setItem('oc-owner', '1'); } catch (e) {} render(); }).catch(() => {});
  }
  faceAvailable().then((v) => { canLock = v; if (v) { prep = prepared('registerOptions'); if (!hasPasskey(st.uid)) prep.get(); render(); } });
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
      { name: 'bday', label: 'Birthday', type: 'mdy', hint: 'The year is optional.' },
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
