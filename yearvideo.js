// Year in Review: a 1, 3 or 5 minute video of the family's year (wide for a TV, or tall for a phone), made on
// the phone from what's already in
// the circle: the year in numbers, then month by month its big days (graduations, weddings, trips, new babies,
// milestone anniversaries, each really big one in words) and its albums (every photo shown whole), then everyone's faces. It plays on screen;
// "Save video" records it into a real video file to keep or share. Optional soft music is generated here too.
import * as S from './store.js';
import { icon, toast, safeUrl, mediaKind } from './ui.js';
import { theme } from './themes.js';

let W = 1920, H = 1080, U = 1, WIDE = true; // the video's shape: wide for a TV (default) or tall for a phone
// The saved video is 1920×1080 or 1080×1920; full screen uses the screen's own shape (see openYearVideo).
const setShape = (wide, w, h) => { WIDE = wide; W = w || (wide ? 1920 : 1080); H = h || (wide ? 1080 : 1920); U = 1; };
const FADE = 0.5;
export const LENGTHS = [60, 180, 300]; // 1, 3 or 5 minutes
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EMOJI = { graduation: '🎓', mission: '🌎', baptism: '🕊️', wedding: '💍', trip: '✈️', event: '🎉', other: '✨', baby: '👶', anniversary: '💕' };
const FONT = '-apple-system, "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif';
// Milestones that get a worded slide.
const BIG_BIRTHDAYS = [1, 16, 18, 21, 30, 40, 50, 60, 70, 75, 80, 90, 100];
const ANNIV = { 1: 'First anniversary', 25: 'Silver anniversary', 30: 'Pearl anniversary', 40: 'Ruby anniversary', 50: 'Golden anniversary', 60: 'Diamond anniversary', 70: 'Platinum anniversary', 75: 'Diamond jubilee' };
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const join = (a) => a.length <= 1 ? (a[0] || '') : a.length === 2 ? `${a[0]} & ${a[1]}` : `${a.slice(0, -1).join(', ')} & ${a.at(-1)}`;

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
  const md = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const named = (who, ev) => who.length ? join(who.map((m) => m.name)) : String(ev.title || '').replace(/\s*·.*$/, '');
  const knownYr = (d) => Number(String(d).slice(0, 4)) > 1904;
  const couples = new Set(); // weddings already shown, so a wedding and a new anniversary date don't both appear
  for (const ev of st.events) {
    const who = (ev.memberIds || []).map((id) => app.member(id)).filter(Boolean);
    const key = who.map((m) => m.id).sort().join(',');
    if (!ev.recurring && ev.type !== 'birthday' && ev.type !== 'anniversary' && inYear(ev.date)) {
      // The really big ones get a worded slide of their own.
      const big = ev.type === 'wedding' ? { eyebrow: 'Just married', head: named(who, ev) }
        : ev.type === 'graduation' ? { eyebrow: 'Graduated', head: named(who, ev) }
        : ev.type === 'mission' ? { eyebrow: 'Called to serve', head: named(who, ev) }
        : ev.type === 'baptism' ? { eyebrow: 'Baptized', head: named(who, ev) } : null;
      if (ev.type === 'wedding' && key) couples.add(key);
      days.push({ date: ev.date, emoji: EMOJI[ev.type] || '✨', title: ev.title, who, big, line: big ? `${big.head} · ${big.eyebrow.toLowerCase()}` : ev.title });
    } else if (ev.type === 'anniversary' && ev.date && knownYr(ev.date)) {
      const yrs = year - Number(ev.date.slice(0, 4)), date = `${year}${ev.date.slice(4)}`, names = named(who, ev);
      if (yrs === 0 && !couples.has(key)) days.push({ date, emoji: '💍', title: `${names} were married`, who, big: { eyebrow: 'Just married', head: names }, line: `${names} · just married` });
      else if (yrs === 1 || (yrs > 0 && yrs % 5 === 0)) {
        const label = ANNIV[yrs] || `${ordinal(yrs)} anniversary`;
        days.push({ date, emoji: EMOJI.anniversary, title: `${names} · ${yrs} years`, who, gold: yrs >= 50, big: { eyebrow: label, head: `${yrs} ${yrs === 1 ? 'year' : 'years'} married`, sub: names }, line: `${names} · ${yrs} ${yrs === 1 ? 'year' : 'years'} married` });
      }
    } else if (ev.type === 'birthday' && ev.date) {
      if (inYear(ev.date)) who.forEach((m) => days.push({ date: ev.date, emoji: EMOJI.baby, title: `Welcome, ${m.name}!`, who: [m], big: { eyebrow: 'Welcome to the family', head: m.name, sub: `Born ${md(new Date(ev.date + 'T12:00:00'))}` }, line: `Welcome, ${m.name}` }));
      else if (knownYr(ev.date)) {
        const age = year - Number(ev.date.slice(0, 4));
        if (BIG_BIRTHDAYS.includes(age)) who.forEach((m) => days.push({ date: `${year}${ev.date.slice(4)}`, emoji: '🎂', title: `${m.name} turned ${age}`, who: [m], big: { eyebrow: 'A milestone birthday', head: `${m.name} turned ${age}` }, line: `${m.name} turned ${age}` }));
      }
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { albums, days, people: Object.values(st.members) };
}

// An album that goes with a big moment: one whose title names someone in it, or the kind of day ("wedding",
// "baby"…), shared within about six weeks of the day. Its photos play right after the announcement, and its
// first photo sits behind the words.
const KIND_WORDS = { '💍': /wedding|married|bride|reception/i, '👶': /\bbaby\b|\bborn\b|newborn|\bbirth\b/i, '🎓': /grad/i, '🌎': /mission/i, '🕊️': /baptism|baptized/i, '💕': /anniversary/i, '🎂': /birthday|bday/i };
function albumFor(day, albums, used) {
  const when = new Date(day.date + 'T12:00:00').getTime();
  const firsts = day.who.map((m) => String(m.name || '').trim().split(/\s+/)[0].toLowerCase()).filter((n) => n.length > 1);
  let best = null, bestScore = 0;
  for (const a of albums) {
    if (used.has(a)) continue;
    const t = String(a.title || '').toLowerCase(), days = Math.abs(a.at - when) / 864e5;
    const nameHit = firsts.some((n) => new RegExp(`\\b${n.replace(/[^a-z0-9]/g, '')}`).test(t)), kindHit = KIND_WORDS[day.emoji]?.test(t);
    if (!(nameHit || kindHit) || days > 45) continue;
    if (day.emoji === '🎂' && !nameHit) continue; // someone's birthday party only goes with their birthday
    const score = (nameHit ? 2 : 0) + (kindHit ? 2 : 0) + (1 - days / 45);
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return best;
}

// ───────── the running order, sized to the length picked (1, 3 or 5 minutes) ─────────
// Month by month: the big moments are announced in words where they happened in the year, each followed by
// its album when there is one, and the other albums and days fill in around them.
function plan(app, year, data, target) {
  const c = app.state.circle || {};
  const photosTotal = data.albums.reduce((a, x) => a + x.photos.length, 0);
  const months = new Map();
  const add = (m, item) => { if (!months.has(m)) months.set(m, []); months.get(m).push(item); };
  const used = new Set();
  const days = data.days.map((d) => { const album = d.big ? albumFor(d, data.albums, used) : null; if (album) used.add(album); return { kind: 'day', ...d, album }; });
  days.forEach((d) => add(Number(d.date.slice(5, 7)) - 1, d));
  data.albums.filter((a) => !used.has(a)).forEach((a) => add(new Date(a.at).getMonth(), { kind: 'album', ...a, sortAt: a.at }));
  months.forEach((list) => list.sort((x, y) => (x.sortAt || new Date(x.date + 'T12:00:00').getTime()) - (y.sortAt || new Date(y.date + 'T12:00:00').getTime())));
  const dayCount = data.days.length, monthCount = months.size;
  const bigCount = data.days.filter((d) => d.big).length, smallCount = dayCount - bigCount;
  // A busy year in a short video: big days and month titles go a little quicker so photos still get room.
  let dayDur = 3.2, bigDur = 5, monthDur = 1.6;
  const ends = 3.5 + 4 + 5;
  if (ends + smallCount * dayDur + bigCount * bigDur + monthCount * monthDur > target * 0.55) { dayDur = 2.2; bigDur = 3.8; monthDur = 1.1; }
  const fixed = ends + smallCount * dayDur + bigCount * bigDur + monthCount * monthDur;
  // Photos fill the rest. A longer video shows more of each album and lingers a little longer on each photo.
  const budget = Math.max(0, target - fixed), pace = target >= 300 ? 3.1 : target >= 180 ? 2.8 : 2.4;
  const perPhoto = photosTotal * pace > budget ? pace : Math.min(4.5, Math.max(pace, budget / Math.max(1, photosTotal)));
  const room = Math.max(Math.min(photosTotal, data.albums.length), Math.floor(budget / perPhoto));
  const photosOf = (a, withTitle) => {
    const share = Math.max(1, Math.round((room * a.photos.length) / Math.max(1, photosTotal)));
    const pick = a.photos.length <= share ? a.photos : Array.from({ length: share }, (_, i) => a.photos[Math.floor((i * a.photos.length) / share)]);
    return pick.map((url, i) => ({ kind: 'photo', dur: perPhoto, url, title: withTitle && i === 0 ? a.title : '', sub: withTitle && i === 0 ? new Date(a.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '', n: i }));
  };
  const slides = [{ kind: 'intro', dur: 3.5, name: c.name || 'Our family', year }];
  slides.push({ kind: 'stats', dur: 4, stats: [
    [data.albums.length, data.albums.length === 1 ? 'album' : 'albums'], [photosTotal, photosTotal === 1 ? 'photo' : 'photos'],
    [dayCount, dayCount === 1 ? 'big day' : 'big days'], [data.people.length, 'in the family']] });
  [...months.keys()].sort((a, b) => a - b).forEach((m) => {
    slides.push({ kind: 'month', dur: monthDur, label: MONTHS[m] });
    months.get(m).forEach((it) => {
      if (it.kind === 'album') { slides.push(...photosOf(it, true)); return; }
      if (!it.big) { slides.push({ ...it, kind: 'day', dur: dayDur }); return; }
      // The announcement, with its album's first photo behind the words, then the album (titled quietly, since
      // the announcement already said what it is).
      const pics = it.album ? photosOf(it.album, false) : [];
      slides.push({ ...it, kind: 'big', dur: bigDur, bgUrl: it.album?.photos[0] || null });
      if (pics.length) { pics[0].title = it.album.title; pics[0].sub = ''; slides.push(...pics); }
    });
  });
  slides.push({ kind: 'outro', dur: 5, next: year + 1, motto: c.motto || '', people: data.people });
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
// The whole photo, never cropped or zoomed, over a soft blurred copy of itself that fills the rest of the screen.
// (The blur is the photo drawn tiny and stretched, which works on every phone.)
const softCache = new WeakMap();
function soft(img, size = 32) {
  const key = `${W}x${H}@${size}`, hits = softCache.get(img) || {};
  if (hits[key]) return hits[key];
  const c = document.createElement('canvas'); c.width = size; c.height = Math.max(8, Math.round(size * H / W));
  const x = c.getContext('2d'), s = Math.max(c.width / img.width, c.height / img.height);
  x.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
  hits[key] = c; softCache.set(img, hits);
  return c;
}
function wholePhoto(ctx, img) {
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(soft(img), -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
  const s = Math.min(W / img.width, H / img.height), w = img.width * s, h = img.height * s;
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  ctx.restore();
}
// Falling confetti for the big moments (still sprinkles when the phone asks for less motion).
const CONFETTI = Array.from({ length: 70 }, (_, i) => ({ x: (i * 0.6180339) % 1, d: 0.5 + ((i * 0.37) % 1) * 0.8, sp: 0.6 + ((i * 0.71) % 1) * 0.7, c: ['#FFD54F', '#FF8A80', '#80D8FF', '#B9F6CA', '#FFFFFF', '#F8BBD0'][i % 6], r: (i * 1.7) % 6.28 }));
function confetti(ctx, t, still) {
  ctx.save();
  const base = ctx.globalAlpha;
  for (const p of CONFETTI) {
    const y = still ? ((p.x * 7.3) % 1) * H : ((t * p.sp * 0.22 + p.x * 3.1) % 1.2 - 0.1) * H;
    const x = p.x * W + (still ? 0 : Math.sin(t * 1.6 * p.sp + p.r) * 30);
    ctx.translate(x, y); ctx.rotate(p.r + (still ? 0 : t * 2 * p.sp));
    ctx.fillStyle = p.c; ctx.globalAlpha = base * 0.85; ctx.fillRect(-9 * p.d, -4 * p.d, 18 * p.d, 8 * p.d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();
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
    if (img) wholePhoto(ctx, img);
    if (s.title) {
      const g = ctx.createLinearGradient(0, H * 0.6, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.6, W, H * 0.4);
      ctx.globalAlpha *= ease(t / 0.6);
      // The title sits above the date however many lines it takes.
      const size = WIDE ? 76 : 84;
      ctx.font = `700 ${size}px ${FONT}`;
      const titleH = wrap(ctx, s.title, W - 200).length * size * 1.15;
      text(ctx, s.title, W / 2, H - (WIDE ? 150 : 210) - titleH / 2, size, { maxW: W - 200 });
      text(ctx, s.sub, W / 2, H - (WIDE ? 95 : 150), 46, { weight: 500, color: 'rgba(255,255,255,0.85)' });
    }
    return;
  }
  bg(ctx, tint, env.clock);
  if (s.kind === 'intro') {
    const a = ease(t / 1.2);
    ctx.globalAlpha *= a;
    text(ctx, s.name, W / 2, H * 0.42 - (1 - a) * 40, WIDE ? 130 : 120, { maxW: W - 160 });
    text(ctx, `Our ${s.year}`, W / 2, H * (WIDE ? 0.6 : 0.54), WIDE ? 70 : 72, { weight: 500, color: 'rgba(255,255,255,0.88)' });
  } else if (s.kind === 'stats') {
    text(ctx, 'Our year together', W / 2, H * (WIDE ? 0.2 : 0.2), 74, { weight: 600 });
    s.stats.forEach(([n, label], i) => {
      // A row of four on a TV; a column on a phone.
      const x = WIDE ? W * (i + 0.5) / 4 : W / 2, y = WIDE ? H * 0.52 : H * 0.36 + i * 300, a = ease((t - i * 0.25) / 0.7);
      ctx.save(); ctx.globalAlpha *= a;
      text(ctx, String(Math.round(n * ease((t - i * 0.25) / 1.6))), x, y, WIDE ? 200 : 190, { weight: 800, maxW: W / 4 });
      text(ctx, label, x, y + (WIDE ? 135 : 125), 54, { weight: 500, color: 'rgba(255,255,255,0.85)', maxW: WIDE ? W / 4 - 20 : W - 160 });
      ctx.restore();
    });
  } else if (s.kind === 'month') {
    const a = ease(t / 0.5);
    ctx.globalAlpha *= a;
    text(ctx, s.label, W / 2, H / 2 + (1 - a) * 50, WIDE ? 170 : 150, { weight: 800 });
  } else if (s.kind === 'day') {
    const a = ease(t / 0.6);
    ctx.save(); ctx.globalAlpha *= a;
    ctx.font = `${(WIDE ? 190 : 230) + 30 * Math.sin(Math.min(1, t / 0.6) * Math.PI)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.emoji, W / 2, H * (WIDE ? 0.22 : 0.3));
    text(ctx, s.title, W / 2, H * (WIDE ? 0.47 : 0.5), WIDE ? 92 : 96, { maxW: W - 200 });
    const d = new Date(s.date + 'T12:00:00');
    text(ctx, d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), W / 2, H * (WIDE ? 0.6 : 0.6), 54, { weight: 500, color: 'rgba(255,255,255,0.85)' });
    const who = s.who.slice(0, WIDE ? 7 : 5), r = WIDE ? 80 : 95, gap = 30, total = who.length * r * 2 + (who.length - 1) * gap;
    who.forEach((m, i) => faceCircle(ctx, imgs.get(m.photo), m.name, W / 2 - total / 2 + r + i * (r * 2 + gap), H * (WIDE ? 0.8 : 0.75), r, tint));
    ctx.restore();
  } else if (s.kind === 'big') {
    // A worded slide for the year's really big moments: a new baby, a wedding, a milestone anniversary or birthday.
    const back = s.bgUrl && imgs.get(s.bgUrl);
    if (back) { // a photo from the album that goes with it, softly blurred behind the words
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(soft(back, 140), -W * 0.03, -H * 0.03, W * 1.06, H * 1.06);
      ctx.fillStyle = s.gold ? 'rgba(70,48,4,0.55)' : 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); ctx.restore();
    } else if (s.gold) { // golden and later anniversaries: a warm gold background instead of the circle's color
      const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, '#9A7414'); g.addColorStop(1, '#3B2A06');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const x = W * (0.3 + 0.4 * Math.sin(env.clock * 0.35)), r = ctx.createRadialGradient(x, H * 0.3, 0, x, H * 0.3, W * 0.9);
      r.addColorStop(0, 'rgba(255,236,170,0.28)'); r.addColorStop(1, 'rgba(255,236,170,0)'); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    }
    confetti(ctx, t, still);
    const at = (d, len = 0.6) => ease((t - d) / len);
    const gap = WIDE ? 28 : 44, em = WIDE ? 130 : 200, eb = WIDE ? 52 : 58, hs = WIDE ? 136 : 150, ss = WIDE ? 64 : 70, ds = WIDE ? 48 : 54;
    const who = s.who.slice(0, WIDE ? 6 : 4), r = WIDE ? 78 : 110, fg = 30;
    const maxW = W - (WIDE ? 260 : 140);
    ctx.font = `800 ${hs}px ${FONT}`;
    const hh = wrap(ctx, s.big.head, maxW).length * hs * 1.1;
    ctx.font = `600 ${ss}px ${FONT}`;
    const sh = s.big.sub ? wrap(ctx, s.big.sub, W - 200).length * ss * 1.15 : 0;
    const showDate = !/^Born /.test(s.big.sub || '');
    // Everything centered on the screen as one block.
    const block = em + gap + eb + gap * 0.8 + hh + gap + (sh ? sh + gap * 0.5 : 0) + (showDate ? ds * 1.15 : 0) + (who.length ? gap * 2 + r * 2 : 0);
    let y = Math.max(40, (H - block) / 2);
    ctx.save(); ctx.globalAlpha *= at(0, 0.5);
    ctx.font = `${em * (0.85 + 0.15 * at(0, 0.7))}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.emoji, W / 2, y + em / 2); ctx.restore();
    y += em + gap;
    ctx.save(); ctx.globalAlpha *= at(0.25);
    text(ctx, s.big.eyebrow.toUpperCase(), W / 2, y + eb / 2, eb, { weight: 700, color: s.gold ? '#FFE9A8' : 'rgba(255,255,255,0.88)' });
    ctx.restore();
    y += eb + gap * 0.8;
    ctx.save(); ctx.globalAlpha *= at(0.5, 0.7);
    text(ctx, s.big.head, W / 2, y + hh / 2 + (1 - at(0.5, 0.7)) * 30, hs, { weight: 800, maxW, lh: 1.1 });
    ctx.restore();
    y += hh + gap;
    ctx.save(); ctx.globalAlpha *= at(1);
    if (sh) { text(ctx, s.big.sub, W / 2, y + sh / 2, ss, { weight: 600, maxW: W - 200 }); y += sh + gap * 0.5; }
    if (showDate) { text(ctx, new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), W / 2, y + ds / 2, ds, { weight: 500, color: 'rgba(255,255,255,0.8)' }); y += ds * 1.15; }
    ctx.restore();
    const total = who.length * r * 2 + (who.length - 1) * fg, fy = Math.min(y + gap * 2 + r, H - r - 30);
    ctx.save(); ctx.globalAlpha *= at(1.3);
    who.forEach((m, i) => faceCircle(ctx, imgs.get(m.photo), m.name, W / 2 - total / 2 + r + i * (r * 2 + fg), fy, r, tint));
    ctx.restore();
  } else if (s.kind === 'outro') {
    const ppl = s.people.slice(0, WIDE ? 36 : 30), n = ppl.length;
    const cols = WIDE ? (n <= 6 ? n : n <= 16 ? Math.ceil(n / 2) : Math.ceil(n / 3)) : (n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5);
    const rows = Math.ceil(n / Math.max(1, cols)), area = WIDE ? H * 0.56 : H * 0.5;
    const r = Math.max(30, Math.min(WIDE ? 110 : 120, (W - 200) / Math.max(1, cols) / 2 - 14, area / rows / 2 - 14)), top = H * (WIDE ? 0.1 : 0.2);
    ppl.forEach((m, i) => {
      const a = ease((t - i * 0.05) / 0.5);
      ctx.save(); ctx.globalAlpha *= a;
      const row = Math.floor(i / cols), col = i % cols, inRow = Math.min(cols, n - row * cols);
      const x = W / 2 + (col - (inRow - 1) / 2) * (r * 2 + 28), y = top + row * (r * 2 + 28) + r;
      faceCircle(ctx, imgs.get(m.photo), m.name, x, y, r, tint);
      ctx.restore();
    });
    const a = ease((t - 0.8) / 0.8);
    ctx.globalAlpha *= a;
    text(ctx, `Here's to ${s.next}`, W / 2, H * (WIDE ? 0.78 : 0.74), WIDE ? 100 : 104, { weight: 800 });
    if (s.motto) text(ctx, `“${s.motto}”`, W / 2, H * (WIDE ? 0.9 : 0.84), WIDE ? 46 : 50, { weight: 500, color: 'rgba(255,255,255,0.88)', maxW: W - 240 });
  }
}

// ───────── music (made here, so there's nothing to license) ─────────
// Each style is a tempo, a chord progression and a few instruments built from simple tones. Notes are scheduled a
// couple of seconds ahead while the video plays (not all at once), and everything stops when the video does.
const N = (name) => { const i = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0); const oct = Number(name.slice(-1)); return 440 * Math.pow(2, (i + (oct - 4) * 12 - 9) / 12); };
const CH = { C: ['C3', 'E3', 'G3', 'C4'], G: ['G2', 'B2', 'D3', 'G3'], Am: ['A2', 'C3', 'E3', 'A3'], F: ['F2', 'A2', 'C3', 'F3'], Em: ['E2', 'G2', 'B2', 'E3'], Dm: ['D3', 'F3', 'A3', 'D4'] };
export const STYLES = {
  calm: { level: 2.3, label: 'Calm', bpm: 60, beats: 4, prog: ['C', 'G', 'Am', 'F'], pad: ['sine', 'triangle'], padGain: 0.07, bell: 1, echo: 0 },
  upbeat: { level: 0.85, label: 'Upbeat', bpm: 112, beats: 4, prog: ['C', 'Am', 'F', 'G'], pad: ['triangle'], padGain: 0.035, bass: 2, arp: 2, arpWave: 'square', drums: 'pop', echo: 0 },
  fast: { level: 0.55, label: 'Fast', bpm: 140, beats: 4, prog: ['Am', 'F', 'C', 'G'], pad: ['sawtooth'], padGain: 0.018, bass: 4, arp: 4, arpWave: 'square', drums: 'drive', echo: 0 },
  spiritual: { level: 1.6, label: 'Spiritual', bpm: 52, beats: 4, prog: ['C', 'F', 'C', 'G', 'Am', 'F', 'G', 'C'], organ: true, padGain: 0.05, bell: 0.5, echo: 0.42 },
  nostalgic: { level: 2.8, label: 'Nostalgic', bpm: 76, beats: 4, prog: ['Am', 'F', 'C', 'G'], pad: ['sine'], padGain: 0.03, piano: true, echo: 0.3 },
};

export function music(ac, out, seconds, style) {
  const S_ = STYLES[style] || STYLES.calm, beat = 60 / S_.bpm, bar = beat * S_.beats, start = ac.currentTime + 0.12;
  const master = ac.createGain(); master.gain.value = 0.0001; master.connect(out);
  master.gain.setTargetAtTime(0.9 * (S_.level || 1), start, 0.8); // styles leveled to about the same loudness
  master.gain.setTargetAtTime(0.0001, start + Math.max(1, seconds - 2.5), 0.8);
  const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = S_.drums ? 3200 : 1600; tone.connect(master);
  let into = tone;
  if (S_.echo) { // a soft echo, like a room
    const d = ac.createDelay(1), fb = ac.createGain(), wet = ac.createGain();
    d.delayTime.value = Math.min(0.6, beat * 0.75); fb.gain.value = S_.echo; wet.gain.value = 0.35;
    const dry = ac.createGain(); dry.connect(tone); dry.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(tone);
    into = dry;
  }
  let noise = null;
  const noiseBuf = () => { if (noise) return noise; noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noise; };
  const note = (f, t, len, gain, wave = 'sine', attack = 0.02, dest = into) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = wave; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + len + 0.05);
  };
  const kick = (t) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.32); };
  const hiss = (t, hp, len, gain) => { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuf(); f.type = 'highpass'; f.frequency.value = hp; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + len + 0.02); };
  const playBar = (i, t0) => {
    const name = S_.prog[i % S_.prog.length], ch = CH[name].map(N);
    if (S_.organ) { // hymn organ: each chord tone with its octave and fifth, slow to swell
      ch.forEach((f) => [[1, 1], [2, 0.4], [3, 0.18]].forEach(([m, w]) => note(f * m, t0, bar + 0.3, S_.padGain * w, 'sine', 0.6)));
    } else (S_.pad || []).forEach((w, j) => ch.slice(0, 3).forEach((f) => note(f * (j ? 0.5 : 1), t0, bar + 0.3, S_.padGain, w, 0.5)));
    if (S_.bell) for (let n = 0; n < 3; n++) if (Math.random() < S_.bell) note(ch[(n + i) % 4] * 4, t0 + n * (bar / 3), 1.6, 0.03, 'sine', 0.01);
    if (S_.piano) [0, 1, 2, 3, 2, 1, 2, 3].forEach((k, n) => note(ch[k] * 2, t0 + n * (bar / 8), 1.2, 0.05, 'triangle', 0.005));
    if (S_.bass) for (let n = 0; n < S_.beats * (S_.bass / 2); n++) note(ch[0] / 2, t0 + n * (beat * 2 / S_.bass), beat * 0.9, 0.12, 'triangle', 0.01);
    if (S_.arp) { const steps = S_.beats * S_.arp; for (let n = 0; n < steps; n++) note(ch[[0, 1, 2, 3, 2, 1][n % 6]] * 2, t0 + n * (bar / steps), (bar / steps) * 0.9, 0.025, S_.arpWave, 0.005); }
    for (let b = 0; b < S_.beats; b++) {
      const t = t0 + b * beat;
      if (S_.drums === 'pop') { if (b % 2 === 0) kick(t); else hiss(t, 1500, 0.16, 0.22); hiss(t, 7000, 0.05, 0.08); hiss(t + beat / 2, 7000, 0.05, 0.06); }
      if (S_.drums === 'drive') { kick(t); if (b % 2) hiss(t, 1500, 0.14, 0.24); hiss(t + beat / 2, 7000, 0.05, 0.09); }
    }
  };
  // Schedule a couple of seconds ahead at a time.
  let i = 0, next = start, stopped = false;
  const fill = () => { if (stopped) return; while (next < ac.currentTime + 2.5 && next < start + seconds) { playBar(i++, next); next += bar; } };
  fill();
  const timer = setInterval(fill, 500);
  return () => { stopped = true; clearInterval(timer); master.gain.cancelScheduledValues(ac.currentTime); master.gain.setTargetAtTime(0.0001, ac.currentTime, 0.15); };
}

// ───────── the player ─────────
export async function openYearVideo(app) {
  const st = app.state, now = new Date();
  const years = [now.getFullYear(), now.getFullYear() - 1];
  let year = now.getMonth() <= 1 ? years[1] : years[0]; // in January and February, last year is the one to look back on
  const tint = theme(st.circle?.theme).light.tint;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saved = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let length = Number(saved('oc-yr-length', '180')), wide = saved('oc-yr-shape', 'tv') === 'tv', style = saved('oc-yr-music', 'calm');
  if (style !== 'off' && !STYLES[style]) style = 'calm';
  let stopMusic = null;
  if (!LENGTHS.includes(length)) length = 180;
  const seg = (name, opts, on) => `<div class="seg yr-seg" role="radiogroup" aria-label="${name}" data-on="${on}" style="--n:${opts.length}">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(v) === String(on)}" data-${name.toLowerCase()}="${v}">${l}</button>`).join('')}</div>`;
  const wrap = document.createElement('div');
  wrap.className = 'yr-wrap';
  wrap.innerHTML = `<div class="yr" role="dialog" aria-modal="true" aria-label="Year in review">
    <div class="yr-top">
      <label class="sr" for="yr-year">Year</label>
      <select id="yr-year" class="select-pill">${years.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <span class="grow"></span>
      <label class="sr" for="yr-music">Music</label>
      <select id="yr-music" class="select-pill" aria-label="Music">${[...Object.entries(STYLES).map(([k, v]) => [k, '♪ ' + v.label]), ['off', 'No music']].map(([k, l]) => `<option value="${k}" ${k === style ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="icon-btn" data-x aria-label="Close">${icon('x')}</button>
    </div>
    <div class="yr-opts">
      ${seg('Length', LENGTHS.map((v) => [v, `${v / 60} min`]), length)}
      ${seg('Shape', [['tv', 'TV'], ['phone', 'Phone']], wide ? 'tv' : 'phone')}
    </div>
    <div class="yr-stage"><canvas aria-label="Year in review video"></canvas><p class="yr-status" aria-live="polite"></p></div>
    <div class="yr-actions">
      <button class="btn ghost" data-play>${icon('next', 16)} Play</button>
      <button class="btn ghost" data-full>${icon('expand', 16)} Full screen</button>
      <button class="btn" data-save>${icon('download', 16)} Save video</button>
    </div>
    <details class="yr-help"><summary>Watch it on your TV</summary>
      <p><b>Best: save it first.</b> Tap Save video, then on iPhone choose <b>Save Video</b> to put it in Photos. Open it in Photos, tap the AirPlay icon and pick your Apple TV or AirPlay TV. It plays smoothly at full quality, and anyone in the room can watch it again later.</p>
      <p><b>Play it straight from here:</b> on iPhone, open Control Center, tap <b>Screen Mirroring</b> and pick your TV, then turn your phone sideways and tap Full screen or Play. On Android, use <b>Cast</b> or <b>Smart View</b> from the quick settings. On a computer, plug into the TV or use Chrome's <b>Cast</b>, then Full screen.</p>
      <p>Anyone in the family can make and play this video. Pick <b>TV</b> for a television and <b>Phone</b> for a video to text.</p>
    </details>
  </div>`;
  document.body.appendChild(wrap);
  const canvas = wrap.querySelector('canvas'), ctx = canvas.getContext('2d'), status = wrap.querySelector('.yr-status');
  const playBtn = wrap.querySelector('[data-play]'), saveBtn = wrap.querySelector('[data-save]'), fullBtn = wrap.querySelector('[data-full]');
  let show = null, raf = 0, ac = null, recording = null, alive = true, nowT = 0;
  const env = { tint, imgs: new Map(), still, clock: 0, tainted: false };
  const years_ = new Map(); // what happened, per year (fetched once)

  const prepare = async () => {
    cancelAnimationFrame(raf); playBtn.disabled = saveBtn.disabled = true;
    setShape(wide); canvas.width = W; canvas.height = H; canvas.style.aspectRatio = `${W} / ${H}`;
    wrap.querySelector('.yr').classList.toggle('wide', wide);
    status.textContent = 'Gathering your year…';
    if (!years_.has(year)) years_.set(year, await gather(app, year));
    const data = years_.get(year);
    show = plan(app, year, data, length);
    const urls = [...new Set([...show.slides.filter((s) => s.kind === 'photo').map((s) => s.url), ...show.slides.map((s) => s.bgUrl).filter(Boolean), ...Object.values(st.members).map((m) => m.photo && safeUrl(m.photo)).filter(Boolean)])].filter((u) => !env.imgs.has(u));
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
    const runs = `${mins ? mins + ' min ' : ''}${secs ? secs + ' sec' : ''}`.trim();
    status.textContent = !(data.albums.length || data.days.length) ? `Nothing from ${year} yet. Share albums and add big days, and they'll show up here.`
      : show.total < length - 20 ? `${runs}. That's everything from ${year} so far; add more albums for a longer video.` : runs;
    playBtn.disabled = false; saveBtn.disabled = env.tainted;
    frame(Math.min(2, show.total - 0.01)); // show the title, not a blank screen, until Play
    if (env.tainted) status.textContent += '. Saving needs a one-time setting (see the Our Circle setup guide).';
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
    stopMusic?.(); stopMusic = null;
    if (style !== 'off') { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); stopMusic = music(ac, recording?.audioOut || ac.destination, show.total, style); }
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= show.total) { nowT = show.total - 0.01; frame(nowT); playBtn.innerHTML = `${icon('next', 16)} Play again`; onEnd?.(); resolve(); return; }
      nowT = t; frame(t); raf = requestAnimationFrame(tick);
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
    if (style !== 'off') {
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
  // Picking a style plays a few seconds of it, so it can be heard before the video starts.
  wrap.querySelector('#yr-music').addEventListener('change', (e) => {
    style = e.target.value; keep('oc-yr-music', style);
    cancelAnimationFrame(raf); stopMusic?.(); stopMusic = null;
    if (style !== 'off' && !recording) { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); stopMusic = music(ac, ac.destination, 8, style); }
  });
  wrap.querySelector('.yr-opts').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || recording) return;
    if (b.dataset.length) { length = Number(b.dataset.length); keep('oc-yr-length', String(length)); }
    else if (b.dataset.shape) { wide = b.dataset.shape === 'tv'; keep('oc-yr-shape', b.dataset.shape); }
    else return;
    const g = b.closest('.seg'); g.dataset.on = b.dataset.length || b.dataset.shape;
    g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    prepare();
  });
  // Full screen: the video fills the whole screen on iPhone too (where web pages can't use the browser's own
  // full screen). It lays itself out to the screen's exact shape as the phone is held: tall when upright, wide
  // when sideways, with no black bars, and keeps playing as the phone turns. With rotation lock on, "Sideways"
  // turns it to fill the screen sideways. Tap the screen for the buttons.
  const stage = wrap.querySelector('.yr-stage');
  const bar = document.createElement('div');
  bar.className = 'yr-fullbar';
  bar.innerHTML = `<button type="button" data-turn>${icon('refresh', 18)} <span>Sideways</span></button><button type="button" data-again aria-label="Play again">${icon('next', 18)} Play again</button><button type="button" data-exit aria-label="Exit full screen">${icon('x', 18)}</button>`;
  let inFull = false, hideBar = 0, lockFull = null, sideways = false;
  const fit = () => {
    if (!inFull) { canvas.style.width = canvas.style.height = canvas.style.transform = ''; return; }
    const vw = innerWidth, vh = innerHeight, upright = vh > vw, turned = sideways && upright;
    const sw = turned ? vh : vw, sh = turned ? vw : vh; // the screen as the viewer sees it
    const land = sw > sh, ratio = Math.min(2.4, Math.max(sw, sh) / Math.min(sw, sh));
    const w = land ? Math.round(1080 * ratio) : 1080, h = land ? 1080 : Math.round(1080 * ratio);
    if (w !== W || h !== H || land !== WIDE) {
      setShape(land, w, h); canvas.width = w; canvas.height = h;
      canvas.style.opacity = '0'; requestAnimationFrame(() => { canvas.style.opacity = '1'; });
      frame(nowT);
    }
    canvas.style.width = `${sw}px`; canvas.style.height = `${sh}px`;
    canvas.style.transform = turned ? 'rotate(90deg)' : '';
    bar.classList.toggle('turned', turned);
    const tb = bar.querySelector('[data-turn]'); tb.hidden = !upright; tb.querySelector('span').textContent = turned ? 'Upright' : 'Sideways';
  };
  const refit = () => { fit(); setTimeout(fit, 250); }; // phones report the new size a moment after turning
  const flashBar = (stay) => { bar.classList.add('on'); clearTimeout(hideBar); if (!stay) hideBar = setTimeout(() => bar.classList.remove('on'), 3500); };
  const enterFull = async () => {
    if (inFull || !show || playBtn.disabled) return;
    inFull = true; sideways = false; wrap.classList.add('yr-theater'); stage.appendChild(bar);
    const go = wrap.requestFullscreen || wrap.webkitRequestFullscreen; // computers, Android and iPad; not iPhone
    if (go) { try { await go.call(wrap); } catch (e) {} }
    try { lockFull = await navigator.wakeLock?.request('screen'); } catch (e) {}
    refit();
    flashBar();
    play(() => flashBar(true));
  };
  const exitFull = () => {
    if (!inFull) return;
    inFull = false; cancelAnimationFrame(raf); stopMusic?.(); stopMusic = null;
    wrap.classList.remove('yr-theater'); bar.remove(); lockFull?.release?.(); lockFull = null;
    setShape(wide); canvas.width = W; canvas.height = H; fit(); frame(nowT);
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    playBtn.innerHTML = `${icon('next', 16)} Play`;
  };
  fullBtn.addEventListener('click', enterFull);
  bar.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-exit]')) exitFull();
    else if (e.target.closest('[data-turn]')) { sideways = !sideways; fit(); flashBar(); }
    else if (e.target.closest('[data-again]')) { flashBar(); play(() => flashBar(true)); }
  });
  stage.addEventListener('click', () => { if (inFull) flashBar(); });
  addEventListener('resize', refit);
  const onFs = () => { if (inFull && !(document.fullscreenElement || document.webkitFullscreenElement) && (wrap.requestFullscreen || wrap.webkitRequestFullscreen)) exitFull(); };
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
  const close = () => { alive = false; exitFull(); cancelAnimationFrame(raf); stopMusic?.(); ac?.close?.(); removeEventListener('resize', refit); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); wrap.remove(); };
  wrap.addEventListener('click', (e) => { if (inFull) return; if (e.target === wrap || e.target.closest('[data-x]')) close(); });
  document.addEventListener('keydown', function esc(e) { if (!alive) { document.removeEventListener('keydown', esc); return; } if (e.key === 'Escape') { if (inFull) exitFull(); else close(); } });
  wrap.yr = { frame: (t) => frame(t), slides: () => show?.slides || [] }; // for checking frames while testing
  prepare();
}
