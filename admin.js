// Admin (#/admin): the app owner's numbers. Circles bought, money this year, storage, and the plans switch.
// The server checks the owner's email; anyone else sees a polite no.
import * as S from './store.js';
import { esc, icon, toast, confirmBox } from './ui.js';
import { PLANS, fmtGB, money } from './plans.js';

const date = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const PLAN_LABEL = { family: 'Family', plus: 'Family Plus', gift: 'Gift', trial: 'Trial', lapsed: 'Ended', 'trial-over': 'Trial ended' };

export function mount(root) {
  let data = null, busy = false;
  const tile = (label, value, sub = '') => `<div class="stat"><span class="stat-label">${esc(label)}</span><b class="stat-value">${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const render = () => {
    if (!data) { root.innerHTML = '<p class="pad muted">Loading the numbers…</p>'; return; }
    const c = data.counts;
    root.innerHTML = `
      <header class="top"><div><div class="eyebrow">Our Circle</div><h1 class="display">Admin</h1></div>
        <button class="icon-btn" data-act="refresh" aria-label="Refresh">${icon('refresh')}</button></header>
      <section class="block">
        <div class="card plan-switch ${data.enforce ? 'on' : ''}">
          <div><b>Plans are ${data.enforce ? 'ON' : 'OFF'}</b><small>${data.enforce ? 'Trials and plans are enforced: when a family\'s plan ends or storage is full, new photo and video uploads pause.' : 'Nothing is limited yet. Families can try everything; plan notices are hidden.'}</small></div>
          <button class="btn sm ${data.enforce ? 'ghost' : ''}" data-act="enforce">${data.enforce ? 'Turn off' : 'Turn on'}</button>
        </div>
      </section>
      <section class="block stats">
        ${tile('Revenue this year', money(data.ytdCents), `${data.paidCirclesYtd} circle${data.paidCirclesYtd === 1 ? '' : 's'} paid`)}
        ${tile('Last 30 days', money(data.last30Cents))}
        ${tile('Circles bought', String(c.family + c.plus), `${c.family} Family · ${c.plus} Family Plus`)}
        ${tile('Yearly revenue (current plans)', money(data.arrCents))}
        ${tile('All circles', String(c.total), `${c.trial || 0} on trial · ${c.gift || 0} gifts · ${c.lapsed || 0} ended`)}
        ${tile('Photos & videos stored', fmtGB(data.storageBytes))}
      </section>
      <section class="block">
        <div class="row-head"><h2>Recent payments</h2></div>
        ${data.payments.length ? `<div class="card list">${data.payments.map((p) => `<div class="li">
          <span class="li-main"><span class="li-title">${esc(p.circle || 'Unknown circle')}</span><span class="li-sub">${esc(date(p.paidAt))} · ${esc(PLAN_LABEL[p.plan] || p.plan || '')}${p.refunded ? ` · refunded ${money(p.refunded)}` : ''}</span></span>
          <b>${money((p.amount || 0) - (p.refunded || 0))}</b></div>`).join('')}</div>` : '<div class="card empty-card muted">No payments yet.</div>'}
      </section>
      <section class="block">
        <div class="row-head"><h2>Circles</h2><button class="linkish" data-act="recount">Recount storage</button></div>
        <div class="card list">${data.circles.map((r) => `<div class="li">
          <span class="li-main"><span class="li-title">${esc(r.name || r.cid)}</span>
            <span class="li-sub">${esc(PLAN_LABEL[r.plan] || r.plan)}${r.until ? ` · ${r.plan === 'trial' ? 'trial ends' : r.plan === 'lapsed' || r.plan === 'trial-over' ? 'ended' : 'renews'} ${date(r.plan === 'family' || r.plan === 'plus' ? r.until - 3 * 864e5 : r.until)}` : ''} · ${fmtGB(r.bytes)} of ${fmtGB(r.limit)} · started ${date(r.createdAt)}</span></span>
          ${r.plan === 'gift' ? `<button class="btn sm ghost" data-act="ungift" data-cid="${esc(r.cid)}">Remove gift</button>` : r.plan === 'family' || r.plan === 'plus' ? '' : `<button class="btn sm ghost" data-act="gift" data-cid="${esc(r.cid)}">Give free plan</button>`}
        </div>`).join('')}</div>
        <p class="hint">Stripe's own dashboard has the full picture (taxes, payouts, refunds). These numbers come from Stripe's notifications to Our Circle.</p>
      </section>`;
  };
  const load = async () => {
    try { data = await S.callFn('admin', { action: 'stats' }); try { localStorage.setItem('oc-owner', '1'); } catch (e) {} render(); }
    catch (e) {
      try { localStorage.removeItem('oc-owner'); } catch (er) {}
      root.innerHTML = `<p class="pad muted">${e?.code === 'functions/permission-denied' ? 'Only the app owner can see this page.' : 'The numbers could not load. Try again.'}</p>`;
    }
  };
  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy) return;
    busy = true; b.disabled = true;
    try {
      const act = b.dataset.act;
      if (act === 'refresh') await load();
      if (act === 'enforce') {
        const on = !data.enforce;
        const ok = await confirmBox(on ? 'Turn plans on?' : 'Turn plans off?', on
          ? 'Families whose trial or plan has ended, or whose storage is full, will no longer be able to upload new photos and videos. Give your own circles a free plan first.'
          : 'Nothing will be limited, and plan notices will be hidden.', on ? 'Turn on' : 'Turn off');
        if (ok) { await S.callFn('admin', { action: 'enforce', on }); toast(on ? 'Plans are on.' : 'Plans are off.'); await load(); }
      }
      if (act === 'gift' || act === 'ungift') { await S.callFn('admin', { action: act, cid: b.dataset.cid }); toast(act === 'gift' ? 'Free plan given.' : 'Gift removed.'); await load(); }
      if (act === 'recount') { toast('Adding up storage…', 20000); const r = await S.callFn('admin', { action: 'recount' }); toast(`Counted ${r.files} files across ${r.circles} circles.`); await load(); }
    } catch (er) { toast(er?.message || 'That did not work. Try again.'); }
    finally { busy = false; b.disabled = false; }
  };
  root.addEventListener('click', onClick);
  render(); load();
  return { destroy: () => root.removeEventListener('click', onClick) };
}

