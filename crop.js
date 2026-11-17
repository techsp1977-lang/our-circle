// Pick a photo and crop it: drag to move, pinch or use the slider to zoom.
// Resolves with a square JPEG File, or null if cancelled. Used for profile photos only;
// album photos and videos are always kept as the untouched original.
import { esc, icon } from './ui.js';

export function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    input.addEventListener('change', () => { settled = true; const f = input.files[0] || null; input.remove(); resolve(f); });
    input.addEventListener('cancel', () => { if (!settled) { settled = true; input.remove(); resolve(null); } });
    input.click();
  });
}

export async function pickAndCrop(title = 'Move and zoom') {
  const file = await pickPhoto();
  if (!file) return null;
  return cropFile(file, title);
}

export function cropFile(file, title = 'Move and zoom') {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => open();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;

    function open() {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-wrap';
      wrap.innerHTML = `<div class="sheet crop-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Cancel">${icon('x')}</button></div>
        <p class="muted">Drag the photo to frame it. Pinch or use the slider to zoom.</p>
        <div class="crop-box" tabindex="0" aria-label="Photo crop area. Use arrow keys to move, plus and minus to zoom."><img alt="" draggable="false"></div>
        <label class="crop-zoom" for="cz">${icon('image', 14)}<input id="cz" type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">${icon('image', 20)}</label>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-x>Cancel</button><button type="button" class="btn" data-save>Use photo</button></div>
      </div>`;
      document.body.appendChild(wrap);
      const box = wrap.querySelector('.crop-box');
      const el = box.querySelector('img');
      const slider = wrap.querySelector('#cz');
      el.src = url;

      // state: scale relative to "cover", and offset of image centre from box centre (in box px)
      let zoom = 1, x = 0, y = 0;
      const size = () => box.clientWidth;
      const base = () => Math.max(size() / img.naturalWidth, size() / img.naturalHeight); // cover
      const clamp = () => {
        const s = base() * zoom, w = img.naturalWidth * s, h = img.naturalHeight * s, half = size() / 2;
        x = Math.min(w / 2 - half, Math.max(half - w / 2, x));
        y = Math.min(h / 2 - half, Math.max(half - h / 2, y));
      };
      const draw = () => {
        clamp();
        const s = base() * zoom;
        el.style.width = img.naturalWidth * s + 'px';
        el.style.height = img.naturalHeight * s + 'px';
        el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      };
      const setZoom = (z, cx = 0, cy = 0) => {
        const nz = Math.min(4, Math.max(1, z));
        // keep the point under the fingers still while zooming
        x = cx - (cx - x) * (nz / zoom); y = cy - (cy - y) * (nz / zoom);
        zoom = nz; slider.value = String(nz); draw();
      };

      const pts = new Map();
      let last = null, pinch = null;
      box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; pinch = null; });
      box.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size >= 2) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const r = box.getBoundingClientRect();
          const cx = (a.x + b.x) / 2 - r.left - r.width / 2, cy = (a.y + b.y) / 2 - r.top - r.height / 2;
          if (pinch) setZoom(pinch.zoom * (d / pinch.d), cx, cy); else pinch = { d, zoom };
          return;
        }
        if (last) { x += e.clientX - last.x; y += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; draw(); }
      });
      const up = (e) => { pts.delete(e.pointerId); pinch = null; last = pts.size ? [...pts.values()][0] : null; };
      box.addEventListener('pointerup', up);
      box.addEventListener('pointercancel', up);
      box.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 0.92)); }, { passive: false });
      box.addEventListener('keydown', (e) => {
        const k = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
        if (k) { x += k[0]; y += k[1]; draw(); e.preventDefault(); }
        if (e.key === '+' || e.key === '=') setZoom(zoom * 1.1);
        if (e.key === '-') setZoom(zoom / 1.1);
      });
      slider.addEventListener('input', () => setZoom(Number(slider.value)));
      requestAnimationFrame(draw);
      window.addEventListener('resize', draw);

      const close = (v) => { window.removeEventListener('resize', draw); wrap.remove(); URL.revokeObjectURL(url); resolve(v); };
      wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(null); });
      wrap.querySelector('[data-save]').addEventListener('click', () => {
        const out = 800;
        const s = base() * zoom;
        const sw = size() / s; // source square size in image px
        const sx = img.naturalWidth / 2 - (size() / 2 + x) / s;
        const sy = img.naturalHeight / 2 - (size() / 2 + y) / s;
        const c = document.createElement('canvas');
        c.width = out; c.height = out;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, sw, sw, 0, 0, out, out);
        c.toBlob((b) => close(b ? new File([b], 'photo.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.9);
      });
    }
  });
}
