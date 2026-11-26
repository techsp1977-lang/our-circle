// Family settings for organizers: households, people, invite links.
import * as S from './store.js';
import { esc, icon, face, sheet, toast, confirmBox, names, listJoin, HH_COLORS, hhColor, hhVars, why, familyTree, descendantsOf } from './ui.js';
import { THEMES, theme, applyTheme } from './themes.js';
import { pickAndCrop } from './crop.js';
import { listCircles } from './circles.js';
import { PLANS, planState, fmtGB } from './plans.js';
import { birthdayOf, saveBirthday, openBirthdays } from './birthdays.js';
import { shortDate, knownYear } from './dates.js';

export async function inviteLink(app, memberId) {
  const st = app.state;
  const m = app.member(memberId);
  const code = S.newSecret();
  await S.set(app.path('invites/' + code), {
    memberId, memberName: m.name, circleName: st.circle?.name || '', used: false, createdBy: st.me, createdAt: Date.now(),
  });
  const link = `${location.origin}${location.pathname}?join=${st.cid}.${code}`;
  // The one-page setup guide (Home Screen, notifications, tour video) goes with every invite, greeting them by name.
  const guide = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}welcome.html?${new URLSearchParams({ to: m.name, c: st.circle?.name || '' })}`;
  const text = `${m.name}, you're invited to join ${st.circle?.name || 'our family'} on Our Circle, our family app.\n\n1) Tap to join: ${link}\n\n2) Quick setup guide (Home Screen, notifications) and a 1½-minute video: ${guide}`;
  const r = await sheet({
    title: `Invite ${m.name}`,
    intro: 'Send this by text. The invite link works once and signs them in as ' + m.name + '. The setup guide and tour video are included.',
    submit: navigator.share ? 'Share invite' : 'Copy invite',
    body: `<p class="linkbox">${esc(link)}</p><p class="hint">Also sent: <a href="${esc(guide)}" target="_blank" rel="noopener">the setup guide and tour video</a></p>`,
    // Organizers can have someone join as an organizer too (to run their branch of the family).
    fields: app.isAdmin() && !m.managedBy?.length ? [{ name: 'organizer', label: `Make ${m.name} a circle owner when they join`, type: 'checkbox', value: false }] : [],
  });
  if (!r) return;
  if (r.organizer) {
    try { await S.update(app.path('invites/' + code), { organizer: true }); }
    catch (e) { toast(why("Couldn't mark the invite for a circle owner.", e), 9000); return; }
  }
  try {
    if (navigator.share) await navigator.share({ title: 'Join our family', text });
    else { await navigator.clipboard.writeText(text); toast('Invite copied. Paste it into a text message.'); }
    if (r.organizer) toast(`${m.name} will be a circle owner when they join.`, 4000);
  } catch (e) { toast('Copy the link above and text it.'); }
}

// Plan & billing: what the family has, how much storage is used, and buttons to choose a plan or manage it.
function planSection(c) {
  const p = planState(c || {});
  const pct = Math.min(100, Math.round((p.used / p.limit) * 100));
  const date = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const line = p.plan === 'trial' ? `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left, ends ${date(p.until)}`
    : p.plan === 'gift' ? 'A gift from the Our Circle team'
    : p.active ? `${p.status === 'past_due' ? 'Payment due' : 'Renews'} ${date(p.until - 3 * 864e5)}`
    : `${p.name}. Choose a plan to keep sharing photos and videos.`;
  return `<section class="block">
    <div class="row-head"><h2>Plan &amp; billing</h2></div>
    <div class="card plan-card">
      <div class="plan-line"><b>${esc(p.active ? p.name : 'No active plan')}</b><span class="muted small">${esc(line)}</span></div>
      <div class="plan-usage"><span class="progress ${pct >= 90 ? 'warn' : ''}" role="progressbar" aria-label="Storage used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${Math.max(pct, 1)}%"></i></span>
        <small class="muted">${fmtGB(p.used)} of ${fmtGB(p.limit)} used for photos and videos</small></div>
      <div class="row-btns">
        ${p.plan === 'gift' ? '' : p.paid && p.active ? `<button class="btn ghost grow" data-act="billing">Manage billing</button>${p.plan === 'family' ? '<button class="btn grow" data-act="billing">Get more storage</button>' : ''}`
          : `<button class="btn grow" data-act="plans">Choose a plan</button>${p.paid ? '<button class="btn ghost grow" data-act="billing">Manage billing</button>' : ''}`}
      </div>
      <p class="hint">One plan covers everyone in this circle. Only circle owners see this.</p>
    </div>
  </section>`;
}

export async function choosePlan(app, pick = 'family') {
  let plan = pick;
  const pending = sheet({
    title: 'Choose a plan',
    intro: 'Yearly, for the whole family. Cancel any time from Manage billing.',
    body: `<div class="plan-pick">${['family', 'plus'].map((k) => `<label class="plan-opt" for="plan_${k}"><input type="radio" name="plan" id="plan_${k}" value="${k}" ${k === pick ? 'checked' : ''}>
        <span><b>${PLANS[k].name}</b> <span class="price">${PLANS[k].price}</span><small>${esc(PLANS[k].blurb)}</small></span></label>`).join('')}</div>`,
    submit: 'Continue to payment',
    fields: [],
  });
  // The sheet is on screen now; remember the choice as it's tapped (the sheet is gone by the time it resolves).
  [...document.querySelectorAll('.sheet-wrap')].at(-1)?.addEventListener('change', (e) => { if (e.target.name === 'plan') plan = e.target.value; });
  if (!(await pending)) return;
  toast('Opening secure checkout…', 8000);
  try { location.href = (await S.callFn('billing', { action: 'checkout', cid: app.state.cid, plan })).url; }
  catch (e) { toast(e?.message || "Checkout couldn't open. Try again."); }
}

// More storage: a family already paying for Family switches to Family Plus in Stripe's billing page (paying only
// the difference for the rest of the year); a family on the free trial picks a plan, with Family Plus selected.
export async function upgradeStorage(app) {
  const p = planState(app.state.circle || {});
  if (p.paid && p.active) {
    toast('Opening billing…', 6000);
    try { location.href = (await S.callFn('billing', { action: 'portal', cid: app.state.cid })).url; }
    catch (er) { toast(er?.message || "Billing couldn't open. Try again."); }
    return;
  }
  return choosePlan(app, 'plus');
}

export function mount(root, app) {
  const st = app.state;
  // Family organizers see everything. Household organizers see only the households they run.
  const admin = app.isAdmin();
  if (!admin && !app.runsAny()) { root.innerHTML = '<p class="pad muted">Only circle owners and household managers can change these settings.</p>'; return {}; }
  const mine = (h) => admin || app.runs(h.id);
  let accessRows = [];
  let ownerInvites = []; // invites that make someone a circle owner when they join
  let otherCircles = [];

  const render = () => {
    const treeUsed = st.households.some((x) => x.parentId);
    root.innerHTML = `
      <header class="top"><a class="icon-btn" href="#/me" aria-label="Back to My page">${icon('back')}</a>
        <div class="grow"><h1 class="h1">${admin ? 'Family settings' : 'Household settings'}</h1><div class="muted small">${admin ? "You're a circle owner" : "You're a household manager"}</div></div></header>
      ${admin ? `
      <section class="block card list">
        <div class="li"><span class="li-main"><span class="li-sub">Family name</span><span class="li-title">${esc(st.circle?.name || '')}</span></span>
          <button class="icon-btn sm" data-act="circle" aria-label="Rename family">${icon('edit', 16)}</button></div>
        <div class="li"><span class="hh-swatch" style="--hh:${theme(st.circle?.theme).swatch}" aria-hidden="true"></span><span class="li-main"><span class="li-sub">Circle color</span><span class="li-title">${esc(theme(st.circle?.theme).label)}</span></span>
          <button class="icon-btn sm" data-act="color" aria-label="Change circle color">${icon('edit', 16)}</button></div>
      </section>

      <section class="block">
        <div class="row-head"><h2>Circle owners</h2><button class="linkish" data-act="add-owner">${icon('plus', 16)} Add a circle owner</button></div>
        <p class="hint">Circle owners can change anything in the whole circle: households, people, the family tree, the color and the plan. Household managers (set in each household below) can change things only inside their own family.</p>
        <div class="card list">
          ${accessRows.filter((a) => a.role === 'admin').map((a) => { const m = app.member(a.memberId); return m ? `<div class="li">${face(m)}<span class="li-main"><span class="li-title">${esc(m.name)}${a.id === st.uid ? ' (you)' : ''}</span><span class="li-sub">Circle owner</span></span>
            ${a.id === st.uid ? '' : `<button class="btn sm ghost" data-act="remove-owner" data-id="${esc(a.id)}">Remove</button>`}</div>` : ''; }).join('')}
          ${ownerInvites.map((i) => { const m = app.member(i.memberId); return m && !m.uid ? `<div class="li">${face(m)}<span class="li-main"><span class="li-title">${esc(m.name)}</span><span class="li-sub">Invited as a circle owner · not joined yet</span></span></div>` : ''; }).join('')}
        </div>
      </section>

      ${planSection(st.circle)}` : ''}

      <section class="block">
        <div class="row-head"><h2>${admin ? 'Households' : 'Your households'}</h2>${admin ? `<button class="linkish" data-act="add-hh">${icon('plus', 16)} Add household</button>` : ''}</div>
        <p><button class="linkish" data-act="birthdays" style="text-align:left">${icon('gift', 16)} ${admin ? "Everyone's birthdays on one screen" : 'Birthdays for your households'}</button></p>
        ${admin && otherCircles.length ? `<p><button class="linkish" data-act="copy-photos" style="text-align:left">${icon('image', 16)} Copy profile photos from ${otherCircles.length === 1 ? esc(otherCircles[0].name) : 'another circle'}</button></p>` : ''}
        <p class="hint">${admin ? "A household is everyone you'd message together, like a couple and their kids. Each person still gets their own login and private journal." : "You can add and edit people in these households, send their invites, and add households under yours, like a married child's."}</p>
        ${familyTree(st.households).filter(({ h }) => mine(h)).map(({ h, depth }) => `
          <div class="card list mb" style="margin-left:${Math.min(depth, 3) * 14}px">
            <div class="li"><span class="hh-swatch" style="${hhVars(h)}" aria-hidden="true"></span><span class="li-main"><span class="li-title">${names(h.name)}</span>${h.parentId && app.household(h.parentId) ? `<span class="li-sub">Under ${esc(app.household(h.parentId).name)}</span>`
              : treeUsed && !st.households.some((x) => x.parentId === h.id) ? `<span class="li-sub warn-text">Not in the family tree yet. Tap the pencil and choose who they're under.</span>` : ''}</span>
              <button class="icon-btn sm" data-act="edit-hh" data-id="${esc(h.id)}" aria-label="Edit ${esc(h.name)}">${icon('edit', 16)}</button></div>
            ${app.membersOf(h.id).map((m) => {
              const acc = accessRows.find((a) => a.memberId === m.id);
              const lead = (h.managers || []).includes(m.id) ? 'Household manager · ' : '';
              const bd = birthdayOf(app, m.id)?.date;
              const status = lead + (m.uid ? (acc?.role === 'admin' ? 'Circle owner · has login' : 'Has login') : (m.managedBy?.length ? 'Managed by parents' : 'Not joined yet'))
                + (bd ? ` · 🎂 ${shortDate(bd)}${knownYear(bd) ? ', ' + bd.slice(0, 4) : ''}` : ' · no birthday yet');
              return `<div class="li"><button class="face-btn" data-act="photo" data-id="${esc(m.id)}" aria-label="${m.photo ? 'Change' : 'Add'} ${esc(m.name)}'s photo">${face(m)}<span class="face-cam">${icon('camera', 12)}</span></button><span class="li-main"><span class="li-title">${esc(m.name)}</span><span class="li-sub">${status}</span></span>
                ${!m.uid ? `<button class="btn sm" data-act="invite" data-id="${esc(m.id)}">${icon('link', 14)} Invite</button>` : ''}
                <button class="icon-btn sm" data-act="edit-m" data-id="${esc(m.id)}" aria-label="Edit ${esc(m.name)}">${icon('edit', 16)}</button></div>`;
            }).join('')}
            <button class="li add-row" data-act="add-m" data-id="${esc(h.id)}">${icon('plus', 16)} Add a person to ${esc(h.name)}</button>
            <button class="li add-row" data-act="add-under" data-id="${esc(h.id)}">${icon('family', 16)} Add a household under ${esc(h.name)}</button>
          </div>`).join('')}
      </section>
      <p class="hint pad-x">Tip: add everyone first, with birthdays, then send each person their own invite link. Young kids don't need a link; their parents manage them from My page.</p>
      ${admin ? `<section class="block">
        <h2>Hand the circle over</h2>
        <p class="hint">Setting this up for someone else? Make them a circle owner (in Circle owners above), then step down here. You stay in the family as a regular member.</p>
        <div class="card list"><button class="li add-row" data-act="step-down">${icon('users', 16)} Step down as circle owner</button></div>
        ${accessRows.filter((a) => a.role === 'admin' && a.id !== st.uid).length ? '' : '<p class="hint">You are the only circle owner right now.</p>'}
      </section>` : ''}`;
  };

  const hhOptions = () => st.households.filter(mine).map((h) => ({ value: h.id, label: h.name }));
  // "Under which household?" choices: the top of the tree, or any household that isn't this one or one of its own.
  const parentOptions = (id) => {
    const skip = id ? descendantsOf(st.households, id) : new Set();
    return [{ value: '', label: 'Top of the family tree (the head of the circle)' },
      ...familyTree(st.households).filter(({ h }) => h.id !== id && !skip.has(h.id)).map(({ h, depth }) => ({ value: h.id, label: `${'— '.repeat(depth)}${h.name}` }))];
  };
  // Household organizers: anyone in that household.
  const managersField = (h) => ({ name: 'managers', label: 'Household managers (can add people, send invites and add households under this one, only inside this family)', type: 'checks',
    value: h.managers || [], options: app.membersOf(h.id).map((m) => ({ value: m.id, label: m.name })) });
  const parentField = (id, value) => ({ name: 'parentId', label: 'Under which household? (for the family tree)', type: 'select', value: value || '', options: parentOptions(id),
    hint: 'For example, put a married child\'s household under their parents\' household.' });

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'plans': choosePlan(app); break;
      case 'billing': {
        b.disabled = true;
        try { location.href = (await S.callFn('billing', { action: 'portal', cid: st.cid })).url; }
        catch (er) { b.disabled = false; toast(er?.message || "Billing couldn't open. Try again."); }
        break;
      }
      case 'circle': {
        const r = await sheet({ title: 'Family name', fields: [{ name: 'name', label: 'Name', value: st.circle?.name, required: true }] });
        if (r) await S.update(`circles/${st.cid}`, { name: r.name });
        break;
      }
      case 'color': {
        const was = st.circle?.theme;
        const pending = sheet({ title: 'Circle color', intro: 'Everyone in the circle sees this color. Each household gets its own shade of it, and so do its chats.', submit: 'Use this color', fields: [
          { name: 'theme', label: 'Color', type: 'swatches', value: theme(was).key, options: THEMES.map((t) => ({ value: t.key, label: t.label, color: theme(t.key).swatch, color2: theme(t.key).swatch2 })) },
        ] });
        // Show the color on the page behind as it's tapped.
        [...document.querySelectorAll('.sheet-wrap')].at(-1)?.addEventListener('change', (ev) => { if (ev.target.name === 'theme') applyTheme(ev.target.value); });
        const r = await pending;
        if (!r || !r.theme || r.theme === theme(was).key) { applyTheme(was); break; }
        try { await S.update(`circles/${st.cid}`, { theme: r.theme }); toast(`Circle color changed to ${theme(r.theme).label}.`); }
        catch (er) { applyTheme(was); toast('The color did not save. Try again.'); }
        break;
      }
      case 'add-owner': {
        const can = Object.values(st.members).filter((m) => m.uid && accessRows.some((a) => a.memberId === m.id && a.role !== 'admin'));
        const waiting = Object.values(st.members).filter((m) => !m.uid && !m.managedBy?.length);
        const r = await sheet({ title: 'Add a circle owner', submit: 'Make circle owner',
          intro: `Circle owners can change anything in the whole circle.${waiting.length ? ` Someone who hasn't joined yet (like ${listJoin(waiting.slice(0, 3).map((m) => m.name))})? Tap Invite next to their name below and tick "Make them a circle owner when they join".` : ''}`,
          fields: can.length ? [{ name: 'who', label: 'People who have joined', type: 'checks', value: [], options: can.map((m) => ({ value: m.id, label: m.name })) }] : [] });
        if (!r || !r.who?.length) break;
        try {
          await S.batch(r.who.map((mid) => ({ op: 'update', path: app.path('access/' + accessRows.find((a) => a.memberId === mid).id), data: { role: 'admin' } })));
          toast(`${listJoin(r.who.map((mid) => app.member(mid)?.name))} ${r.who.length === 1 ? 'is' : 'are'} now ${r.who.length === 1 ? 'a circle owner' : 'circle owners'}.`);
        } catch (er) { toast(why('That did not save.', er), 9000); }
        loadAccess();
        break;
      }
      case 'remove-owner': {
        const a = accessRows.find((x) => x.id === id), m = a && app.member(a.memberId);
        if (!m || !(await confirmBox(`Remove ${m.name} as a circle owner?`, `${m.name} stays in the family, with their chats, photos and journal, but can no longer change things for the whole circle.`, 'Remove'))) break;
        try { await S.update(app.path('access/' + id), { role: 'member' }); toast(`${m.name} is no longer a circle owner.`); } catch (er) { toast(why('That did not save.', er), 9000); }
        loadAccess();
        break;
      }
      case 'step-down': {
        const others = accessRows.filter((a) => a.role === 'admin' && a.id !== st.uid);
        if (!others.length) { toast('Make someone else a circle owner first, so the circle always has one.'); break; }
        const who = listJoin(others.map((a) => app.member(a.memberId)?.name).filter(Boolean));
        if (!(await confirmBox('Step down as circle owner?', `${who} will run the circle. You stay in the family, with your chats, photos and journal, but you won't be able to change family settings. Another circle owner can make you one again.`, 'Step down'))) break;
        try { await S.update(app.path('access/' + st.uid), { role: 'member' }); st.access = { ...st.access, role: 'member' }; toast('You are no longer a circle owner.'); location.hash = '#/me'; }
        catch (er) { toast('That did not work. Try again.'); }
        break;
      }
      case 'add-hh': {
        const r = await sheet({ title: 'Add household', intro: 'For example "Ethan, Olivia & Henry", or one person living on their own.', fields: [{ name: 'name', label: 'Household name', required: true }, parentField(null, '')] });
        if (r) await S.add(app.path('households'), { name: r.name, order: st.households.length, parentId: r.parentId || null });
        break;
      }
      case 'edit-hh': {
        const h = app.household(id);
        const r = await sheet({ title: 'Edit household', danger: admin && !app.membersOf(id).length ? 'Delete household' : null, fields: [
          { name: 'name', label: 'Household name', value: h.name, required: true },
          ...(admin ? [parentField(id, h.parentId)] : []),
          { name: 'order', label: 'Position among its brothers and sisters (1 = first)', type: 'number', value: String((h.order ?? 0) + 1) },
          { name: 'color', label: 'Shade', type: 'swatches', value: h.color || HH_COLORS.find((c) => c.value === hhColor(h))?.key, options: HH_COLORS.map((c) => ({ value: c.key, label: c.label, color: c.value })) },
          ...(app.membersOf(id).length ? [managersField(h)] : []),
        ] });
        if (!r) return;
        if (r.__danger) {
          // Households that were under this one move up to its parent, so the tree stays in one piece.
          await S.batch([...st.households.filter((x) => x.parentId === id).map((x) => ({ op: 'update', path: app.path('households/' + x.id), data: { parentId: h.parentId || null } })),
            { op: 'delete', path: app.path('households/' + id) }]);
          return;
        }
        const upd = { name: r.name, order: Math.max(0, Number(r.order || 1) - 1), color: r.color };
        if (admin) upd.parentId = r.parentId || null;
        if (r.managers) upd.managers = r.managers;
        try { await S.update(app.path('households/' + id), upd); } catch (er) { toast(why('That did not save.', er), 9000); }
        break;
      }
      case 'add-under': {
        const p = app.household(id);
        const r = await sheet({ title: `Add a household under ${p.name}`, intro: 'For example a married child and their spouse, or a grown child living on their own.', submit: 'Add', fields: [{ name: 'name', label: 'Household name', required: true }] });
        if (!r) break;
        try { await S.add(app.path('households'), { name: r.name, order: st.households.filter((x) => x.parentId === id).length, parentId: id }); toast(`${r.name} added under ${p.name}. Now add the people in it.`); }
        catch (er) { toast(why('That household did not save.', er), 9000); }
        break;
      }
      case 'add-m': {
        const r = await sheet({ title: 'Add a person', submit: 'Add', fields: [
          { name: 'name', label: 'First name', required: true },
          { name: 'hid', label: 'Household', type: 'select', value: id, options: hhOptions() },
          { name: 'bday', label: 'Birthday (optional)', type: 'mdy', hint: 'The year is optional.' },
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
          { name: 'bday', label: 'Birthday', type: 'mdy', value: birthdayOf(app, id)?.date || '', hint: 'The year is optional. Clear the month to remove it.' },
        ];
        if (admin && m.uid && id !== st.me) fields.push({ name: 'admin', label: 'Circle owner (can change anything in the whole circle)', type: 'checkbox', value: acc?.role === 'admin' });
        // Household organizers can remove only people who haven't joined yet.
        const r = await sheet({ title: 'Edit ' + m.name, danger: id === st.me || (!admin && m.uid) ? null : 'Remove from family', fields });
        if (!r) return;
        if (r.__danger) {
          if (!(await confirmBox(`Remove ${m.name}?`, 'They will lose access to the family. Their private journal is not affected.', 'Remove'))) return;
          if (m.uid && admin) await S.del(app.path('access/' + m.uid)).catch(() => {});
          await S.del(app.path('members/' + id));
          return;
        }
        try { await S.update(app.path('members/' + id), { name: r.name, householdId: r.hid }); } catch (er) { toast(why('That did not save.', er), 9000); break; }
        if (r.bday !== (birthdayOf(app, id)?.date || '')) {
          try { await saveBirthday(app, { ...m, name: r.name }, r.bday); } catch (er) { toast(why("The birthday didn't save.", er), 9000); break; }
        }
        // A renamed person's birthday keeps a matching title.
        const bev = birthdayOf(app, id);
        if (r.name !== m.name && bev && bev.title === `${m.name}'s birthday`) await S.update(app.path('events/' + bev.id), { title: `${r.name}'s birthday` }).catch(() => {});
        if (m.uid && 'admin' in r && acc) await S.update(app.path('access/' + m.uid), { role: r.admin ? 'admin' : 'member' });
        loadAccess();
        break;
      }
      case 'invite': await inviteLink(app, id); loadAccess(); break;
      case 'birthdays': await openBirthdays(app); break;
      case 'copy-photos': {
        const others = (await listCircles(app).catch(() => [])).filter((c) => !c.current);
        if (!others.length) { toast('You are only in this one circle.'); break; }
        let src = others[0];
        if (others.length > 1) {
          const r = await sheet({ title: 'Copy photos from…', submit: 'Next', fields: [{ name: 'cid', label: 'Which circle?', type: 'select', value: src.id, options: others.map((c) => ({ value: c.id, label: c.name })) }] });
          if (!r) break; src = others.find((c) => c.id === r.cid) || src;
        }
        const theirs = await S.getColl(`circles/${src.id}/members`).catch(() => null);
        if (!theirs) { toast(`Could not read ${src.name}. Check your connection.`); break; }
        const key = (n) => String(n || '').trim().toLowerCase();
        const count = (list) => list.reduce((m, x) => m.set(key(x.name), (m.get(key(x.name)) || 0) + 1), new Map());
        const hereCount = count(Object.values(st.members)), thereCount = count(theirs);
        // Only people with no photo here, and only when the first name is unique in both circles.
        const pairs = Object.values(st.members).filter((m) => !m.photo && hereCount.get(key(m.name)) === 1 && thereCount.get(key(m.name)) === 1)
          .map((m) => [m, theirs.find((t) => key(t.name) === key(m.name))]).filter(([, t]) => t?.photo);
        if (!pairs.length) { toast(`No new photos to copy from ${src.name}. Everyone here with a match already has one.`, 5000); break; }
        if (!(await confirmBox(`Copy ${pairs.length} photo${pairs.length === 1 ? '' : 's'} from ${src.name}?`, `${listJoin(pairs.map(([m]) => m.name))} will get the photo they have in ${src.name}. People who already have a photo here keep theirs.`, 'Copy photos', false))) break;
        try { await S.batch(pairs.map(([m, t]) => ({ op: 'update', path: app.path('members/' + m.id), data: { photo: t.photo } }))); toast(`Copied ${pairs.length} photo${pairs.length === 1 ? '' : 's'}.`); }
        catch (er) { toast(why('The photos did not copy.', er), 9000); }
        break;
      }
      case 'photo': {
        const m = app.member(id);
        const f = await pickAndCrop(`${m.name}'s photo`);
        if (!f) break;
        toast('Saving photo…');
        try { const [u] = await app.uploadFiles([f]); await S.update(app.path('members/' + id), { photo: u.url }); toast('Photo saved.'); }
        catch (er) { toast(why('The photo did not save.', er), 9000); }
        break;
      }
    }
  };

  const loadAccess = () => {
    S.getColl(app.path('access')).then((rows) => { accessRows = rows; render(); }).catch(() => {});
    if (admin) S.getColl(app.path('invites')).then((rows) => { ownerInvites = rows.filter((i) => i.organizer === true && !i.used); render(); }).catch(() => {});
  };
  root.addEventListener('click', onClick);
  const off = app.on(render);
  render();
  loadAccess();
  listCircles(app).then((rows) => { otherCircles = rows.filter((c) => !c.current); if (otherCircles.length) render(); }).catch(() => {});
  return { destroy: () => { off(); root.removeEventListener('click', onClick); } };
}
