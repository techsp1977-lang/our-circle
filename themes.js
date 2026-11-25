// Circle colors. Each circle picks one of twelve colors, or a two-tone pair (circles/{cid}.theme). The app's accent follows it,
// and every household gets its own shade of that color, so the Family tab and each chat read as one family.
// All colors are worked out here so white text on a household shade, and the accent as text, always stay
// easy to read (at least 4.5:1, the accessibility bar).

export const THEMES = [
  { key: 'evergreen', label: 'Green', h: 155, s: 33 },
  { key: 'teal', label: 'Teal', h: 178, s: 60 },
  { key: 'ocean', label: 'Blue', h: 210, s: 70 },
  { key: 'navy', label: 'Navy', h: 226, s: 50 },
  { key: 'plum', label: 'Purple', h: 270, s: 40 },
  { key: 'berry', label: 'Berry', h: 318, s: 50 },
  { key: 'rose', label: 'Pink', h: 342, s: 62 },
  { key: 'crimson', label: 'Red', h: 356, s: 66 },
  { key: 'orange', label: 'Orange', h: 22, s: 88 },
  { key: 'amber', label: 'Gold', h: 40, s: 85 },
  { key: 'cocoa', label: 'Brown', h: 25, s: 32 },
  { key: 'slate', label: 'Gray', h: 215, s: 14 },
];
// Two-tone circle colors (school and team style colors, named by color only). The app's accent is the first color;
// households alternate between shades of both. Light shades (white, cream, gold, orange) get dark text: `ink`.
const TWO_TONE = [
  { key: 'scarlet', label: 'Scarlet & Gray', tint: '#BB0000', dark: '#FF6B6B', darkText: '#FF9090', ink: '#2B0000',
    shades: [['#BB0000', 'Scarlet'], ['#666666', 'Gray'], ['#8E0A0A', 'Deep scarlet'], ['#45494E', 'Charcoal'], ['#CC1F26', 'Bright scarlet'], ['#6A6F75', 'Silver gray'], ['#A3241D', 'Brick'], ['#565C64', 'Slate']] },
  { key: 'royal', label: 'Royal & White', tint: '#0047BA', dark: '#6E9BFF', darkText: '#9CBBFF', ink: '#0B2A5C',
    shades: [['#0047BA', 'Royal'], ['#EEF2F8', 'White'], ['#002E5D', 'Navy'], ['#DCE5F2', 'Pearl'], ['#1B5FD1', 'Bright royal'], ['#F7F9FC', 'Snow'], ['#003A8C', 'Deep royal'], ['#C9D6EA', 'Silver blue']] },
  { key: 'crimsoncream', label: 'Crimson & Cream', tint: '#9E1B32', dark: '#FF7A8E', darkText: '#FF9DAC', ink: '#4A0D18',
    shades: [['#9E1B32', 'Crimson'], ['#F3E9D2', 'Cream'], ['#7A1426', 'Deep crimson'], ['#E6D6B0', 'Sand'], ['#B8233D', 'Bright crimson'], ['#F8F1E2', 'Ivory'], ['#5E1020', 'Wine'], ['#DCC9A0', 'Wheat']] },
  { key: 'greengold', label: 'Green & Gold', tint: '#1E5631', dark: '#6FCF8C', darkText: '#8FDBA6', ink: '#3A2A00',
    shades: [['#1E5631', 'Forest'], ['#FFC72C', 'Gold'], ['#2E7D45', 'Green'], ['#F2B300', 'Deep gold'], ['#154025', 'Pine'], ['#FFD866', 'Bright gold'], ['#3B6E4A', 'Sage'], ['#E0A800', 'Old gold']] },
  { key: 'navyorange', label: 'Navy & Orange', tint: '#0C2340', dark: '#7FA6E0', darkText: '#A3C0EA', ink: '#3A1800',
    shades: [['#0C2340', 'Navy'], ['#E8650E', 'Orange'], ['#1D3A63', 'Blue navy'], ['#F28C38', 'Light orange'], ['#05162B', 'Midnight'], ['#C4520A', 'Burnt orange'], ['#2E4E7E', 'Steel navy'], ['#F9A65A', 'Peach']] },
];
TWO_TONE.forEach((t) => THEMES.push({ key: t.key, label: t.label, two: t }));
export const DEFAULT_THEME = 'evergreen';

// Household shade keys are the same in every color, so a household keeps its place when the circle's color changes.
const SHADES = [
  ['forest', 'Classic', 0, 0, 0], ['emerald', 'Bright', 5, 14, 4], ['sage', 'Soft', 0, -24, 4], ['moss', 'Warm', -11, 0, -3],
  ['teal', 'Cool', 11, 0, -2], ['pine', 'Deep', 0, 0, -12], ['fern', 'Fresh', -6, 8, 7], ['olive', 'Dusky', 14, -18, -7],
];
// The original greens, kept exactly so circles made before colors look the same.
const EVERGREEN_SHADES = ['#2F5D4A', '#0B7A55', '#4F6F58', '#5B6B1F', '#17675F', '#1F4F3F', '#3E7A2E', '#6A6A2A'];

// ───────── color math ─────────
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const WHITE = [255, 255, 255], DARK_BG = [28, 28, 30];
const rgba = (c, a) => `rgba(${c.join(', ')}, ${a})`;
const rgb = (c) => `rgb(${c.join(' ')})`;
// Darken (or lighten) until the color meets the contrast goal against `other`.
function until(h, s, l, other, goal, step) { let c = hsl(h, s, l); while (contrast(c, other) < goal && l > 2 && l < 98) { l += step; c = hsl(h, s, l); } return c; }

const cache = new Map();
export function theme(key) {
  const t = THEMES.find((x) => x.key === key) || THEMES[0];
  if (cache.has(t.key)) return cache.get(t.key);
  let out;
  const unhex = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  if (t.two) {
    const T = t.two, dt = unhex(T.dark);
    // dark-mode text on the accent: the darkest of the theme's own colors that reads well on it
    out = { light: { tint: unhex(T.tint), text: unhex(T.tint), on: WHITE }, dark: { tint: dt, text: unhex(T.darkText), on: contrast(dt, [12, 12, 14]) >= 4.5 ? [12, 12, 14] : WHITE },
      shades: T.shades.map(([c]) => c), labels: T.shades.map(([, l]) => l), ink: T.ink, swatch2: T.shades[1][0] };
  } else if (t.key === 'evergreen') {
    out = { light: { tint: [47, 93, 74], text: [47, 93, 74], on: WHITE }, dark: { tint: [98, 180, 141], text: [122, 201, 162], on: [8, 28, 20] }, shades: EVERGREEN_SHADES };
  } else {
    const lt = until(t.h, t.s, 46, WHITE, 5, -1);                        // white text on it, and it as text on white
    const dt = until(t.h, Math.min(t.s, 62), 56, DARK_BG, 6, 1);          // a light accent for dark mode
    const dx = until(t.h, Math.min(t.s, 70), 66, DARK_BG, 8, 1);          // accent-colored words in dark mode
    const shades = SHADES.map(([, , dh, ds, dl]) => hex(until(t.h + dh, t.s + ds, 40 + dl, WHITE, 4.6, -1)));
    out = { light: { tint: lt, text: lt, on: WHITE }, dark: { tint: dt, text: dx, on: hsl(t.h, 45, 9) }, shades };
  }
  out.key = t.key; out.label = t.label; out.swatch = hex(out.light.tint); out.swatch2 = out.swatch2 || null;
  cache.set(t.key, out);
  return out;
}

// The shades for households in the current circle (same keys as before colors existed).
// Each shade also says what color text reads on it (white, or the theme's dark ink on light shades), and gives
// light shades an edge so a white bubble still shows on a white page.
export function shades(key) {
  const t = theme(key), sh = t.shades;
  return SHADES.map(([k, label], i) => {
    const value = sh[i], light = contrast(unhexColor(value), WHITE) < 4.5;
    return { key: k, label: t.labels?.[i] || label, value, light, ink: light ? (t.ink || '#111') : '#fff', edge: light ? hex(t.light.tint) : 'transparent' };
  });
}
const unhexColor = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));

let current = DEFAULT_THEME;
export const currentTheme = () => current;

// Paint the app in this circle's color (light and dark). Called whenever the circle loads or its color changes.
export function applyTheme(key) {
  const t = theme(key);
  current = t.key;
  const vars = (m) => `--tint: ${rgb(m.tint)}; --tint-text: ${rgb(m.text)}; --on-tint: ${rgb(m.on)}; --tint-soft: ${rgba(m.tint, 0.13)};`;
  let el = document.getElementById('oc-theme');
  if (!el) { el = document.createElement('style'); el.id = 'oc-theme'; document.head.appendChild(el); }
  el.textContent = `:root { ${vars(t.light)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${vars(t.dark)} } }
:root[data-theme="dark"] { ${vars(t.dark)} }`;
}
