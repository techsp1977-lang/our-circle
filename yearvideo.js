// Year in Review: a 1–3 minute vertical video of the family's year, made on the phone from what's already in
// the circle: the year in numbers, then month by month its big days (graduations, weddings, trips, new babies,
// milestone anniversaries) and its albums (photos with a slow zoom), then everyone's faces. It plays on screen;
// "Save video" records it into a real video file to keep or share. Optional soft music is generated here too.
import * as S from './store.js';
import { icon, toast, safeUrl, mediaKind } from './ui.js';
import { theme } from './themes.js';

const W = 1080, H = 1920, FADE = 0.5, MIN_SEC = 60, MAX_SEC = 180, PHOTO_SEC = 2.6;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EMOJI = { graduation: '🎓', mission: '🌎', baptism: '🕊️', wedding: '💍', trip: '✈️', event: '🎉', other: '✨', baby: '👶', anniversary: '💕' };
const FONT = '-apple-system, "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif';

// ───────── what happened this year ─────────
async function gather(app, year) {
  const st = app.state;
  const inYear = (d) => String(d || '').startsWith(String(year));
  const albums = (await S.getColl(app.path('album')).catch(() => []))
    .filter((p) => new Date(p.at).getFullYear() === year)
    .map((p) => ({ title: p.title || 'Album', at: p.at, photos: (p.media || []).filter((m) => mediaKind(m) === 'image').map((m) => safeUrl(m.display || m.url)).filter(Boolean) }))
    .filter((a) => a.photos.length)
    .sort((a, b) => a.at - b.at);
  const days = [];
  for (const ev of st.events) {
    const who = (ev.memberIds || []).map((id) => app.member(id)).filter(Boolean);
    if (!ev.recurring && ev.type !== 'birthday' && ev.type !== 'anniversary' && inYear(ev.date)) {
      days.push({ date: ev.date, emoji: EMOJI[ev.type] || '✨', title: ev.title, who });
    } else if (ev.type === 'anniversary' && ev.date) {
      const yrs = year - Number(ev.date.slice(0, 4));
      if (yrs > 0 && yrs % 5 === 0) days.push({ date: `${year}${ev.date.slice(4)}`, emoji: EMOJI.anniversary, title: `${who.map((m) => m.name).join(' & ') || ev.title} · ${yrs} years`, who });
    } else if (ev.type === 'birthday' && inYear(ev.date)) {
      who.forEach((m) => days.push({ date: ev.date, emoji: EMOJI.baby, title: `Welcome, ${m.name}!`, who: [m] }));
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { albums, days, people: Object.values(st.members) };
}

// ───────── the running order, sized to 1–3 minutes ─────────
function plan(app, year, data) {
  const c = app.state.circle || {};
  const photosTotal = data.albums.reduce((a, x) => a + x.photos.length, 0);
  const months = new Map();
  const add = (m, item) => { if (!months.has(m)) months.set(m, []); months.get(m).push(item); };
  data.days.forEach((d) => add(Number(d.date.slice(5, 7)) - 1, { kind: 'day', ...d }));
  data.albums.forEach((a) => add(new Date(a.at).getMonth(), { kind: 'album', ...a }));
  const fixed = 3.5 + 4 + 4.5 + [...months.values()].reduce((a, items) => a + 1.6 + items.filter((x) => x.kind === 'day').length * 3, 0);
  // Photo time fills what's left, up to three minutes; each album gets a fair share (at least two photos).
  const budget = Math.max(0, Math.min(MAX_SEC - fixed, Math.max(MIN_SEC - fixed, photosTotal * PHOTO_SEC)));
  const room = Math.max(data.albums.length * 2, Math.floor(budget / PHOTO_SEC));
  const slides = [{ kind: 'intro', dur: 3.5, name: c.name || 'Our family', year }];
  slides.push({ kind: 'stats', dur: 4, stats: [
    [data.albums.length, data.albums.length === 1 ? 'album' : 'albums'], [photosTotal, photosTotal === 1 ? 'photo' : 'photos'],
    [data.days.length, data.days.length === 1 ? 'big day' : 'big days'], [data.people.length, 'in the family']] });
  [...months.keys()].sort((a, b) => a - b).forEach((m) => {
    slides.push({ kind: 'month', dur: 1.6, label: MONTHS[m] });
    months.get(m).forEach((it) => {
      if (it.kind === 'day') slides.push({ kind: 'day', dur: 3, ...it });
      else {
        const share = Math.max(2, Math.round(room * it.photos.length / Math.max(1, photosTotal)));
        const pick = it.photos.length <= share ? it.photos : Array.from({ length: share }, (_, i) => it.photos[Math.floor((i * it.photos.length) / share)]);
        pick.forEach((url, i) => slides.push({ kind: 'photo', dur: PHOTO_SEC, url, title: i === 0 ? it.title : '', sub: i === 0 ? new Date(it.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '', n: i }));
      }
    });
  });
  slides.push({ kind: 'outro', dur: 4.5, next: year + 1, motto: c.motto || '', people: data.people });
  let t = 0; slides.forEach((s) => { s.start = t; t += s.dur; });
  return { slides, total: t };
}

// ───────── pictures (loaded so the video can be recorded) ─────────
// Firebase pictures need the storage bucket's CORS setting so a recording is allowed; without it the video
// still plays, but saving is turned off and the reason is shown.
function loadImg(url, state) {
  return new Promise((resolve) => {
    const tryLoad = (cors) => {
      const img = new Image();
      if (cors && !/^(data|blob):/.test(url)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => { if (cors && !/^(data|blob):/.test(url)) { state.tainted = true; tryLoad(false); } else resolve(null); };
      img.src = url;
    };
    tryLoad(true);
  });
}

// ───────── drawing ─────────
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
function text(ctx, str, x, y, size, { weight = 700, color = '#fff', align = 'center', maxW = W - 160, lh = 1.15, shadow = true } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.shadowColor = shadow ? 'rgba(0,0,0,0.35)' : 'transparent'; ctx.shadowBlur = shadow ? 18 : 0;
  const lines = wrap(ctx, str, maxW);
  lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * size * lh));
  ctx.shadowBlur = 0;
  return lines.length * size * lh;
}
function cover(ctx, img, zoom, panX, panY) {
  const s = Math.max(W / img.width, H / img.height) * zoom, w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2 + panX, (H - h) / 2 + panY, w, h);
}
function bg(ctx, tint, t) {
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, `rgb(${tint.map((v) => Math.round(v * 0.75)).join(',')})`);
  g.addColorStop(1, `rgb(${tint.map((v) => Math.round(v * 0.32)).join(',')})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // soft drifting light
  const x = W * (0.3 + 0.4 * Math.sin(t * 0.35)), y = H * (0.3 + 0.15 * Math.cos(t * 0.27));
  const r = ctx.createRadialGradient(x, y, 0, x, y, W * 0.9);
  r.addColorStop(0, 'rgba(255,255,255,0.16)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
}
function faceCircle(ctx, img, name, cx, cy, r, tint) {
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
  if (img) { const s = Math.max((r * 2) / img.width, (r * 2) / img.height); ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s); }
  else { ctx.fillStyle = `rgb(${tint.join(',')})`; ctx.font = `700 ${r * 0.9}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((name || '?').trim().charAt(0).toUpperCase(), cx, cy + 2); }
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
}
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function drawSlide(ctx, s, t, env) {
  const { tint, imgs, still } = env;
  const k = still ? 0 : t / s.dur; // 0 → 1 through the slide
  if (s.kind === 'photo') {
    const img = imgs.get(s.url);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (img) { const dir = s.n % 2 ? 1 : -1; cover(ctx, img, 1.04 + 0.1 * k, dir * 40 * (k - 0.5), -30 * (k - 0.5)); }
    if (s.title) {
      const g = ctx.createLinearGradient(0, H * 0.62, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.62, W, H * 0.38);
      ctx.globalAlpha *= ease(t / 0.6);
      // The title sits above the date however many lines it takes.
      ctx.font = `700 84px ${FONT}`;
      const lines = wrap(ctx, s.title, W - 140).length, titleH = lines * 84 * 1.15;
      text(ctx, s.title, W / 2, H - 210 - titleH / 2, 84, { maxW: W - 140 });
      text(ctx, s.sub, W / 2, H - 150, 46, { weight: 500, color: 'rgba(255,255,255,0.85)' });
    }
    return;
  }
  bg(ctx, tint, env.clock);
  if (s.kind === 'intro') {
    const a = ease(t / 1.2);
    ctx.globalAlpha *= a;
    text(ctx, s.name, W / 2, H * 0.42 - (1 - a) * 40, 120, { maxW: W - 120 });
    text(ctx, `Our ${s.year}`, W / 2, H * 0.54, 72, { weight: 500, color: 'rgba(255,255,255,0.88)' });
  } else if (s.kind === 'stats') {
    text(ctx, 'Our year together', W / 2, H * 0.2, 74, { weight: 600 });
    s.stats.forEach(([n, label], i) => {
      const y = H * 0.36 + i * 300, a = ease((t - i * 0.25) / 0.7);
      ctx.save(); ctx.globalAlpha *= a;
      text(ctx, String(Math.round(n * ease((t - i * 0.25) / 1.6))), W / 2, y, 190, { weight: 800 });
      text(ctx, label, W / 2, y + 125, 56, { weight: 500, color: 'rgba(255,255,255,0.85)' });
      ctx.restore();
    });
  } else if (s.kind === 'month') {
    const a = ease(t / 0.5);
    ctx.globalAlpha *= a;
    text(ctx, s.label, W / 2, H / 2 + (1 - a) * 50, 150, { weight: 800 });
  } else if (s.kind === 'day') {
    const a = ease(t / 0.6);
    ctx.save(); ctx.globalAlpha *= a;
    ctx.font = `${230 + 30 * Math.sin(Math.min(1, t / 0.6) * Math.PI)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.emoji, W / 2, H * 0.3);
    text(ctx, s.title, W / 2, H * 0.5, 96, { maxW: W - 140 });
    const d = new Date(s.date + 'T12:00:00');
    text(ctx, d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), W / 2, H * 0.6, 54, { weight: 500, color: 'rgba(255,255,255,0.85)' });
    const who = s.who.slice(0, 5), r = 95, gap = 30, total = who.length * r * 2 + (who.length - 1) * gap;
    who.forEach((m, i) => faceCircle(ctx, imgs.get(m.photo), m.name, W / 2 - total / 2 + r + i * (r * 2 + gap), H * 0.75, r, tint));
    ctx.restore();
  } else if (s.kind === 'outro') {
    const ppl = s.people.slice(0, 30), cols = ppl.length <= 4 ? 2 : ppl.length <= 9 ? 3 : ppl.length <= 16 ? 4 : 5;
    const r = Math.min(120, (W - 160) / cols / 2 - 14), top = H * 0.2;
    ppl.forEach((m, i) => {
      const a = ease((t - i * 0.05) / 0.5);
      ctx.save(); ctx.globalAlpha *= a;
      const row = Math.floor(i / cols), col = i % cols, inRow = Math.min(cols, ppl.length - row * cols);
      const x = W / 2 + (col - (inRow - 1) / 2) * (r * 2 + 28), y = top + row * (r * 2 + 28) + r;
      faceCircle(ctx, imgs.get(m.photo), m.name, x, y, r, tint);
      ctx.restore();
    });
    const a = ease((t - 0.8) / 0.8);
    ctx.globalAlpha *= a;
    text(ctx, `Here's to ${s.next}`, W / 2, H * 0.74, 104, { weight: 800 });
    if (s.motto) text(ctx, `“${s.motto}”`, W / 2, H * 0.84, 50, { weight: 500, color: 'rgba(255,255,255,0.88)', maxW: W - 200 });
  }
}

// ───────── soft music (made here, so there's nothing to license) ─────────
function music(ac, out, seconds) {
  const chords = [[261.6, 329.6, 392.0], [196.0, 246.9, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 349.2]]; // C G Am F
  const master = ac.createGain(); master.gain.value = 0.0001; master.connect(out);
  master.gain.setTargetAtTime(0.16, ac.currentTime, 1.2);
  master.gain.setTargetAtTime(0.0001, ac.currentTime + seconds - 2.5, 0.8);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(master);
  const bar = 3.2;
  for (let i = 0, t0 = ac.currentTime + 0.1; t0 < ac.currentTime + seconds; i++, t0 += bar) {
    chords[i % 4].forEach((f) => {
      ['sine', 'triangle'].forEach((type, j) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = f * (j ? 0.5 : 1); o.detune.value = j ? -4 : 3;
        g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(j ? 0.05 : 0.07, t0 + 0.8); g.gain.linearRampToValueAtTime(0.0001, t0 + bar + 0.4);
        o.connect(g); g.connect(lp); o.start(t0); o.stop(t0 + bar + 0.5);
      });
    });
    // a gentle bell on top
    [0, 1, 2].forEach((n) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = t0 + n * (bar / 3);
      o.type = 'sine'; o.frequency.value = chords[i % 4][(n + i) % 3] * 2;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.7);
    });
  }
}

// ───────── the player ─────────
export async function openYearVideo(app) {
  const st = app.state, now = new Date();
  const years = [now.getFullYear(), now.getFullYear() - 1];
  let year = now.getMonth() <= 1 ? years[1] : years[0]; // in January and February, last year is the one to look back on
  const tint = theme(st.circle?.theme).light.tint;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = document.createElement('div');
  wrap.className = 'yr-wrap';
  wrap.innerHTML = `<div class="yr" role="dialog" aria-modal="true" aria-label="Year in review">
    <div class="yr-top">
      <label class="sr" for="yr-year">Year</label>
      <select id="yr-year" class="select-pill">${years.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <span class="grow"></span>
      <label class="yr-music"><input type="checkbox" id="yr-music" checked> Music</label>
      <button class="icon-btn" data-x aria-label="Close">${icon('x')}</button>
    </div>
    <div class="yr-stage"><canvas width="${W}" height="${H}" aria-label="Year in review video"></canvas><p class="yr-status" aria-live="polite"></p></div>
    <div class="yr-actions">
      <button class="btn ghost" data-play>${icon('next', 16)} Play</button>
      <button class="btn" data-save>${icon('download', 16)} Save video</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const canvas = wrap.querySelector('canvas'), ctx = canvas.getContext('2d'), status = wrap.querySelector('.yr-status');
  const playBtn = wrap.querySelector('[data-play]'), saveBtn = wrap.querySelector('[data-save]');
  let show = null, raf = 0, ac = null, recording = null, alive = true;
  const env = { tint, imgs: new Map(), still, clock: 0, tainted: false };

  const prepare = async () => {
    cancelAnimationFrame(raf); playBtn.disabled = saveBtn.disabled = true;
    status.textContent = 'Gathering your year…';
    const data = await gather(app, year);
    show = plan(app, year, data);
    const urls = [...new Set([...show.slides.filter((s) => s.kind === 'photo').map((s) => s.url), ...Object.values(st.members).map((m) => m.photo && safeUrl(m.photo)).filter(Boolean)])];
    env.imgs = new Map(); env.tainted = false;
    let done = 0;
    await Promise.all(urls.map(async (u) => { const img = await loadImg(u, env); if (img) env.imgs.set(u, img); status.textContent = `Getting photos ready… ${++done} of ${urls.length}`; }));
    if (!alive) return;
    // Skip any photo that couldn't be loaded (deleted, or offline), and carry its album title to the next one.
    let carry = null;
    show.slides = show.slides.filter((x) => {
      if (x.kind !== 'photo') { carry = null; return true; }
      if (!env.imgs.has(x.url)) { if (x.title) carry = { title: x.title, sub: x.sub }; return false; }
      if (carry && !x.title) { Object.assign(x, carry); carry = null; }
      return true;
    });
    let at = 0; show.slides.forEach((x) => { x.start = at; at += x.dur; }); show.total = at;
    const mins = Math.floor(show.total / 60), secs = Math.round(show.total % 60);
    status.textContent = data.albums.length || data.days.length ? `${mins ? mins + ' min ' : ''}${secs} sec` : `Nothing from ${year} yet. Share albums and add big days, and they'll show up here.`;
    playBtn.disabled = false; saveBtn.disabled = env.tainted;
    if (env.tainted) status.textContent += '. Saving needs a one-time setting (see the Our Circle setup guide).';
    frame(0);
  };
  const frame = (t) => {
    env.clock = t;
    const ss = show.slides;
    let i = ss.findIndex((s) => t < s.start + s.dur); if (i < 0) i = ss.length - 1;
    const s = ss[i], local = t - s.start;
    ctx.save(); ctx.globalAlpha = 1; drawSlide(ctx, s, local, env); ctx.restore();
    if (i > 0 && local < FADE) { // cross-fade from the slide before
      ctx.save(); ctx.globalAlpha = 1 - local / FADE; drawSlide(ctx, ss[i - 1], ss[i - 1].dur, env); ctx.restore();
    }
  };
  const play = (onEnd) => new Promise((resolve) => {
    cancelAnimationFrame(raf);
    const music_ = wrap.querySelector('#yr-music').checked;
    if (music_) { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); music(ac, recording?.audioOut || ac.destination, show.total); }
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= show.total) { frame(show.total - 0.01); playBtn.innerHTML = `${icon('next', 16)} Play again`; onEnd?.(); resolve(); return; }
      frame(t); raf = requestAnimationFrame(tick);
    };
    playBtn.innerHTML = `${icon('next', 16)} Restart`;
    tick();
  });
  playBtn.addEventListener('click', () => play());
  saveBtn.addEventListener('click', async () => {
    if (env.tainted || !canvas.captureStream || !window.MediaRecorder) { toast("This phone can't save the video. You can still play it.", 6000); return; }
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
    const stream = canvas.captureStream(30);
    recording = {};
    if (wrap.querySelector('#yr-music').checked) {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      // The music goes both to the speaker and into the recording.
      const dest = ac.createMediaStreamDestination();
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      const both = ac.createGain(); both.connect(dest); both.connect(ac.destination); recording.audioOut = both;
    }
    const chunks = [], rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4.5e6 }); // sharp on a phone, small enough to text
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let lock = null; try { lock = await navigator.wakeLock?.request('screen'); } catch (e) {}
    saveBtn.disabled = playBtn.disabled = true; status.textContent = 'Recording your video… keep this screen open.';
    rec.start(1000);
    await play();
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    lock?.release?.(); recording = null; saveBtn.disabled = playBtn.disabled = false;
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const file = new File(chunks, `${(st.circle?.name || 'Our family').replace(/[^\w ]+/g, '').trim()} ${year}.${ext}`, { type: mime.split(';')[0] });
    status.textContent = 'Your video is ready.';
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: `Our ${year}` }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  });
  wrap.querySelector('#yr-year').addEventListener('change', (e) => { year = Number(e.target.value); prepare(); });
  const close = () => { alive = false; cancelAnimationFrame(raf); ac?.close?.(); wrap.remove(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  prepare();
}
