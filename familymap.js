// The family as circles: every household is a round "liquid" bubble holding each person's round photo and name,
// laid out like a family tree (the head of the circle at the top, each generation below the one it came from).
// Pinch (or the − + buttons) to zoom, drag sideways to look around. A bubble celebrates on a birthday,
// an anniversary or another big day, and welcomes a new baby, with its own animation.
import { esc, icon, face, names, hhColor, familyTree } from './ui.js';
import { happeningToday } from './events.js';
import { today, diffDays } from './dates.js';
import { checkin } from './hub.js';

const OVER = 10, BRANCH_GAP = 18, SHELF = 560; // OVER: how far neighboring bubbles overlap, like a Venn diagram
const views = new Map(); // remembered zoom and position, per circle

// How big a bubble is, and how big the photos inside it are: photos fill as much of the circle as they can
// (fewer people, bigger photos), with each name under its photo.
function spec(n) {
  n = Math.max(1, n);
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const a = n === 1 ? 96 : n === 2 ? 78 : n <= 4 ? 68 : n <= 6 ? 60 : n <= 9 ? 52 : 46;
  const rows = Math.ceil(n / cols), gw = cols * (a + 6), gh = rows * (a + 22) + (n > 1 ? 20 : 0);
  return { a, cols, d: Math.round(Math.max(130, Math.hypot(gw, gh) * 0.92 + 12)) };
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
  const rowW = (r) => r.reduce((a, k) => a + k.w, 0) - OVER * (r.length - 1);
  const measure = (n) => { n.kids.forEach(measure); n.rows = rowsOf(n); n.w = Math.max(n.d, ...n.rows.map(rowW)); };
  // Gravity: each bubble drops straight down from above until it just touches (overlapping by OVER) whatever is
  // already there: its parents, its brothers and sisters, cousins. So nothing overlaps more than that, anywhere.
  let placed = [];
  const drop = (x, r, minCy) => {
    let cy = minCy;
    for (const p of placed) {
      const reach = p.r + r - OVER, dx = Math.abs(x - p.x);
      if (dx < reach) cy = Math.max(cy, p.cy + Math.sqrt(reach * reach - dx * dx));
    }
    return cy;
  };
  const place = (n, left, minCy) => {
    n.x = left + n.w / 2;
    const cy = drop(n.x, n.d / 2, minCy);
    n.y = cy - n.d / 2;
    placed.push({ x: n.x, cy, r: n.d / 2 });
    let bottom = n.y + n.d;
    n.rows.forEach((r) => {
      let l = left + (n.w - rowW(r)) / 2;
      r.forEach((k) => { bottom = Math.max(bottom, place(k, l, cy + n.d * 0.22)); l += k.w - OVER; });
    });
    return bottom;
  };
  roots.forEach(measure);
  const shelfW = (s) => s.reduce((a, r) => a + r.w, 0) + BRANCH_GAP * (s.length - 1);
  const shelves = []; let cur = [];
  roots.forEach((r) => { if (cur.length && shelfW([...cur, r]) > Math.max(SHELF, r.w)) { shelves.push(cur); cur = []; } cur.push(r); });
  if (cur.length) shelves.push(cur);
  const maxW = Math.max(0, ...shelves.map(shelfW));
  let top = 62; // room for the zoom buttons
  shelves.forEach((s) => {
    let left = 16 + (maxW - shelfW(s)) / 2, bottom = top;
    s.forEach((r) => { bottom = Math.max(bottom, place(r, left, top + r.d / 2)); left += r.w + BRANCH_GAP; });
    top = bottom + 26;
  });
  return { nodes: [...node.values()], W: maxW + 32, H: Math.max(top + 4, 160) };
}

function bubbleHTML(app, n, cel) {
  const h = n.h, people = app.membersOf(h.id);
  const mine = h.id === app.myMember()?.householdId;
  const due = !mine && checkin(app, h.id)?.overdue;
  const c = cel[h.id];
  const sparks = c ? (c.kind === 'bday' ? ['🎈', '🎂', '🎉', '🎈', '🎁'] : c.kind === 'anniv' ? ['💕', '💗', '💞', '💖', '💕'] : c.kind === 'new' ? ['✨', '👶', '🍼', '✨', '💫'] : ['🎉', '✨', '🎊', '🎓', '✨']) : [];
  return `<button type="button" class="fam-bub ${mine ? 'mine' : ''} ${c ? 'cel cel-' + c.kind : ''}" data-act="hh-open" data-id="${esc(h.id)}"
      style="left:${Math.round(n.x - n.d / 2)}px;top:${Math.round(n.y)}px;width:${n.d}px;height:${n.d}px;--hh:${hhColor(h)}"
      aria-label="${esc(h.name)}${mine ? ', your household' : ''}${c ? ', ' + esc(c.text) : ''}${due ? ', time to check in' : ''}. Open">
      ${c ? '<span class="bub-halo" aria-hidden="true"></span>' : ''}
      <span class="bub-fill" aria-hidden="true"></span>
      ${c ? `<span class="bub-sparks" aria-hidden="true">${sparks.map((e, j) => `<i style="--j:${j}">${e}</i>`).join('')}</span>` : ''}
      <span class="bub-people" style="--a:${n.a}px;width:${n.cols * (n.a + 6)}px">
        ${people.length > 1 ? `<span class="bub-hh">${mine ? 'You · ' : ''}${names(h.name)}</span>` : ''}
        ${people.map((m) => `<span class="bub-p">${face(m, 'bub-face')}<span class="bub-name">${esc(m.name)}</span></span>`).join('') || `<span class="bub-hh">${names(h.name)}</span><span class="bub-empty">No one yet</span>`}
      </span>
      ${c ? `<span class="bub-badge" aria-hidden="true">${{ bday: '🎂', anniv: '💕', new: '👶', big: '🎉' }[c.kind]}</span>` : ''}
      ${due ? `<span class="bub-due" aria-hidden="true">${icon('bell', 15)}</span>` : ''}
    </button>`;
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
  map.style.width = W + 'px'; map.style.height = H + 'px';
  // Bigger bubbles first, so smaller ones (children) sit on top where they overlap.
  map.innerHTML = nodes.slice().sort((a, b) => a.y - b.y).map((n) => bubbleHTML(app, n, cel)).join('');

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
