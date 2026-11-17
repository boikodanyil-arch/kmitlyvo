import { TIMEZONE } from './config.js';

/** Escape text for safe interpolation into HTML. ALWAYS use for user data. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v == null || v === false) out += '';
      else if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.html : esc(x))).join('');
      else if (v && v.__raw) out += v.html;
      else out += esc(v);
    }
  });
  return { __raw: true, html: out, toString() { return out; } };
}
export function raw(str) { return { __raw: true, html: String(str ?? ''), toString() { return this.html; } }; }

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Safe URL: only http(s). */
export function safeUrl(u) {
  try { const x = new URL(String(u)); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; }
}

// ---------- dates (always shown in Europe/Warsaw) ----------
const fmt = (opts) => new Intl.DateTimeFormat('uk-UA', { timeZone: TIMEZONE, ...opts });
export const fmtTime = (d) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const fmtDate = (d) => fmt({ day: 'numeric', month: 'long' }).format(new Date(d));
export const fmtDateShort = (d) => fmt({ day: 'numeric', month: 'short' }).format(new Date(d));
export const fmtWeekday = (d) => fmt({ weekday: 'long' }).format(new Date(d));
export const fmtWeekdayShort = (d) => fmt({ weekday: 'short' }).format(new Date(d));
export const fmtDateTime = (d) => `${fmtDate(d)}, ${fmtTime(d)}`;
export const fmtFullDate = (d) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d));

/** Parts of a date in Warsaw time: {y,m,d,h,min,wd} (wd: 1=Mon..7=Sun) */
export function zonedParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  const wdMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: wdMap[p.weekday] };
}
/** 'YYYY-MM-DD' key of a date in Warsaw time */
export function dayKey(d) { const p = zonedParts(d); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }

/** Convert a Warsaw wall-clock (YYYY-MM-DD, HH:MM) to a UTC Date, DST-safe. */
export function fromZoned(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    const diff = asUtc - Date.UTC(y, m - 1, d, hh, mm);
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}
/** Add days to a 'YYYY-MM-DD' string */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function todayKey() { return dayKey(new Date()); }
/** Monday of the week containing dateStr */
export function weekStart(dateStr) {
  const wd = zonedParts(fromZoned(dateStr, '12:00')).wd;
  return addDays(dateStr, 1 - wd);
}
/** Value for <input type=time> from a Date in Warsaw time */
export function timeInputValue(d) { const p = zonedParts(d); return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`; }

/** Human relative label: «сьогодні», «завтра», «вчора», «через 3 дні», «2 дні тому» */
export function relDay(d) {
  const a = dayKey(new Date()); const b = dayKey(d);
  const diff = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  if (diff === 0) return 'сьогодні';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчора';
  if (diff > 1) return `через ${diff} ${plural(diff, 'день', 'дні', 'днів')}`;
  return `${-diff} ${plural(-diff, 'день', 'дні', 'днів')} тому`;
}
export function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}
export function dueLabel(due) {
  if (!due) return 'без дедлайну';
  return `до ${fmtDateShort(due)}, ${fmtTime(due)}`;
}
export const isOverdue = (t) => t.due_at && ['assigned', 'returned'].includes(t.status) && new Date(t.due_at) < new Date();

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
}
export function money(v, cur = '₴') {
  const n = Number(v || 0);
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ${cur}`;
}
/** Transliterate Ukrainian name to a login suggestion */
export function suggestLogin(name) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'yu', я: 'ya', "'": '', 'ʼ': '' };
  const parts = name.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const tr = (s) => Array.from(s).map((c) => (map[c] ?? (/[a-z0-9]/.test(c) ? c : ''))).join('');
  let login = parts.length > 1 ? `${tr(parts[0])}.${tr(parts[1]).slice(0, 1)}` : tr(parts[0] || 'student');
  if (login.length < 3) login = (login + 'stud').slice(0, 6);
  return login + Math.floor(10 + Math.random() * 89);
}
export const LEVELS = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export function uid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }
export function fileSafeName(name) {
  const dot = name.lastIndexOf('.');
  const ext = dot > -1 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}
