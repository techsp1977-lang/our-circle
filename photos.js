// Picking and uploading photos and videos for the album.
// Originals are uploaded untouched (for "Download original"). For photos, the phone also makes a
// screen-sized copy and a small preview, so the album loads quickly without downloading every original.
import * as S from './store.js';

export const MAX_PICK = 200;
const DISPLAY_PX = 1600, THUMB_PX = 480;

// Open the phone's photo library (must be called straight from a tap). Resolves with the chosen files, or [].
// After you tap Add, the iPhone takes a few seconds to hand the photos over; a card saying so sits behind the
// picker, so the screen never looks frozen. Accepting Apple's own photo format (HEIC) lets the iPhone skip
// converting every photo first, which is most of that wait.
export function pickMedia() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,image/heic,image/heif,.heic,.heif,video/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    const wait = document.createElement('div');
    wait.className = 'pick-wait';
    wait.setAttribute('role', 'status');
    wait.innerHTML = '<div class="pick-wait-card"><span class="spinner" aria-hidden="true"></span><b>Getting your photos from your library…</b><small>With lots of photos this takes a few seconds.</small><button type="button" class="linkish" data-cancel>Cancel</button></div>';
    let settled = false;
    const done = (files) => { if (settled) return; settled = true; input.remove(); wait.remove(); resolve(files); };
    wait.querySelector('[data-cancel]').onclick = () => done([]);
    input.addEventListener('change', () => done([...(input.files || [])]));
    input.addEventListener('cancel', () => done([]));
    input.click();
    // Shown just after the picker opens, so it's what you see the moment the picker closes.
    setTimeout(() => { if (!settled) document.body.appendChild(wait); }, 400);
  });
}

// Draw a photo smaller (keeping its rotation) and return a JPEG, or null if this browser can't read it.
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back below */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch (e) { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function shrink(src, w, h, max, quality) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', quality));
}
export async function variants(file) {
  if (!String(file.type).startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return null;
  const src = await decode(file);
  if (!src) return null;
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  if (!w || !h) return null;
  const [display, thumb] = [await shrink(src, w, h, DISPLAY_PX, 0.84), await shrink(src, w, h, THUMB_PX, 0.78)];
  src.close?.();
  return display && thumb ? { display, thumb, w, h } : null;
}

// Start uploading right away, three at a time, while you're still adding a title. Each item reports its
// own progress. Items can be added or removed, or the whole batch cancelled: anything already uploaded is
// deleted again (you're allowed to delete files you uploaded). onChange() is called whenever anything moves.
export function startBatch(app, files, onChange) {
  const uid = app.state.uid;
  const jobs = [];
  let running = 0, cancelled = false;
  const changed = () => onChange?.();
  const add = (more) => {
    for (const f of more) if (jobs.filter((j) => j.status !== 'removed').length < MAX_PICK) jobs.push({ file: f, status: 'waiting', progress: 0, tasks: [], paths: [], rec: null });
    pump(); changed();
  };
  const pump = () => {
    while (!cancelled && running < 3) {
      const job = jobs.find((j) => j.status === 'waiting');
      if (!job) return;
      running++; job.status = 'uploading';
      run(job).finally(() => { running--; pump(); changed(); });
    }
  };
  const run = async (job) => {
    const f = job.file;
    const id = S.newId();
    const safe = (f.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
    const base = app.path(`media/${id}_${safe}`);
    const up = (path, blob, from, to) => {
      job.paths.push(path);
      return S.upload(path, blob, (p) => { job.progress = from + p * (to - from); changed(); }, { by: uid, onTask: (t) => job.tasks.push(t) });
    };
    try {
      const v = await variants(f).catch(() => null);
      if (job.status === 'removed') return;
      const url = await up(base, f, 0, v ? 0.9 : 1);
      const rec = { url, type: f.type || 'application/octet-stream', name: f.name || safe, size: f.size || 0 };
      if (v) {
        const [display, thumb] = await Promise.all([up(`${base}.display.jpg`, v.display, 0.9, 0.97), up(`${base}.thumb.jpg`, v.thumb, 0.97, 1)]);
        Object.assign(rec, { display, thumb, w: v.w, h: v.h });
      }
      if (job.status === 'removed') return forget(job);
      job.rec = rec; job.progress = 1; job.status = 'done';
    } catch (e) {
      if (job.status === 'removed') return;
      console.warn('upload failed', f.name, e);
      job.status = 'failed';
    }
  };
  const forget = (job) => {
    job.tasks.forEach((t) => { try { t.cancel(); } catch (e) {} });
    job.paths.forEach((p) => S.removeFile(p).catch(() => {}));
  };
  const batch = {
    jobs,
    add,
    remove(job) { if (job.status === 'removed') return; job.status = 'removed'; forget(job); pump(); changed(); },
    cancel() { cancelled = true; jobs.forEach((j) => { if (j.status !== 'removed') { j.status = 'removed'; forget(j); } }); changed(); },
    live: () => jobs.filter((j) => j.status !== 'removed'),
    progress() {
      const l = batch.live();
      return { done: l.filter((j) => j.status === 'done' || j.status === 'failed').length, total: l.length, frac: l.length ? l.reduce((a, j) => a + (j.status === 'failed' ? 1 : j.progress), 0) / l.length : 1 };
    },
    // Resolves once everything still in the batch has finished: { media, failed } in the order picked.
    finished() {
      return new Promise((resolve) => {
        const check = () => {
          const l = batch.live();
          if (l.every((j) => j.status === 'done' || j.status === 'failed')) {
            resolve({ media: l.filter((j) => j.status === 'done').map((j) => j.rec), failed: l.filter((j) => j.status === 'failed').map((j) => j.file.name || 'a file') });
          } else setTimeout(check, 250);
        };
        check();
      });
    },
  };
  add(files);
  return batch;
}

// A progress card that stays on screen while uploading.
export function progressCard() {
  const el = document.createElement('div');
  el.className = 'upload-card';
  el.setAttribute('role', 'status');
  el.innerHTML = '<b>Getting your photos ready…</b><span class="progress"><i style="width:0%"></i></span><small>Keep Our Circle open until this finishes.</small>';
  document.body.appendChild(el);
  return {
    set(frac, finished, total) {
      el.querySelector('b').textContent = finished >= total ? 'Saving the album…' : `Uploading ${Math.min(finished + 1, total)} of ${total}…`;
      el.querySelector('i').style.width = Math.round(frac * 100) + '%';
    },
    close() { el.remove(); },
  };
}
