// Family settings for organizers: households, people, invite links.
import * as S from './store.js';
import { esc, icon, face, sheet, toast, confirmBox } from './ui.js';

export async function inviteLink(app, memberId) {
  const st = app.state;
  const m = app.member(memberId);
  const code = S.newId() + S.newId();
  await S.set(app.path('invites/' + code), {
    memberId, memberName: m.name, circleName: st.circle?.name || '', used: false, createdBy: st.me, createdAt: Date.now(),
  });
  const link = `${location.origin}${location.pathname}?join=${st.cid}.${code}`;
  const text = `${m.name}, join ${st.circle?.name || 'our family'} on our family app: ${link}`;
  const r = await sheet({
    title: `Invite ${m.name}`,
    intro: 'Send this link by text. It works once and signs them in as ' + m.name + '.',
    submit: navigator.share ? 'Share link' : 'Copy link',
    body: `<p class="linkbox">${esc(link)}</p>`,
    fields: [],
  });
  if (!r) return;
  try {
    if (navigator.share) await navigator.share({ title: 'Join our family', text });
    else { await navigator.clipboard.writeText(text); toast('Invite copied. Paste it into a text message.'); }
  } catch (e) { toast('Copy the link above and text it.'); }
}

export function mount(root, app) {
  const st = app.state;
  if (!app.isAdmin()) { root.innerHTML = '<p class="pad muted">Only family organizers can change these settings.</p>'; return {}; }
  let accessRows = [];

  const render = () => {
    root.innerHTML = `
      <header class="top"><a class="icon-btn" href="#/me" aria-label="Back to My page">${icon('back')}</a>
        <div class="grow"><h1 class="h1">Family settings</h1><div class="muted small">You're an organizer</div></div></header>

      <section class="block card list">
        <div class="li"><span class="li-main"><span class="li-sub">Family name</span><span class="li-title">${esc(st.circle?.name || '')}</span></span>
          <button class="icon-btn sm" data-act="circle" aria-label="Rename family">${icon('edit', 16)}</button></div>
      </section>

      <section class="block">
        <div class="row-head"><h2>Households</h2><button class="linkish" data-act="add-hh">${icon('plus', 16)} Add household</button></div>
        <p class="hint">A household is everyone you'd message together, like a couple and their kids. Each person still gets their own login and private journal.</p>
        ${st.households.map((h) => `
          <div class="card list mb">
            <div class="li"><span class="li-main"><span class="li-title">${esc(h.name)}</span></span>
              <button class="icon-btn sm" data-act="edit-hh" data-id="${h.id}" aria-label="Edit ${esc(h.name)}">${icon('edit', 16)}</button></div>
            ${app.membersOf(h.id).map((m) => {
              const acc = accessRows.find((a) => a.memberId === m.id);
              const status = m.uid ? (acc?.role === 'admin' ? 'Organizer · has login' : 'Has login') : (m.managedBy?.length ? 'Managed by parents' : 'Not joined yet');
              return `<div class="li">${face(m)}<span class="li-main"><span class="li-title">${esc(m.name)}</span><span class="li-sub">${status}</span></span>
                ${!m.uid ? `<button class="btn sm" data-act="invite" data-id="${m.id}">${icon('link', 14)} Invite</button>` : ''}
                <button class="icon-btn sm" data-act="edit-m" data-id="${m.id}" aria-label="Edit ${esc(m.name)}">${icon('edit', 16)}</button></div>`;
            }).join('')}
            <button class="li add-row" data-act="add-m" data-id="${h.id}">${icon('plus', 16)} Add a person to ${esc(h.name)}</button>
          </div>`).join('')}
      </section>
      <p class="hint pad-x">Tip: add everyone first, with birthdays, then send each person their own invite link. Young kids don't need a link; their parents manage them from My page.</p>`;
  };

  const hhOptions = () => st.households.map((h) => ({ value: h.id, label: h.name }));

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'circle': {
        const r = await sheet({ title: 'Family name', fields: [{ name: 'name', label: 'Name', value: st.circle?.name, required: true }] });
        if (r) await S.update(`circles/${st.cid}`, { name: r.name });
        break;
      }
      case 'add-hh': {
        const r = await sheet({ title: 'Add household', intro: 'For example "Jamison, Sophi & Jack", or one person living on their own.', fields: [{ name: 'name', label: 'Household name', required: true }] });
        if (r) await S.add(app.path('households'), { name: r.name, order: st.households.length });
        break;
      }
      case 'edit-hh': {
        const h = app.household(id);
        const r = await sheet({ title: 'Edit household', danger: app.membersOf(id).length ? null : 'Delete household', fields: [
          { name: 'name', label: 'Household name', value: h.name, required: true },
          { name: 'order', label: 'Position in the list (1 = top)', type: 'number', value: String((h.order ?? 0) + 1) },
        ] });
        if (!r) return;
        if (r.__danger) { await S.del(app.path('households/' + id)); return; }
        await S.update(app.path('households/' + id), { name: r.name, order: Math.max(0, Number(r.order || 1) - 1) });
        break;
      }
      case 'add-m': {
        const r = await sheet({ title: 'Add a person', submit: 'Add', fields: [
          { name: 'name', label: 'First name', required: true },
          { name: 'hid', label: 'Household', type: 'select', value: id, options: hhOptions() },
          { name: 'bday', label: 'Birthday (optional)', type: 'date' },
          { name: 'kid', label: 'Young child without a phone (parents manage the profile)', type: 'checkbox', value: false },
        ] });
        if (!r) return;
        const mid = S.newId();
        const parents = r.kid ? app.membersOf(r.hid).filter((m) => m.uid || !m.managedBy?.length).map((m) => m.id) : [];
        await S.set(app.path('members/' + mid), { name: r.name, householdId: r.hid, order: Object.keys(st.members).length, photo: null, uid: null, claimed: false, managedBy: parents, createdAt: Date.now() });
        if (r.bday) await S.add(app.path('events'), { type: 'birthday', title: `${r.name}'s birthday`, date: r.bday, endDate: null, recurring: true, memberIds: [mid], note: '', shared: true, createdBy: st.me, createdAt: Date.now() });
        toast(`${r.name} added.${r.kid ? '' : ' Tap Invite to send their link.'}`);
        break;
      }
      case 'edit-m': {
        const m = app.member(id);
        const acc = accessRows.find((a) => a.memberId === id);
        const fields = [
          { name: 'name', label: 'Name', value: m.name, required: true },
          { name: 'hid', label: 'Household', type: 'select', value: m.householdId, options: hhOptions() },
        ];
        if (m.uid && id !== st.me) fields.push({ name: 'admin', label: 'Organizer (can change family settings)', type: 'checkbox', value: acc?.role === 'admin' });
        const r = await sheet({ title: 'Edit ' + m.name, danger: id === st.me ? null : 'Remove from family', fields });
        if (!r) return;
        if (r.__danger) {
          if (!(await confirmBox(`Remove ${m.name}?`, 'They will lose access to the family. Their private journal is not affected.', 'Remove'))) return;
          if (m.uid) await S.del(app.path('access/' + m.uid)).catch(() => {});
          await S.del(app.path('members/' + id));
          return;
        }
        await S.update(app.path('members/' + id), { name: r.name, householdId: r.hid });
        if (m.uid && 'admin' in r && acc) await S.update(app.path('access/' + m.uid), { role: r.admin ? 'admin' : 'member' });
        loadAccess();
        break;
      }
      case 'invite': await inviteLink(app, id); break;
    }
  };

  const loadAccess = () => S.getColl(app.path('access')).then((rows) => { accessRows = rows; render(); }).catch(() => {});
  root.addEventListener('click', onClick);
  const off = app.on(render);
  render();
  loadAccess();
  return { destroy: () => { off(); root.removeEventListener('click', onClick); } };
}
