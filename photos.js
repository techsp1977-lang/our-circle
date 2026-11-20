// Picking and uploading photos and videos for the album.
// Originals are uploaded untouched (for "Download original"). For photos, the phone also makes a
// screen-sized copy and a small preview, so the album loads quickly without downloading every original.
import * as S from './store.js';

export const MAX_PICK = 200;
const DISPLAY_PX = 1600, THUMB_PX = 480;

// Open the phone's photo library (must be called straight from a tap). Resolves with the chosen files, or [].
export function pickMedia() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const done = (files) => { if (settled) return; settled = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => done([...(input.files || [])]));
    input.addEventListener('cancel', () => done([]));
    input.click();
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

// Upload files three at a time. onProgress(fraction, finished, total). Resolves { media, failed }:
// media records in the order picked, and the names of any that didn't upload (the rest still do).
export async function uploadMedia(app, files, onProgress) {
  const total = files.length;
  const sizes = files.map((f) => (f.size || 1) * 1.15);
  const sent = files.map(() => 0);
  const all = sizes.reduce((a, b) => a + b, 0);
  let finished = 0;
  const tick = () => onProgress?.(Math.min(1, sent.reduce((a, b) => a + b, 0) / all), finished, total);
  const one = async (f, i) => {
    const id = S.newId();
    const safe = (f.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
    const base = app.path(`media/${id}_${safe}`);
    const v = await variants(f).catch(() => null);
    const up = (path, blob, share) => S.upload(path, blob, (p) => { sent[i] = Math.max(sent[i], p * share * sizes[i]); tick(); });
    const url = await up(base, f, v ? 1 : 1.15);
    const rec = { url, type: f.type || 'application/octet-stream', name: f.name || safe, size: f.size || 0 };
    if (v) {
      const [display, thumb] = await Promise.all([up(`${base}.display.jpg`, v.display, 0.1), up(`${base}.thumb.jpg`, v.thumb, 0.05)]);
      Object.assign(rec, { display, thumb, w: v.w, h: v.h });
    }
    sent[i] = sizes[i]; finished++; tick();
    return rec;
  };
  const results = new Array(total);
  let next = 0;
  const worker = async () => {
    while (next < total) {
      const i = next++;
      // Firebase already retries a shaky connection for up to a minute before giving up on a file.
      try { results[i] = await one(files[i], i); }
      catch (e) { console.warn('upload failed', files[i].name, e); results[i] = { failed: files[i].name || 'a file' }; sent[i] = sizes[i]; finished++; tick(); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { media: results.filter((r) => r && !r.failed), failed: results.filter((r) => r?.failed).map((r) => r.failed) };
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
      el.querySelector('b').textContent = `Uploading ${Math.min(finished + 1, total)} of ${total}…`;
      el.querySelector('i').style.width = Math.round(frac * 100) + '%';
    },
    close() { el.remove(); },
  };
}
