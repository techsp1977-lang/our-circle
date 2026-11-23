// The family as circles: every household is a round "liquid" bubble holding each person's round photo and name,
// laid out like a family tree (the head of the circle at the top, each generation below the one it came from).
// Pinch (or the − + buttons) to zoom, drag sideways to look around. A bubble celebrates on a birthday,
// an anniversary or another big day, and welcomes a new baby, with its own animation.
import { esc, icon, face, names, hhColor, familyTree } from './ui.js';
import { happeningToday } from './events.js';
import { today, diffDays } from './dates.js';
import { checkin } from './hub.js';

const GAP_X = 22, GAP_Y = 46, LABEL_H = 50, SHELF = 560;
const views = new Map(); // remembered zoom and position, per circle

// How big a bubble is, and how big the photos inside it are: photos fill as much of the circle as they can
// (fewer people, bigger photos), with each name under its photo.
function spec(n) {
  n = Math.max(1, n);
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const a = n === 1 ? 78 : n === 2 ? 64 : n <= 4 ? 58 : n <= 6 ? 52 : n <= 9 ? 46 : 42;
  const rows = Math.ceil(n / cols), gw = cols * (a + 6), gh = rows * (a + 20);
  return { a, cols, d: Math.round(Math.max(118, Math.hypot(gw, gh) * 0.92 + 12)) };
}

// Today's reason to celebrate each household: { hid: { kind, text } }.
function celebrations(app) {
  const out = {};
  const t = today();
  const put = (hid, kind, text) => { if (hid && !out[hid]) out[hid] = { kind, text }; };
  for (const ev of happeningToday(app)) {
    const kind = ev.type === 'birthday' ? 'bday' : ev.type === 'anniversary' ? 'anniv' : ['trip', 'event'].includes(ev.type) ? null : 'big';
    if (!kind) continue;
    const ppl = (ev.memberIds || []).map((id) => app.member(id)).filter(Boolean);
    const who = ppl.map((m) => m.name).join(' & ');
    const text = kind === 'bday' ? `🎂 ${who}'s birthday` : kind === 'anniv' ? `💕 ${who}'s anniversary` : `🎉 ${ev.title}`;
    ppl.forEach((m) => put(m.householdId, kind, text));
  }
  // A new baby: someone whose birthday was in the last 60 days.
  for (const ev of app.state.events) {
    if (ev.type !== 'birthday' || !ev.date || ev.date > t) continue;
    const age = diffDays(ev.date, t);
    if (age < 0 || age > 60) continue;
    (ev.memberIds || []).map((id) => app.member(id)).filter(Boolean).forEach((m) => put(m.householdId, 'new', `👶 Welcome, ${m.name}!`));
  }
  return out;
}

// Positions: each branch as a tree (a parent's children below it; more than three children who have no
// households under them wrap onto rows of three, so the tree stays narrow enough for a phone). Separate branches
// are packed side by side onto shelves, so a family that isn't arranged into a tree yet still fits.
function layout(app) {
  const st = app.state;
  const rows = familyTree(st.households);
  const node = new Map(rows.map(({ h, depth }) => [h.id, { h, depth, ...spec(app.membersOf(h.id).length), kids: [] }]));
  const roots = [];
  rows.forEach(({ h }) => { const n = node.get(h.id); const p = h.parentId && node.get(h.parentId); if (p && p !== n && n.depth > p.depth) p.kids.push(n); else roots.push(n); });
  const rowsOf = (n) => {
    if (!n.kids.length) return [];
    const wrap = n.kids.length > 3 && n.kids.every((k) => !k.kids.length);
    const out = [];
    for (let i = 0; i < n.kids.length; i += wrap ? 3 : n.kids.length) out.push(n.kids.slice(i, i + (wrap ? 3 : n.kids.length)));
    return out;
  };
  const rowW = (r) => r.reduce((a, k) => a + k.w, 0) + GAP_X * (r.length - 1);
  const rowH = (r) => Math.max(...r.map((k) => k.ht));
  const measure = (n) => {
    n.kids.forEach(measure);
    n.rows = rowsOf(n);
    n.w = Math.max(n.d + 50, ...n.rows.map(rowW));
    n.ht = n.d + LABEL_H + n.rows.reduce((a, r) => a + GAP_Y + rowH(r), 0);
  };
  const place = (n, left, top) => {
    n.x = left + n.w / 2; n.y = top;
    let y = top + n.d + LABEL_H + GAP_Y;
    n.rows.forEach((r) => {
      const maxD = Math.max(...r.map((k) => k.d));
      let l = left + (n.w - rowW(r)) / 2;
      r.forEach((k) => { place(k, l, y + (maxD - k.d) / 2); l += k.w + GAP_X; });
      y += rowH(r) + GAP_Y;
    });
    // Children on more than one row share one rounded family area, joined to their parents by one line.
    if (n.rows.length > 1) {
      const top0 = top + n.d + LABEL_H + GAP_Y - 18, widest = Math.max(...n.rows.map(rowW));
      n.group = { x: left + (n.w - widest) / 2 - 12, y: top0, w: widest + 24, h: y - GAP_Y - top0 + 12 };
    }
  };
  roots.forEach(measure);
  const shelves = []; let cur = [];
  roots.forEach((r) => { if (cur.length && rowW([...cur, r]) > Math.max(SHELF, r.w)) { shelves.push(cur); cur = []; } cur.push(r); });
  if (cur.length) shelves.push(cur);
  const maxW = Math.max(0, ...shelves.map(rowW));
  let top = 60; // room for the zoom buttons
  shelves.forEach((s) => {
    let left = 16 + (maxW - rowW(s)) / 2;
    s.forEach((r) => { place(r, left, top); left += r.w + GAP_X; });
    top += rowH(s) + GAP_Y;
  });
  return { nodes: [...node.values()], W: maxW + 32, H: Math.max(top - GAP_Y + 12, 140) };
}

function bubbleHTML(app, n, cel, i) {
  const h = n.h, people = app.membersOf(h.id);
  const mine = h.id === app.myMember()?.householdId;
  const due = !mine && checkin(app, h.id)?.overdue;
  const c = cel[h.id];
  return `<button type="button" class="fam-bub ${mine ? 'mine' : ''} ${c ? 'cel cel-' + c.kind : ''}" data-act="hh-open" data-id="${esc(h.id)}"
      style="left:${Math.round(n.x - n.d / 2)}px;top:${Math.round(n.y)}px;width:${n.d}px;height:${n.d}px;--hh:${hhColor(h)}"
      aria-label="${esc(h.name)}${mine ? ', your household' : ''}${c ? ', ' + esc(c.text) : ''}${due ? ', time to check in' : ''}. Open">
      <span class="bub-fill" aria-hidden="true"></span>
      ${c ? `<span class="bub-sparks" aria-hidden="true">${(c.kind === 'bday' ? ['🎈', '🎂', '🎉'] : c.kind === 'anniv' ? ['💕', '💗', '💞'] : c.kind === 'new' ? ['✨', '👶', '✨'] : ['🎉', '✨', '🎊']).map((e, j) => `<i style="--j:${j}">${e}</i>`).join('')}</span>` : ''}
      <span class="bub-people" style="--a:${n.a}px;width:${n.cols * (n.a + 6)}px">${people.map((m) => `<span class="bub-p">${face(m, 'bub-face')}<span class="bub-name">${esc(m.name)}</span></span>`).join('') || '<span class="bub-empty">No one yet</span>'}</span>
      ${due ? `<span class="bub-due" aria-hidden="true">${icon('bell', 13)}</span>` : ''}
    </button>
    <div class="bub-label" style="left:${Math.round(n.x - (n.d + 70) / 2)}px;top:${Math.round(n.y + n.d + 6)}px;width:${n.d + 70}px">
      ${mine ? '<small>Your household</small>' : ''}<b>${names(h.name)}</b>${c ? `<span class="bub-chip">${esc(c.text)}</span>` : ''}
    </div>`;
}

export function mapHTML() {
  return `<div class="fam-view" id="fam-view">
      <div class="fam-map" id="fam-map"></div>
      <div class="fam-zoom" role="group" aria-label="Zoom">
        <button type="button" class="icon-btn sm" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" class="icon-btn sm" data-zoom="fit" aria-label="Show the whole family">${icon('family', 16)}</button>
        <button type="button" class="icon-btn sm" data-zoom="in" aria-label="Zoom in">+</button>
      </div>
    </div>
    <p class="hint center">Pinch with two fingers to zoom and move around. Tap a circle to message them.</p>`;
}

// Fill in the map and hook up zooming. Call after mapHTML() is on the page.
export function drawMap(app, root) {
  const viewEl = root.querySelector('#fam-view'), map = root.querySelector('#fam-map');
  if (!viewEl || !map) return;
  const { nodes, W, H } = layout(app);
  const cel = celebrations(app);
  const curve = (x1, y1, x2, y2) => { const my = (y1 + y2) / 2 + 10; return `<path d="M${x1} ${y1 + 2} C ${x1} ${my}, ${x2} ${my - 20}, ${x2} ${y2 - 2}" />`; };
  const lines = nodes.flatMap((p) => p.group
    ? [`<rect class="fam-group" x="${p.group.x}" y="${p.group.y}" width="${p.group.w}" height="${p.group.h}" rx="34" style="--hh:${hhColor(p.h)}" />`, curve(p.x, p.y + p.d + LABEL_H - 6, p.x, p.group.y)]
    : p.kids.map((k) => curve(p.x, p.y + p.d, k.x, k.y))).join('');
  map.style.width = W + 'px'; map.style.height = H + 'px';
  map.innerHTML = `<svg class="fam-lines" width="${W}" height="${H}" aria-hidden="true">${lines}</svg>${nodes.map((n, i) => bubbleHTML(app, n, cel, i)).join('')}`;

  const key = app.state.cid;
  const vw = () => viewEl.clientWidth;
  // The whole family fits on open: across the screen, and no taller than most of it.
  const fitScale = () => Math.min(1, (vw() - 8) / W, (window.innerHeight * 0.78 - 16) / H);
  let v = views.get(key);
  if (!v || v.W !== W || v.H !== H) {
    const s = fitScale();
    v = { s, x: (vw() - W * s) / 2, y: 8, W, H };
    views.set(key, v);
  }
  viewEl.style.height = Math.round(Math.max(H * fitScale() + 16, 260)) + 'px';
  const apply = () => {
    const minS = Math.min(0.25, fitScale()), maxS = 2.2;
    v.s = Math.min(maxS, Math.max(minS, v.s));
    const h = viewEl.clientHeight, w = vw();
    v.x = Math.min(w - 60, Math.max(60 - W * v.s, v.x));
    v.y = Math.min(h - 60, Math.max(60 - H * v.s, v.y));
    map.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
  };
  apply();
  if (viewEl.dataset.wired) return;
  viewEl.dataset.wired = '1';

  const zoomAt = (s, cx, cy) => { const k = s / v.s; v.x = cx - (cx - v.x) * k; v.y = cy - (cy - v.y) * k; v.s = s; apply(); };
  viewEl.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (!z) return;
    e.stopPropagation();
    const w = vw(), h = viewEl.clientHeight;
    if (z.dataset.zoom === 'fit') { const s = fitScale(); v.s = s; v.x = (w - W * s) / 2; v.y = 8; apply(); }
    else zoomAt(v.s * (z.dataset.zoom === 'in' ? 1.35 : 1 / 1.35), w / 2, h / 2);
  });
  // Gestures, like a map in an app: two fingers zoom and move the family (the page holds still); one finger up or
  // down scrolls the page as usual; one finger sideways slides the family. Changes are drawn once per frame.
  let moved = false, frame = 0;
  const draw = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; apply(); }); };
  const rel = (x, y) => { const r = viewEl.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
  let g = null; // the gesture in progress
  const startTwo = (t) => {
    const a = rel(t[0].clientX, t[0].clientY), b = rel(t[1].clientX, t[1].clientY);
    g = { two: true, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, s: v.s, x: v.x, y: v.y };
  };
  viewEl.addEventListener('touchstart', (e) => {
    if (e.target.closest('.fam-zoom')) return;
    if (e.touches.length >= 2) { e.preventDefault(); startTwo(e.touches); moved = true; return; }
    const p = rel(e.touches[0].clientX, e.touches[0].clientY);
    g = { two: false, px: p.x, py: p.y, x: v.x, y: v.y, axis: null };
    moved = false;
  }, { passive: false });
  viewEl.addEventListener('touchmove', (e) => {
    if (!g) return;
    if (e.touches.length >= 2) {
      e.preventDefault();
      if (!g.two) startTwo(e.touches);
      const a = rel(e.touches[0].clientX, e.touches[0].clientY), b = rel(e.touches[1].clientX, e.touches[1].clientY);
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const k = (g.s * d / g.d) / g.s;
      v.s = g.s * k; v.x = mx - (g.mx - g.x) * k; v.y = my - (g.my - g.y) * k;
      draw(); return;
    }
    if (g.two) return; // one finger left after a pinch: wait until it lifts
    const p = rel(e.touches[0].clientX, e.touches[0].clientY), dx = p.x - g.px, dy = p.y - g.py;
    if (!g.axis && Math.abs(dx) + Math.abs(dy) > 8) g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (g.axis !== 'x') return; // up or down: the page scrolls
    e.preventDefault(); moved = true;
    v.x = g.x + dx; v.y = g.y + dy; draw();
  }, { passive: false });
  viewEl.addEventListener('touchend', (e) => { if (!e.touches.length) g = null; else if (g?.two && e.touches.length === 1) g = { two: true, done: true }; });
  viewEl.addEventListener('touchcancel', () => { g = null; });
  // Safari's own page zoom stays out of the family view.
  ['gesturestart', 'gesturechange'].forEach((t) => viewEl.addEventListener(t, (e) => e.preventDefault()));
  // A mouse drags in any direction.
  let m = null;
  viewEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button || e.target.closest('.fam-zoom')) return; const p = rel(e.clientX, e.clientY); m = { px: p.x, py: p.y, x: v.x, y: v.y }; moved = false; });
  // (The view is redrawn with the page, so listeners stay on it, not on the window; it holds the mouse once a drag starts.)
  viewEl.addEventListener('pointermove', (e) => {
    if (!m || e.pointerType !== 'mouse') return;
    const p = rel(e.clientX, e.clientY), dx = p.x - m.px, dy = p.y - m.py;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 5) { moved = true; try { viewEl.setPointerCapture(e.pointerId); } catch (er) {} }
    if (moved) { v.x = m.x + dx; v.y = m.y + dy; draw(); }
  });
  ['pointerup', 'pointercancel'].forEach((t) => viewEl.addEventListener(t, () => { m = null; }));
  viewEl.addEventListener('click', (e) => { if (moved && !e.target.closest('[data-zoom]')) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  viewEl.addEventListener('wheel', (e) => { e.preventDefault(); const r = rel(e.clientX, e.clientY); zoomAt(v.s * Math.exp(-e.deltaY * 0.0025), r.x, r.y); }, { passive: false });
}

// Tapping a circle: everyone in that household, with ways to reach them.
export function openHousehold(app, hid, act) {
  const st = app.state, h = app.household(hid);
  if (!h) return;
  const people = app.membersOf(hid), mine = hid === app.myMember()?.householdId;
  const ci = !mine && checkin(app, hid);
  const cel = celebrations(app)[hid];
  document.querySelectorAll('.sheet-wrap.hh-sheet').forEach((w) => w.remove());
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap hh-sheet';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(h.name)}" style="--hh:${hhColor(h)}">
    <div class="sheet-head"><h2>${names(h.name)}</h2><button type="button" class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
    ${cel ? `<p class="hh-cel">${esc(cel.text)}</p>` : ''}
    ${ci ? `<p class="muted small">${ci.overdue ? (ci.last ? `Last messaged ${ci.days} days ago. Time to check in.` : 'Not messaged yet. Time to check in.') : `Checked in ${ci.days === 0 ? 'today' : ci.days + ' days ago'}.`}</p>` : ''}
    <div class="card list">${people.map((m) => `<div class="li">${face(m)}<span class="li-main"><span class="li-title">${esc(m.name)}${m.id === st.me ? ' (you)' : ''}</span></span>
      ${m.id === st.me ? `<button class="btn sm ghost" data-act="photo">${icon('camera', 14)} ${m.photo ? 'Change photo' : 'Add photo'}</button>` : `<button class="btn sm ghost" data-act="msg-member" data-id="${esc(m.id)}">${icon('chat', 14)} Message</button>`}</div>`).join('')}</div>
    ${people.length > 1 || (people.length === 1 && people[0].id !== st.me) ? `<button class="btn wide" data-act="${people.length > 1 ? 'msg-household' : 'msg-member'}" data-id="${esc(people.length > 1 ? hid : people[0].id)}">${icon('chat', 16)} Message ${people.length > 1 ? 'the whole household' : esc(people[0].name)}</button>` : ''}
  </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-x]')) return close();
    const b = e.target.closest('[data-act]');
    if (b) { close(); act({ target: b }); }
  });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  wrap.querySelector('[data-x]').focus();
}
