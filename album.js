// Family album: posts of photos and videos shared with everyone, kept at original quality.
import * as S from '../store.js';
import { esc, icon, sheet, toast, fmtSize, confirmBox } from '../ui.js';
import { shortDate, toISO } from '../dates.js';

export function mount(root, app, key, args) {
  return args[0] ? post(root, app, args[0]) : grid(root, app);
}

function cover(m) {
  if (!m) return `<span class="cover empty">${icon('image', 28)}</span>`;
  if (m.type.startsWith('video')) return `<span class="cover"><video src="${esc(m.url)}#t=0.5" muted playsinline preload="metadata"></video><i class="play">▶</i></span>`;
  return `<span class="cover"><img src="${esc(m.url)}" alt="" loading="lazy"></span>`;
}

function grid(root, app) {
  const st = app.state;
  let posts = [];
  const render = () => {
    root.innerHTML = `
      <header class="top"><div><div class="eyebrow">${esc(st.circle?.name || '')}</div><h1 class="display">Family Album</h1></div>
        <button class="btn sm" data-act="share">${icon('plus', 16)} Share</button></header>
      <p class="hint pad-x">Photos and videos shared here go to the whole family and stay at full original quality.</p>
      <section class="block album-grid">
        ${posts.map((p) => `<a class="album-card" href="#/album/${p.id}">
          ${cover(p.media?.[0])}
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

async function sharePhotos(app) {
  const r = await sheet({
    title: 'Share with the family',
    submit: 'Share',
    fields: [
      { name: 'title', label: 'What is it?', placeholder: "Leah's birthday party", required: true },
      { name: 'files', label: 'Photos and videos', type: 'file', accept: 'image/*,video/*', multiple: true, hint: 'Originals are uploaded. Nothing is shrunk.' },
      { name: 'caption', label: 'Caption (optional)', type: 'textarea', rows: 2 },
    ],
  });
  if (!r || !r.files?.length) { if (r) toast('Pick at least one photo or video.'); return; }
  toast('Uploading originals…', 60000);
  try {
    const media = await app.uploadFiles(r.files, (p) => toast(`Uploading originals… ${Math.round(p * 100)}%`, 60000));
    const id = await S.add(app.path('album'), { title: r.title, caption: r.caption, by: app.state.me, at: Date.now(), media });
    toast('Shared with the family.');
    app.go('#/album/' + id);
  } catch (e) { console.error(e); toast('Upload stopped. Check your connection and try again.'); }
}

function post(root, app, id) {
  const st = app.state;
  let p = null;
  const render = () => {
    if (!p) { root.innerHTML = '<p class="pad muted">Loading…</p>'; return; }
    const can = p.by === st.me || app.isAdmin();
    root.innerHTML = `
      <header class="top"><a class="icon-btn" href="#/album" aria-label="Back to album">${icon('back')}</a>
        <div class="grow"><h1 class="h1">${esc(p.title)}</h1><div class="muted small">${esc(app.member(p.by)?.name || '')} · ${shortDate(toISO(new Date(p.at)))}</div></div>
        ${can ? `<button class="icon-btn" data-act="edit" aria-label="Edit">${icon('edit')}</button>` : ''}</header>
      ${p.caption ? `<p class="pad-x">${esc(p.caption)}</p>` : ''}
      <section class="block stack-sm">
        ${(p.media || []).map((m) => `<figure class="full">
          ${m.type.startsWith('video') ? `<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="${esc(m.name)}" loading="lazy">`}
          <figcaption><a class="dl" href="${esc(m.url)}" download="${esc(m.name)}" target="_blank" rel="noopener">${icon('download', 14)} Download original · ${fmtSize(m.size)}</a></figcaption>
        </figure>`).join('')}
        <button class="btn ghost" data-act="add">${icon('plus', 16)} Add more</button>
      </section>`;
  };
  const onClick = async (e) => {
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
      const r = await sheet({ title: 'Add photos or videos', submit: 'Upload', fields: [{ name: 'files', label: 'Photos and videos', type: 'file', accept: 'image/*,video/*', multiple: true }] });
      if (!r || !r.files?.length) return;
      try {
        const media = await app.uploadFiles(r.files, (x) => toast(`Uploading originals… ${Math.round(x * 100)}%`, 60000));
        await S.update(app.path('album/' + id), { media: [...(p.media || []), ...media] });
        toast('Added.');
      } catch (er) { toast('Upload stopped. Try again.'); }
    }
  };
  root.addEventListener('click', onClick);
  const unsub = S.watchDoc(app.path('album/' + id), (d) => { p = d; render(); });
  render();
  return { destroy: () => { unsub(); root.removeEventListener('click', onClick); } };
}
