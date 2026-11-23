// Small UI helpers shared by every screen.
import { shades, currentTheme } from './themes.js';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const icon = (name, size = 20) => {
  const p = {
    family: '<rect x="2" y="8" width="7" height="8" rx="1.5"/><rect x="15" y="2" width="7" height="6" rx="1.5"/><rect x="15" y="16" width="7" height="6" rx="1.5"/><path d="M9 12h3M12 5v14M12 5h3M12 19h3"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    album: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    cal: '<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
    cap: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  }[name] || '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
};

export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}

// Bottom sheet with a form. fields: [{name,label,type,value,options,placeholder,required,hint}]
// Resolves with the values, or null when cancelled.
export function sheet({ title, intro = '', fields = [], submit = 'Save', danger = null, body = '', cancel = '' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    const fieldHtml = fields.map((f, i) => {
      const id = 'f_' + f.name + '_' + i;
      const req = f.required ? 'required' : '';
      let input;
      if (f.type === 'select') {
        input = `<select id="${id}" name="${f.name}" ${req}>${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}" ${req}>${esc(f.value || '')}</textarea>`;
      } else if (f.type === 'checkbox') {
        return `<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? 'checked' : ''}> <span>${esc(f.label)}</span></label>`;
      } else if (f.type === 'swatches') {
        return `<fieldset class="swatches"><legend>${esc(f.label)}</legend>${f.options.map((o, j) => `<label class="swatch" for="${id}_${j}" style="--sw:${esc(o.color)}"><input type="radio" id="${id}_${j}" name="${f.name}" value="${esc(o.value)}" ${o.value === f.value ? 'checked' : ''}><span class="sw-dot" aria-hidden="true"></span><span class="sw-name">${esc(o.label)}</span></label>`).join('')}</fieldset>`;
      } else if (f.type === 'checks') {
        return `<fieldset class="checks"><legend>${esc(f.label)}</legend>${f.options.map((o, j) => `<label class="check" for="${id}_${j}"><input type="checkbox" id="${id}_${j}" name="${f.name}" value="${esc(o.value)}" ${(f.value || []).includes(o.value) ? 'checked' : ''}> <span>${esc(o.label)}</span></label>`).join('')}</fieldset>`;
      } else {
        input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${req} ${f.accept ? `accept="${f.accept}"` : ''} ${f.multiple ? 'multiple' : ''}>`;
      }
      return `<label class="field" for="${id}"><span>${esc(f.label)}</span>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
    }).join('');
    wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      ${intro ? `<p class="muted">${esc(intro)}</p>` : ''}${body}${fieldHtml}
      <div class="sheet-actions">${danger ? `<button type="button" class="btn ghost danger" data-danger>${esc(danger)}</button>` : cancel ? `<button type="button" class="btn ghost" data-x>${esc(cancel)}</button>` : '<span></span>'}<button class="btn" type="submit">${esc(submit)}</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(null); });
    wrap.querySelector('[data-danger]')?.addEventListener('click', () => close({ __danger: true }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      fields.forEach((f) => {
        if (f.type === 'checks') out[f.name] = $$(`input[name="${f.name}"]:checked`, form).map((x) => x.value);
        else if (f.type === 'checkbox') out[f.name] = form.elements[f.name].checked;
        else if (f.type === 'file') out[f.name] = [...form.elements[f.name].files];
        else out[f.name] = form.elements[f.name].value.trim();
      });
      close(out);
    });
    setTimeout(() => form.querySelector('input:not([type=checkbox]),textarea,select')?.focus(), 50);
  });
}

// A failure message with the reason's code on the end, so a screenshot says what went wrong.
export function why(text, err) {
  console.warn(text, err);
  const c = String(err?.code || err?.name || err?.message || 'unknown').replace(/^(storage|firestore|auth)\//, '').slice(0, 60);
  const hint = /unauthorized|permission/.test(c) ? ' The circle may have uploads paused, or you may not be in it on this account.'
    : /quota|retry-limit|network|unavailable/.test(c) ? ' Check your connection and try again.' : '';
  return `${text}${hint} (code: ${c})`;
}

export async function confirmBox(title, text, yes = 'Yes', danger = true) {
  const r = await sheet({ title, intro: text, submit: yes, fields: [] });
  return !!r;
}

// Photo tile: shows the picture if there is one, initials otherwise.
export function face(member, cls = '') {
  if (!member) return '';
  const ini = esc((member.name || '?').trim().charAt(0).toUpperCase());
  return member.photo
    // Photo boxes are square (like the cropper), so the photo fills the box without cutting off the face.
    ? `<span class="face ${cls}"><img class="face-pic" src="${esc(safeUrl(member.photo))}" alt="" loading="lazy"></span>`
    : `<span class="face ${cls}" data-ini="${ini}">${ini}</span>`;
}

// Only web addresses that can't run code are put into src/href. Family members can write any text into
// the database, so a "photo" saved as javascript:… or similar becomes a harmless blank instead.
// https: is real use; blob: and data:image/ are demo mode (files kept in this browser).
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  return /^(https:\/\/|blob:|data:image\/(png|jpeg|gif|webp|svg\+xml|heic|heif|avif)[;,])/i.test(s) ? s : '';
}
// 'image', 'video' or 'file', without trusting the saved type to be text.
export function mediaKind(m) {
  const t = String(m?.type ?? '');
  return t.startsWith('image') ? 'image' : t.startsWith('video') ? 'video' : 'file';
}

export const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');

export function listJoin(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return names.join(' & ');
  return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}

// Each household gets its own shade of green (picked in Family settings, or by position).
// Every shade carries white text at 4.5:1 or better.
// Household colors are shades of the circle's color (themes.js). HH_COLORS is the current circle's set.
export const HH_COLORS = { find: (fn) => shades(currentTheme()).find(fn), map: (fn) => shades(currentTheme()).map(fn) };
export function hhColor(h, index = 0) {
  const list = shades(currentTheme());
  const pick = list.find((c) => c.key === h?.color);
  const n = Math.trunc(Number(h?.order ?? index)) || 0;
  return (pick || list[((n % list.length) + list.length) % list.length]).value;
}

// Family tree order: each household, then the households under it (households.parentId), deepest last.
// Returns [{ h, depth }]. A household whose parent is missing, or that would loop back on itself, starts a new branch.
export function familyTree(households) {
  const byId = new Map(households.map((h) => [h.id, h]));
  const kids = new Map();
  const isRoot = (h) => !h.parentId || !byId.has(h.parentId) || h.parentId === h.id;
  const sort = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  households.forEach((h) => { if (h.parentId && byId.has(h.parentId) && h.parentId !== h.id) { if (!kids.has(h.parentId)) kids.set(h.parentId, []); kids.get(h.parentId).push(h); } });
  const out = [], done = new Set();
  const walk = (h, depth) => { if (done.has(h.id)) return; done.add(h.id); out.push({ h, depth }); (kids.get(h.id) || []).sort(sort).forEach((k) => walk(k, depth + 1)); };
  households.filter(isRoot).sort(sort).forEach((h) => walk(h, 0));
  households.slice().sort(sort).forEach((h) => walk(h, 0)); // anything caught in a loop
  return out;
}
// The households under this one (all generations), so a household can't be put under its own descendant.
export function descendantsOf(households, id) {
  const out = new Set(); let grew = true;
  while (grew) { grew = false; for (const h of households) if (h.parentId && (h.parentId === id || out.has(h.parentId)) && !out.has(h.id) && h.id !== id) { out.add(h.id); grew = true; } }
  return out;
}

// Keep each name whole on one line: "Ethan, Olivia & Henry" can wrap between names, never inside one,
// and "&" stays with the name after it.
export function names(label) {
  const parts = String(label ?? '').split(/(,\s*|\s+&\s+|\s+and\s+)/);
  return parts.map((p) => {
    if (/^,\s*$/.test(p)) return ', ';
    if (/^\s+(&|and)\s+$/.test(p)) return p.trim() === '&' ? ' &amp;\u00a0' : ' and\u00a0';
    return p ? `<span class="nw">${esc(p)}</span>` : '';
  }).join('');
}
