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
    // List the iPhone's own formats (HEIC photos, MOV/HEVC videos) so it hands them over as they are, instead of
    // converting each one first.
    input.accept = 'image/*,image/heic,image/heif,.heic,.heif,image/jpeg,image/png,video/*,video/quicktime,.mov,video/mp4,.mp4';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    const wait = document.createElement('div');
    wait.className = 'pick-wait';
    wait.setAttribute('role', 'status');
    wait.innerHTML = '<div class="pick-wait-card"><span class="spinner" aria-hidden="true"></span><b>Getting your photos from your library…</b><small>Your iPhone copies each photo first. Photos stored in iCloud download first, which can take a while.</small><button type="button" class="linkish" data-cancel>Cancel</button></div>';
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

// Read a photo already shrunk to about `max` pixels wide while it's decoded (keeping its rotation), so a phone
// never holds dozens of full-size 12-megapixel photos in memory at once. Falls back to a full read where a browser
// can't shrink while reading.
async function decode(file, max) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: max, resizeQuality: 'high' }); } catch (e) { /* below */ }
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* below */ }
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
  return new Promise((res) => c.toBlob((b) => { c.width = c.height = 0; res(b); }, 'image/jpeg', quality));
}
export async function variants(file) {
  if (!String(file.type).startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return null;
  const src = await decode(file, DISPLAY_PX);
  if (!src) return null;
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  if (!w || !h) { src.close?.(); return null; }
  const display = await shrink(src, w, h, DISPLAY_PX, 0.84), thumb = await shrink(src, w, h, THUMB_PX, 0.78);
  src.close?.();
  return display && thumb ? { display, thumb, w, h } : null;
}

// Start uploading right away, three at a time, while you're still adding a title. Each item reports its
// own progress. Items can be added or removed, or the whole batch cancelled: anything already uploaded is
// deleted again (you're allowed to delete files you uploaded). onChange() is called whenever anything moves.
export function startBatch(app, files, onChange) {
  const uid = app.state.uid;
  const jobs = [];
  let running = 0, cancelled = false, lock = null;
  const doneHooks = new Set();
  const changed = () => { onChange?.(); awake(); };
  // Keep the screen on while uploading (a locked iPhone pauses uploads); let it sleep again when done.
  const awake = async () => {
    const busy = jobs.some((j) => j.status === 'waiting' || j.status === 'uploading');
    try {
      if (busy && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener?.('release', () => { lock = null; }); }
      else if (!busy && lock) { const l = lock; lock = null; await l.release(); }
    } catch (e) { lock = null; }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') awake(); });
  const add = (more) => {
    for (const f of more) if (jobs.filter((j) => j.status !== 'removed').length < MAX_PICK) jobs.push({ file: f, status: 'waiting', progress: 0, tasks: [], paths: [], rec: null, prep: null, preview: null });
    prepare(); pump(); changed();
  };
  // Make each photo's small copies one at a time, in the order picked (they double as the previews you see).
  // Every photo gets its turn in this line; an upload waits for its own photo's copies.
  let line = Promise.resolve();
  const prepOf = (job) => {
    if (!job.prep) {
      job.prep = line = line.then(() => (job.status === 'removed' ? null : variants(job.file).catch(() => null))).then((v) => {
        if (v) job.preview = URL.createObjectURL(v.thumb);
        changed();
        return v;
      });
    }
    return job.prep;
  };
  const prepare = () => { jobs.forEach((j) => { if (!cancelled && j.status !== 'removed') prepOf(j); }); };
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
    job.tasks = []; job.paths = []; job.progress = 0;
    const up = (path, blob, from, to) => {
      job.paths.push(path);
      return S.upload(path, blob, (p) => { job.progress = from + p * (to - from); changed(); }, { by: uid, onTask: (t) => job.tasks.push(t) });
    };
    try {
      const v = await prepOf(job);
      if (job.status === 'removed') return;
      const rec = { type: f.type || 'application/octet-stream', name: f.name || safe, size: f.size || 0 };
      // The small copies first (seconds), then the full-quality original.
      if (v) {
        const [display, thumb] = await Promise.all([up(`${base}.display.jpg`, v.display, 0, 0.06), up(`${base}.thumb.jpg`, v.thumb, 0.06, 0.08)]);
        Object.assign(rec, { display, thumb, w: v.w, h: v.h });
      }
      rec.url = await up(base, f, v ? 0.08 : 0, 1);
      if (job.status === 'removed') return forget(job);
      job.rec = rec; job.progress = 1; job.status = 'done';
      doneHooks.forEach((fn) => { try { fn(job); } catch (e) {} });
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
    // Try the ones that didn't make it again.
    retry() { jobs.forEach((j) => { if (j.status === 'failed') { forget(j); j.status = 'waiting'; j.progress = 0; } }); pump(); changed(); },
    // Called with each item the moment it finishes (so it can be saved to the album right away).
    onDone(fn) { doneHooks.add(fn); jobs.filter((j) => j.status === 'done').forEach((j) => fn(j)); },
    live: () => jobs.filter((j) => j.status !== 'removed'),
    progress() {
      const l = batch.live();
      return { done: l.filter((j) => j.status === 'done' || j.status === 'failed').length, ok: l.filter((j) => j.status === 'done').length, failed: l.filter((j) => j.status === 'failed').length, total: l.length, frac: l.length ? l.reduce((a, j) => a + (j.status === 'failed' ? 1 : j.progress), 0) / l.length : 1 };
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
    release() { jobs.forEach((j) => { if (j.preview) URL.revokeObjectURL(j.preview); }); },
  };
  add(files);
  return batch;
}

// A progress card that stays on screen while uploading. Photos are saved to the album as each one finishes, so
// you can keep using Our Circle (just keep it open). At the end it says how it went, with Try again if needed.
export function progressCard(onRetry) {
  const el = document.createElement('div');
  el.className = 'upload-card';
  el.setAttribute('role', 'status');
  el.innerHTML = '<b>Getting your photos ready…</b><span class="progress"><i style="width:0%"></i></span><small>Each photo is saved to the album as soon as it finishes. Keep Our Circle open until this is done.</small><span class="upload-btns"></span>';
  document.body.appendChild(el);
  const btns = el.querySelector('.upload-btns');
  btns.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) onRetry?.(); if (e.target.closest('[data-close]')) el.remove(); });
  return {
    set({ frac, done, ok, failed, total }) {
      const left = total - done;
      el.querySelector('b').textContent = left > 0 ? `Uploading ${Math.min(done + 1, total)} of ${total}… ${ok ? `${ok} saved` : ''}` : failed ? `${ok} of ${total} saved. ${failed} didn't upload.` : `All ${total} saved to the album.`;
      el.querySelector('i').style.width = Math.round(frac * 100) + '%';
      el.querySelector('small').hidden = left <= 0;
      btns.innerHTML = left <= 0 && failed ? '<button class="btn sm" data-retry>Try again</button><button class="btn sm ghost" data-close>Close</button>' : '';
      el.classList.toggle('finished', left <= 0);
    },
    close() { el.remove(); },
  };
}
