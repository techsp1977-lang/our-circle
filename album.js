// Family album: posts of photos and videos shared with everyone. Originals are kept untouched for
// "Download original"; the album itself shows quick-loading previews.
import * as S from './store.js';
import { esc, icon, sheet, toast, fmtSize, confirmBox, safeUrl, mediaKind } from './ui.js';
import { shortDate, toISO } from './dates.js';
import { pickMedia, startBatch, progressCard, MAX_PICK } from './photos.js';
import { pausedText } from './plans.js';

export function mount(root, app, key, args) {
  return args[0] ? post(root, app, args[0]) : grid(root, app);
}

const small = (m) => safeUrl(m.thumb || m.display || m.url);
const big = (m) => safeUrl(m.display || m.url);

function tile(m, cls = 'cover') {
  if (!m) return `<span class="${cls} empty">${icon('image', 28)}</span>`;
  if (mediaKind(m) === 'video') return `<span class="${cls}"><video src="${esc(safeUrl(m.url))}#t=0.5" muted playsinline preload="metadata"></video><i class="play" aria-hidden="true">▶</i></span>`;
  return `<span class="${cls}"><img src="${esc(small(m))}" alt="" loading="lazy" decoding="async"${m.w ? ` width="${+m.w}" height="${+m.h}"` : ''}></span>`;
}

function grid(root, app) {
  const st = app.state;
  let posts = [];
  const render = () => {
    root.innerHTML = `
      <header class="top"><div><div class="eyebrow">${esc(st.circle?.name || '')}</div><h1 class="display">Family Album</h1></div>
        <button class="btn sm" data-act="share">${icon('plus', 16)} Share</button></header>
      <p class="hint pad-x">Photos and videos shared here go to the whole family. Originals are kept at full quality.</p>
      <section class="block album-grid">
        ${posts.map((p) => `<a class="album-card" href="#/album/${encodeURIComponent(p.id)}">
          ${tile(p.media?.[0])}
          <span class="album-meta"><b>${esc(p.title || 'Untitled')}</b><small>${(p.media || []).length} item${(p.media || []).length === 1 ? '' : 's'} · ${esc(app.member(p.by)?.name || '')} · ${shortDate(toISO(new Date(p.at)))}</small></span>
        </a>`).join('') || `<button class="card empty-card" data-act="share">Share the first photos, like a birthday party or a trip.</button>`}
      </section>`;
  };
  const onClick = (e) => { if (e.target.closest('[data-act="share"]')) sharePhotos(app); };
  root.addEventListener('click', onClick);
  const unsub = S.watchColl(app.path('album'), { orderBy: ['at', 'desc'] }, (rows) => { posts = rows; render(); });
  const off = app.on(render);
  render();
  return { destroy: () => { unsub(); off(); root.removeEventListener('click', onClick); } };
}

// After picking: the photos are already uploading. Previews of everything chosen (each with its own progress),
// remove any or pick more, and add a title and caption while it works. Resolves with { title, caption } or null.
function compose(batch, setListener, { title = '', withTitle = true } = {}) {
  return new Promise((resolve) => {
    const urls = new Map();
    const urlOf = (j) => { if (!urls.has(j)) urls.set(j, URL.createObjectURL(j.file)); return urls.get(j); };
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap compose-sheet';
    wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="Share with the family">
      <div class="sheet-head"><h2 id="ch"></h2><button type="button" class="icon-btn" data-x aria-label="Cancel">${icon('x')}</button></div>
      <p class="muted small" id="cs" aria-live="polite"></p>
      <div class="pick-grid" id="pg"></div>
      ${withTitle ? `<label class="field" for="ct"><span>What is it?</span><input id="ct" required placeholder="Grace's birthday party" value="${esc(title)}"></label>
      <label class="field" for="cc"><span>Caption (optional)</span><textarea id="cc" rows="2"></textarea></label>` : ''}
      <div class="sheet-actions"><span></span><button class="btn" type="submit" id="go"></button></div>
    </form>`;
    const grid = wrap.querySelector('#pg');
    let shown = [];
    const paintGrid = () => {
      shown = batch.live();
      grid.innerHTML = shown.map((j, i) => `<span class="pick" data-i="${i}">
          ${String(j.file.type).startsWith('video') ? `<video src="${urlOf(j)}#t=0.3" muted playsinline preload="metadata"></video><i class="play" aria-hidden="true">▶</i>` : `<img src="${urlOf(j)}" alt="" decoding="async">`}
          <span class="pick-bar" aria-hidden="true"><i></i></span><span class="pick-ok" aria-hidden="true">${icon('check', 14)}</span><span class="pick-bad" aria-hidden="true">!</span>
          <button type="button" class="pick-x" data-rm="${i}" aria-label="Remove ${esc(j.file.name || 'this one')}">${icon('x', 14)}</button></span>`).join('')
        + `<button type="button" class="pick add" data-more aria-label="Pick more">${icon('plus', 22)}</button>`;
    };
    const update = () => {
      if (batch.live().length !== shown.length) paintGrid();
      grid.querySelectorAll('.pick[data-i]').forEach((el) => {
        const j = shown[+el.dataset.i];
        el.querySelector('.pick-bar i').style.width = Math.round(j.progress * 100) + '%';
        el.classList.toggle('done', j.status === 'done');
        el.classList.toggle('failed', j.status === 'failed');
      });
      const p = batch.progress();
      wrap.querySelector('#ch').textContent = `${p.total} ${p.total === 1 ? 'item' : 'items'}`;
      wrap.querySelector('#cs').textContent = !p.total ? 'Nothing picked.' : p.done >= p.total ? 'All uploaded. Add a title and share.' : `Uploading now (${p.done} of ${p.total} done). You can add a title while it works.`;
      const go = wrap.querySelector('#go');
      go.textContent = `${withTitle ? 'Share' : 'Add'} ${p.total}`;
      go.disabled = !p.total;
    };
    const finish = (v) => { setListener(null); urls.forEach((u) => URL.revokeObjectURL(u)); wrap.remove(); resolve(v); };
    paintGrid(); update();
    setListener(update);
    document.body.appendChild(wrap);
    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap || e.target.closest('[data-x]')) { batch.cancel(); return finish(null); }
      const rm = e.target.closest('[data-rm]');
      if (rm) return batch.remove(shown[+rm.dataset.rm]);
      if (e.target.closest('[data-more]')) { const more = await pickMedia(); if (more.length) batch.add(more); }
    });
    wrap.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!batch.live().length) return;
      finish({ title: wrap.querySelector('#ct')?.value.trim() || title, caption: wrap.querySelector('#cc')?.value.trim() || '' });
    });
  });
}

// Pick, upload straight away while the person adds a title, then wait for anything still going.
async function pickAndUpload(app, opts) {
  if (app.state.circle?.paused) { toast(pausedText(app.state.circle, app.isAdmin()), 9000); return null; }
  const picked = await pickMedia();
  if (!picked.length) return null;
  let listener = null;
  const batch = startBatch(app, picked, () => listener?.());
  const r = await compose(batch, (fn) => { listener = fn; }, opts);
  if (!r) return null;
  const card = progressCard();
  const tick = () => { const p = batch.progress(); card.set(p.frac, p.done, p.total); };
  listener = tick; tick();
  try { return { ...r, ...(await batch.finished()) }; } finally { listener = null; card.close(); }
}
const failedNote = (failed) => (failed.length ? ` ${failed.length} didn't upload (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}). Try those again with Add more.` : '');

async function sharePhotos(app) {
  const r = await pickAndUpload(app);
  if (!r) return;
  if (!r.media.length) { toast('Nothing uploaded. Check your connection and try again.', 6000); return; }
  try {
    const id = await S.add(app.path('album'), { title: r.title, caption: r.caption, by: app.state.me, at: Date.now(), media: r.media });
    toast(`Shared ${r.media.length} with the family.${failedNote(r.failed)}`, r.failed.length ? 9000 : 3000);
    app.go('#/album/' + encodeURIComponent(id));
  } catch (e) { console.error(e); toast('The album could not be saved. Check your connection and try again.'); }
}

function post(root, app, id) {
  const st = app.state;
  let p = null;
  const render = () => {
    if (!p) { root.innerHTML = '<p class="pad muted">Loading…</p>'; return; }
    const can = p.by === st.me || app.isAdmin();
    const items = p.media || [];
    root.innerHTML = `
      <header class="top"><a class="icon-btn" href="#/album" data-back="#/album" aria-label="Back">${icon('back')}</a>
        <div class="grow"><h1 class="h1">${esc(p.title)}</h1><div class="muted small">${esc(app.member(p.by)?.name || '')} · ${shortDate(toISO(new Date(p.at)))} · ${items.length} item${items.length === 1 ? '' : 's'}</div></div>
        ${can ? `<button class="icon-btn" data-act="edit" aria-label="Edit">${icon('edit')}</button>` : ''}</header>
      ${p.caption ? `<p class="pad-x">${esc(p.caption)}</p>` : ''}
      <section class="block photo-wall">
        ${items.map((m, i) => `<button class="wall-item" data-open="${i}" aria-label="Open ${mediaKind(m) === 'video' ? 'video' : 'photo'} ${i + 1} of ${items.length}">${tile(m, 'wall-img')}</button>`).join('')}
      </section>
      <section class="block"><button class="btn ghost wide" data-act="add">${icon('plus', 16)} Add more</button></section>`;
  };
  const onClick = async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return viewer(p.media || [], +open.dataset.open);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'edit') {
      const r = await sheet({ title: 'Edit album', danger: 'Delete album', fields: [
        { name: 'title', label: 'Title', value: p.title, required: true },
        { name: 'caption', label: 'Caption', type: 'textarea', rows: 2, value: p.caption || '' },
      ] });
      if (!r) return;
      if (r.__danger) {
        if (await confirmBox('Delete this album?', 'It will be removed for everyone.', 'Delete')) { await S.del(app.path('album/' + id)); app.go('#/album'); }
        return;
      }
      await S.update(app.path('album/' + id), { title: r.title, caption: r.caption });
    }
    if (b.dataset.act === 'add') {
      const r = await pickAndUpload(app, { title: p.title, withTitle: false });
      if (!r) return;
      if (!r.media.length) { toast('Nothing uploaded. Check your connection and try again.', 6000); return; }
      try {
        await S.update(app.path('album/' + id), { media: [...(p.media || []), ...r.media] });
        toast(`Added ${r.media.length}.${failedNote(r.failed)}`, r.failed.length ? 9000 : 3000);
      } catch (er) { toast('The album could not be updated. Try again.'); }
    }
  };
  root.addEventListener('click', onClick);
  const unsub = S.watchDoc(app.path('album/' + id), (d) => { p = d; render(); });
  render();
  return { destroy: () => { unsub(); root.removeEventListener('click', onClick); document.querySelector('.viewer')?.remove(); } };
}

// Full-screen viewer: swipe or use arrows to move through the album; download the original.
function viewer(items, start) {
  let i = start;
  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const paint = () => {
    const m = items[i];
    el.innerHTML = `
      <div class="viewer-top"><span>${i + 1} of ${items.length}</span>
        <a class="viewer-dl" href="${esc(safeUrl(m.url))}" download="${esc(m.name || 'photo')}" target="_blank" rel="noopener">${icon('download', 16)} Original · ${fmtSize(m.size || 0)}</a>
        <button class="viewer-btn" data-close aria-label="Close">${icon('x', 22)}</button></div>
      <div class="viewer-stage">${mediaKind(m) === 'video'
        ? `<video src="${esc(safeUrl(m.url))}" controls playsinline autoplay></video>`
        : `<img src="${esc(big(m))}" alt="Photo ${i + 1} of ${items.length}">`}</div>
      ${i > 0 ? `<button class="viewer-btn prev" data-go="-1" aria-label="Previous">${icon('back', 24)}</button>` : ''}
      ${i < items.length - 1 ? `<button class="viewer-btn next" data-go="1" aria-label="Next">${icon('next', 24)}</button>` : ''}`;
    // Fetch the neighbours' screen-size copies so swiping feels instant.
    [items[i - 1], items[i + 1]].forEach((n) => { if (n && mediaKind(n) !== 'video') new Image().src = big(n); });
  };
  const go = (d) => { const n = i + d; if (n < 0 || n >= items.length) return; i = n; paint(); };
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    const g = e.target.closest('[data-go]'); if (g) go(+g.dataset.go);
  });
  let x0 = null, y0 = 0;
  el.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close(); // swipe down to close
  });
  document.addEventListener('keydown', onKey);
  paint();
  document.body.appendChild(el);
}
