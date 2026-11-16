// Date helpers. Dates are stored as plain "YYYY-MM-DD" strings in local time.
const DAY = 86400000;
export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toISO(d); };
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY); // b - a

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const monShort = (s) => MON[parse(s).getMonth()];
export const dayNum = (s) => parse(s).getDate();
export const weekday = (s) => WEEKDAY[parse(s).getDay()];
export const longDate = (s) => { const d = parse(s); return `${MONTH[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
export const shortDate = (s) => { const d = parse(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
export const dayOfYear = (s) => diffDays(`${s.slice(0, 4)}-01-01`, s) + 1;

// When does this event next happen, on or after `from`?
// Returns { start, end } as ISO strings, or null if it is over.
export function nextOccurrence(ev, from = today()) {
  if (!ev.date) return null;
  if (!ev.recurring) {
    const end = ev.endDate || ev.date;
    return end >= from ? { start: ev.date, end } : null;
  }
  const md = ev.date.slice(5);
  let y = Number(from.slice(0, 4));
  let start = fixLeap(`${y}-${md}`);
  if (start < from) start = fixLeap(`${y + 1}-${md}`);
  return { start, end: start };
}
function fixLeap(s) { return s.endsWith('-02-29') && parse(s).getMonth() !== 1 ? s.replace('-02-29', '-02-28') : s; }

export function yearsSince(ev, onDate) {
  if (!ev.recurring) return null;
  const n = Number(onDate.slice(0, 4)) - Number(ev.date.slice(0, 4));
  return n > 0 ? n : null;
}

export function whenText(start, from = today()) {
  const n = diffDays(from, start);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n < 60) return `in ${n} days`;
  const m = Math.round(n / 30.4);
  return m < 12 ? `in ${m} months` : 'in a year';
}

export function rangeText(ev) {
  if (!ev.endDate || ev.endDate === ev.date) return shortDate(ev.date);
  const a = parse(ev.date), b = parse(ev.endDate);
  return a.getMonth() === b.getMonth()
    ? `${MON[a.getMonth()]} ${a.getDate()}–${b.getDate()}`
    : `${shortDate(ev.date)} – ${shortDate(ev.endDate)}`;
}

export const ago = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
  return shortDate(toISO(new Date(ts)));
};
