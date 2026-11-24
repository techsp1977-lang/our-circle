// The family as circles: every household is a round "liquid" bubble holding each person's round photo and name,
// laid out like a family tree (the head of the circle at the top, each generation below the one it came from).
// Pinch (or the − + buttons) to zoom, drag sideways to look around. A bubble celebrates on a birthday,
// an anniversary or another big day, and welcomes a new baby, with its own animation.
import { esc, icon, face, names, hhColor, familyTree } from './ui.js';
import { happeningToday } from './events.js';
import { today, diffDays } from './dates.js';
import { checkin } from './hub.js';

const OVER = 10, SHELF = 560; // OVER: how far neighboring bubbles overlap, like a Venn diagram
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

// Positions, like a family tree made of bubbles: every household touches the household it's under, its children
// fan out around it (pointing away from the head of the circle), and a short settling pass nudges bubbles apart
// wherever branches crowd, while each child stays attached to its parents. Households that aren't placed under
// anyone yet sit together below the tree.
function layout(app) {
  const st = app.state;
  const rows = familyTree(st.households);
  const node = new Map(rows.map(({ h, depth }) => [h.id, { h, depth, ...spec(app.membersOf(h.id).length), kids: [], parent: null }]));
  const roots = [];
  rows.forEach(({ h }) => { const n = node.get(h.id); const p = h.parentId && node.get(h.parentId); if (p && p !== n && n.depth > p.depth) { p.kids.push(n); n.parent = p; } else roots.push(n); });
  const all = [...node.values()];
  all.forEach((n) => { n.r = n.d / 2; });
  const rest = (p, k) => p.r + k.r - OVER; // how far apart a parent and child sit: just touching

  // Each household takes the nearest open spot touching its parents, searching outward from the direction that
  // points away from the grandparents. If the parents are already surrounded, it takes the nearest open spot
  // touching a brother or sister. Every spot is checked against every bubble already placed, so nothing overlaps
  // more than OVER, and nobody ends up away from their family.
  // Spacing: inside one family branch, bubbles touch (overlapping OVER, like a Venn diagram). The head of the circle
  // keeps a little open space around it, and separate family branches keep a small gap between them.
  const HEAD_GAP = 30, BRANCH_GAP = 18;
  let placed = [];
  const need = (q, k) => q.isHead || k.isHead ? q.r + k.r + HEAD_GAP : q.branch === k.branch ? q.r + k.r - OVER : q.r + k.r + BRANCH_GAP;
  const fits = (x, cy, k) => placed.every((q) => Math.hypot(x - q.x, cy - q.cy) >= need(q, k) - 0.5);
  // The nearest open spot at distance R from an anchor, searching out from a preferred direction.
  const around = (k, anchor, dir, R) => {
    for (let deg = 0; deg <= 180; deg += 3) {
      for (const sign of deg ? [1, -1] : [1]) {
        const t = dir + (sign * deg * Math.PI) / 180, x = anchor.x + R * Math.cos(t), cy = anchor.cy + R * Math.sin(t);
        if (fits(x, cy, k)) return { x, cy };
      }
    }
    return null;
  };
  const sizeOf = (n) => 1 + n.kids.reduce((a, k) => a + sizeOf(k), 0);
  // One family: each household's children bunch around it, touching, facing away from the head.
  const growBranch = (top) => {
    const queue = [top];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i], n = p.kids.length, span = Math.min(Math.PI * 1.3, n * 0.95);
      p.kids.forEach((k, idx) => {
        k.branch = top.branch;
        const want = p.dir + span * ((idx + 0.5) / n - 0.5);
        let spot = around(k, p, want, p.r + k.r - OVER);
        if (!spot) { // parents surrounded: beside a brother or sister, as close to the parents as possible
          let best = null, bestD = Infinity;
          for (const sib of p.kids) {
            if (sib === k || !placed.includes(sib)) continue;
            const c = around(k, sib, Math.atan2(sib.cy - p.cy, sib.x - p.x), sib.r + k.r - OVER);
            if (c) { const d = Math.hypot(c.x - p.x, c.cy - p.cy); if (d < bestD) { best = c; bestD = d; } }
          }
          spot = best;
        }
        if (!spot) { let R = p.r + k.r; do { R += 12; } while (!fits(p.x + R * Math.cos(p.dir), p.cy + R * Math.sin(p.dir), k)); spot = { x: p.x + R * Math.cos(p.dir), cy: p.cy + R * Math.sin(p.dir) }; }
        k.x = spot.x; k.cy = spot.cy; k.dir = Math.atan2(k.cy - p.cy, k.x - p.x);
        placed.push(k); queue.push(k);
      });
    }
    return queue;
  };
  const growTree = (root) => {
    root.x = 0; root.cy = 0; root.isHead = true; root.branch = 'head'; placed = [root];
    // Each first-generation household gets a slice around the head sized by its family; position one starts at
    // the top and the rest follow clockwise. Each family is laid out in full before the next.
    const total = root.kids.reduce((a, k) => a + sizeOf(k), 0) || 1;
    let at = -Math.PI / 2 - (root.kids[0] ? (Math.PI * sizeOf(root.kids[0])) / total : 0); // position one centered at the top
    const out = [root];
    root.kids.forEach((k) => {
      const slice = (2 * Math.PI * sizeOf(k)) / total, mid = root.kids.length === 1 ? Math.PI / 2 : at + slice / 2;
      at += slice;
      k.branch = k.h.id;
      let R = root.r + k.r + HEAD_GAP, spot = null;
      while (!spot) { spot = around(k, root, mid, R); R += 16; }
      k.x = spot.x; k.cy = spot.cy; k.dir = Math.atan2(k.cy - root.cy, k.x - root.x);
      placed.push(k);
      out.push(...growBranch(k));
    });
    return out;
  };
  const box = (g) => ({ x0: Math.min(...g.map((n) => n.x - n.r)), x1: Math.max(...g.map((n) => n.x + n.r)), y0: Math.min(...g.map((n) => n.cy - n.r)), y1: Math.max(...g.map((n) => n.cy + n.r)) });

  // Trees (households with others under them) first, then everyone not placed yet, packed in rows.
  const trees = roots.filter((r) => r.kids.length), loose = roots.filter((r) => !r.kids.length);
  let top = 62, W = 0; const blocks = [];
  trees.forEach((r) => { placed = []; const g = growTree(r); blocks.push({ g, b: box(g) }); });
  if (loose.length) {
    let x = 0, row = [], rows2 = [];
    loose.forEach((n) => { if (row.length && x + n.d > SHELF) { rows2.push(row); row = []; x = 0; } n.x = x + n.r; n.cy = n.r; x += n.d - OVER; row.push(n); });
    if (row.length) rows2.push(row);
    let y = 0; const g = [];
    rows2.forEach((rw) => { const h = Math.max(...rw.map((n) => n.d)); rw.forEach((n) => { n.cy += y + (h - n.d) / 2; g.push(n); }); y += h + 10; });
    blocks.push({ g, b: box(g) });
  }
  const maxW = Math.max(0, ...blocks.map(({ b }) => b.x1 - b.x0));
  blocks.forEach(({ g, b }) => {
    const ox = 16 + (maxW - (b.x1 - b.x0)) / 2 - b.x0, oy = top - b.y0;
    g.forEach((n) => { n.x += ox; n.y = n.cy + oy - n.r; });
    top += b.y1 - b.y0 + 30;
  });
  W = maxW + 32;
  return { nodes: all, W, H: Math.max(top, 160) };
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
