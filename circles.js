// Your circles: switch between the families you belong to (your own, your parents', your in-laws'…),
// start a new one, or join one with an invite link.
import * as S from './store.js';
import { esc, icon, toast } from './ui.js';

// [{ id, name, current }] for every circle on this account that's still open to you.
export async function listCircles(app) {
  const u = (await S.get(`users/${app.state.uid}`).catch(() => null)) || {};
  const ids = [...new Set([...(u.circles || []), app.state.cid].filter(Boolean))];
  const rows = await Promise.all(ids.map(async (id) => {
    const c = id === app.state.cid ? app.state.circle : await S.get(`circles/${id}`).catch(() => null);
    return c ? { id, name: c.name || 'Family', current: id === app.state.cid } : null;
  }));
  return rows.filter(Boolean);
}

// A bottom sheet listing your circles. Tap one to switch.
export async function openSwitcher(app) {
  document.querySelectorAll('.sheet-wrap.circles-sheet').forEach((w) => w.remove());
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap circles-sheet';
  const paint = (rows) => {
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Your circles">
      <div class="sheet-head"><h2>Your circles</h2><button type="button" class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="card list circle-list">
        ${rows ? rows.map((c) => `<button class="li" data-cid="${esc(c.id)}" ${c.current ? 'aria-current="true"' : ''}>
          <span class="sq soft">${icon('family', 20)}</span>
          <span class="li-main"><span class="li-title">${esc(c.name)}</span>${c.current ? '<span class="li-sub">You\'re here</span>' : ''}</span>
          ${c.current ? icon('check', 18) : icon('next', 18)}
        </button>`).join('') : '<p class="pad muted">Loading…</p>'}
      </div>
      <button class="btn ghost wide" data-new>${icon('plus', 16)} Start a new circle</button>
      <p class="hint">To join another family's circle, open the invite link they send you while signed in. It's added here.</p>
    </div>`;
  };
  paint(null);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', async (e) => {
    if (e.target === wrap || e.target.closest('[data-x]')) return close();
    if (e.target.closest('[data-new]')) { close(); return app.newCircle(); }
    const b = e.target.closest('[data-cid]');
    if (!b) return;
    close();
    if (b.dataset.cid !== app.state.cid) await app.switchCircle(b.dataset.cid);
  });
  try { paint(await listCircles(app)); }
  catch (e) { toast('Could not load your circles. Check your connection.'); }
}
