// Family settings for organizers: households, people, invite links.
import * as S from './store.js';
import { esc, icon, face, sheet, toast, confirmBox, names, listJoin, HH_COLORS, hhColor, why, familyTree, descendantsOf } from './ui.js';
import { THEMES, theme, applyTheme } from './themes.js';
import { pickAndCrop } from './crop.js';
import { listCircles } from './circles.js';
import { PLANS, planState, fmtGB } from './plans.js';

export async function inviteLink(app, memberId) {
  const st = app.state;
  const m = app.member(memberId);
  const code = S.newSecret();
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
    // Organizers can have someone join as an organizer too (to run their branch of the family).
    fields: app.isAdmin() && !m.managedBy?.length ? [{ name: 'organizer', label: `Make ${m.name} an organizer when they join`, type: 'checkbox', value: false }] : [],
  });
  if (!r) return;
  if (r.organizer) {
    try { await S.update(app.path('invites/' + code), { organizer: true }); }
    catch (e) { toast(why("Couldn't mark the invite for an organizer.", e), 9000); return; }
  }
  try {
    if (navigator.share) await navigator.share({ title: 'Join our family', text });
    else { await navigator.clipboard.writeText(text); toast('Invite copied. Paste it into a text message.'); }
    if (r.organizer) toast(`${m.name} will be an organizer when they join.`, 4000);
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
      <p class="hint">One plan covers everyone in this circle. Only organizers see this.</p>
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
  if (!app.isAdmin()) { root.innerHTML = '<p class="pad muted">Only family organizers can change these settings.</p>'; return {}; }
  let accessRows = [];
  let otherCircles = [];

  const render = () => {
    const treeUsed = st.households.some((x) => x.parentId);
    root.innerHTML = `
      <header class="top"><a class="icon-btn" href="#/me" aria-label="Back to My page">${icon('back')}</a>
        <div class="grow"><h1 class="h1">Family settings</h1><div class="muted small">You're an organizer</div></div></header>

      <section class="block card list">
        <div class="li"><span class="li-main"><span class="li-sub">Family name</span><span class="li-title">${esc(st.circle?.name || '')}</span></span>
          <button class="icon-btn sm" data-act="circle" aria-label="Rename family">${icon('edit', 16)}</button></div>
        <div class="li"><span class="hh-swatch" style="--hh:${theme(st.circle?.theme).swatch}" aria-hidden="true"></span><span class="li-main"><span class="li-sub">Circle color</span><span class="li-title">${esc(theme(st.circle?.theme).label)}</span></span>
          <button class="icon-btn sm" data-act="color" aria-label="Change circle color">${icon('edit', 16)}</button></div>
      </section>

      ${planSection(st.circle)}

      <section class="block">
        <div class="row-head"><h2>Households</h2><button class="linkish" data-act="add-hh">${icon('plus', 16)} Add household</button></div>
        ${otherCircles.length ? `<p><button class="linkish" data-act="copy-photos" style="text-align:left">${icon('image', 16)} Copy profile photos from ${otherCircles.length === 1 ? esc(otherCircles[0].name) : 'another circle'}</button></p>` : ''}
        <p class="hint">A household is everyone you'd message together, like a couple and their kids. Each person still gets their own login and private journal.</p>
        ${familyTree(st.households).map(({ h, depth }) => `
          <div class="card list mb" style="margin-left:${Math.min(depth, 3) * 14}px">
            <div class="li"><span class="hh-swatch" style="--hh:${hhColor(h)}" aria-hidden="true"></span><span class="li-main"><span class="li-title">${names(h.name)}</span>${h.parentId && app.household(h.parentId) ? `<span class="li-sub">Under ${esc(app.household(h.parentId).name)}</span>`
              : treeUsed && !st.households.some((x) => x.parentId === h.id) ? `<span class="li-sub warn-text">Not in the family tree yet. Tap the pencil and choose who they're under.</span>` : ''}</span>
              <button class="icon-btn sm" data-act="edit-hh" data-id="${esc(h.id)}" aria-label="Edit ${esc(h.name)}">${icon('edit', 16)}</button></div>
            ${app.membersOf(h.id).map((m) => {
              const acc = accessRows.find((a) => a.memberId === m.id);
              const status = m.uid ? (acc?.role === 'admin' ? 'Organizer · has login' : 'Has login') : (m.managedBy?.length ? 'Managed by parents' : 'Not joined yet');
              return `<div class="li"><button class="face-btn" data-act="photo" data-id="${esc(m.id)}" aria-label="${m.photo ? 'Change' : 'Add'} ${esc(m.name)}'s photo">${face(m)}<span class="face-cam">${icon('camera', 12)}</span></button><span class="li-main"><span class="li-title">${esc(m.name)}</span><span class="li-sub">${status}</span></span>
                ${!m.uid ? `<button class="btn sm" data-act="invite" data-id="${esc(m.id)}">${icon('link', 14)} Invite</button>` : ''}
                <button class="icon-btn sm" data-act="edit-m" data-id="${esc(m.id)}" aria-label="Edit ${esc(m.name)}">${icon('edit', 16)}</button></div>`;
            }).join('')}
            <button class="li add-row" data-act="add-m" data-id="${esc(h.id)}">${icon('plus', 16)} Add a person to ${esc(h.name)}</button>
          </div>`).join('')}
      </section>
      <p class="hint pad-x">Tip: add everyone first, with birthdays, then send each person their own invite link. Young kids don't need a link; their parents manage them from My page.</p>
      <section class="block">
        <h2>Hand the circle over</h2>
        <p class="hint">Setting this up for someone else? Make them an organizer (tap the pencil next to their name), then step down here. You stay in the family as a regular member.</p>
        <div class="card list"><button class="li add-row" data-act="step-down">${icon('users', 16)} Step down as organizer</button></div>
        ${accessRows.filter((a) => a.role === 'admin' && a.id !== st.uid).length ? '' : '<p class="hint">You are the only organizer right now.</p>'}
      </section>`;
  };

  const hhOptions = () => st.households.map((h) => ({ value: h.id, label: h.name }));
  // "Under which household?" choices: the top of the tree, or any household that isn't this one or one of its own.
  const parentOptions = (id) => {
    const skip = id ? descendantsOf(st.households, id) : new Set();
    return [{ value: '', label: 'Top of the family tree (the head of the circle)' },
      ...familyTree(st.households).filter(({ h }) => h.id !== id && !skip.has(h.id)).map(({ h, depth }) => ({ value: h.id, label: `${'— '.repeat(depth)}${h.name}` }))];
  };
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
          { name: 'theme', label: 'Color', type: 'swatches', value: theme(was).key, options: THEMES.map((t) => ({ value: t.key, label: t.label, color: theme(t.key).swatch })) },
        ] });
        // Show the color on the page behind as it's tapped.
        [...document.querySelectorAll('.sheet-wrap')].at(-1)?.addEventListener('change', (ev) => { if (ev.target.name === 'theme') applyTheme(ev.target.value); });
        const r = await pending;
        if (!r || !r.theme || r.theme === theme(was).key) { applyTheme(was); break; }
        try { await S.update(`circles/${st.cid}`, { theme: r.theme }); toast(`Circle color changed to ${theme(r.theme).label}.`); }
        catch (er) { applyTheme(was); toast('The color did not save. Try again.'); }
        break;
      }
      case 'step-down': {
        const others = accessRows.filter((a) => a.role === 'admin' && a.id !== st.uid);
        if (!others.length) { toast('Make someone else an organizer first, so the circle always has one.'); break; }
        const who = listJoin(others.map((a) => app.member(a.memberId)?.name).filter(Boolean));
        if (!(await confirmBox('Step down as organizer?', `${who} will run the circle. You stay in the family, with your chats, photos and journal, but you won't be able to change family settings. An organizer can make you one again.`, 'Step down'))) break;
        try { await S.update(app.path('access/' + st.uid), { role: 'member' }); st.access = { ...st.access, role: 'member' }; toast('You are no longer an organizer.'); location.hash = '#/me'; }
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
        const r = await sheet({ title: 'Edit household', danger: app.membersOf(id).length ? null : 'Delete household', fields: [
          { name: 'name', label: 'Household name', value: h.name, required: true },
          parentField(id, h.parentId),
          { name: 'order', label: 'Position among its brothers and sisters (1 = first)', type: 'number', value: String((h.order ?? 0) + 1) },
          { name: 'color', label: 'Shade', type: 'swatches', value: h.color || HH_COLORS.find((c) => c.value === hhColor(h))?.key, options: HH_COLORS.map((c) => ({ value: c.key, label: c.label, color: c.value })) },
        ] });
        if (!r) return;
        if (r.__danger) {
          // Households that were under this one move up to its parent, so the tree stays in one piece.
          await S.batch([...st.households.filter((x) => x.parentId === id).map((x) => ({ op: 'update', path: app.path('households/' + x.id), data: { parentId: h.parentId || null } })),
            { op: 'delete', path: app.path('households/' + id) }]);
          return;
        }
        await S.update(app.path('households/' + id), { name: r.name, parentId: r.parentId || null, order: Math.max(0, Number(r.order || 1) - 1), color: r.color });
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

  const loadAccess = () => S.getColl(app.path('access')).then((rows) => { accessRows = rows; render(); }).catch(() => {});
  root.addEventListener('click', onClick);
  const off = app.on(render);
  render();
  loadAccess();
  listCircles(app).then((rows) => { otherCircles = rows.filter((c) => !c.current); if (otherCircles.length) render(); }).catch(() => {});
  return { destroy: () => { off(); root.removeEventListener('click', onClick); } };
}
