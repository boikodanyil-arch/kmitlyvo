// Кмітливо — icon set
// 24×24 stroke icons, 1.75 stroke, round caps/joins, colored by currentColor.
// Usage:
//   import { icon, icons } from './assets/icons.js';
//   el.innerHTML = `<button class="btn btn--icon" aria-label="Редагувати">${icon('edit')}</button>`;
// icon() output is decorative (aria-hidden). Always label the control that contains it.

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const P = {
  // Navigation
  home: '<path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.5 9v10.2c0 .4.4.8.8.8H10v-5.5h4V20h3.7c.4 0 .8-.4.8-.8V9"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.8 19.5c.6-3.3 3.1-5.2 6.2-5.2s5.6 1.9 6.2 5.2"/><path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4"/><path d="M17.6 14.6c2 .6 3.3 2.3 3.7 4.9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17h2"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11c.6 0 1 .4 1 1v15c0-.8-.7-1.5-1.5-1.5h-5C4.7 18.5 4 17.8 4 17z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13c-.6 0-1 .4-1 1v15c0-.8.7-1.5 1.5-1.5h5c.8 0 1.5-.7 1.5-1.5z"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5V4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v.5c0 .6-.4 1-1 1h-4c-.6 0-1-.4-1-1z"/><path d="m9 13 2 2 4-4.5"/>',
  inbox: '<path d="M3.5 13.5 6 5.6c.2-.6.7-1.1 1.4-1.1h9.2c.7 0 1.2.5 1.4 1.1l2.5 7.9"/><path d="M3.5 13.5V18c0 1.1.9 2 2 2h13c1.1 0 2-.9 2-2v-4.5H15.5a3.5 3.5 0 0 1-7 0z"/>',
  wallet: '<path d="M18 7.5V6c0-1.1-.9-2-2-2H5.5A2 2 0 0 0 3.5 6v12c0 1.1.9 2 2 2h13c1.1 0 2-.9 2-2v-8.5c0-1.1-.9-2-2-2H5.5"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor" stroke="none"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.6c.2-.5.3-1.1.3-1.6v-2c0-.5-.1-1.1-.3-1.6l1.6-1.5-2-3.4-2.1.7a7.7 7.7 0 0 0-2.7-1.6L13.8 1.5h-3.6l-.4 2.1a7.7 7.7 0 0 0-2.7 1.6l-2.1-.7-2 3.4 1.6 1.5c-.2.5-.3 1.1-.3 1.6v2c0 .5.1 1.1.3 1.6L3 16.1l2 3.4 2.1-.7c.8.7 1.7 1.2 2.7 1.6l.4 2.1h3.6l.4-2.1c1-.4 1.9-.9 2.7-1.6l2.1.7 2-3.4z"/>',
  logout: '<path d="M14 4.5h3.5c1.1 0 2 .9 2 2v11c0 1.1-.9 2-2 2H14"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  school: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v5c1.5 1.6 3.4 2.5 5.5 2.5s4-.9 5.5-2.5v-5"/><path d="M21.5 9v5.5"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 15v-3M12 15V8M16 15v-5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',

  // Actions
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 5-5.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  xCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V5c0-.6.4-1 1-1h3c.6 0 1 .4 1 1v2"/><path d="M6 7l.9 12.1c.1 1 .9 1.9 2 1.9h6.2c1.1 0 1.9-.8 2-1.9L18 7"/><path d="M10 11v6M14 11v6"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v7.5c0 1.1.9 2 2 2h2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.2M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>',
  upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3"/>',
  download: '<path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5"/><path d="M4 15v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3"/>',
  camera: '<path d="M4 8.5c0-1.1.9-2 2-2h1.8l1.4-2h5.6l1.4 2H18c1.1 0 2 .9 2 2V18c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="m20.5 15.5-4.6-4.6a1 1 0 0 0-1.4 0L6.5 19.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  file: '<path d="M14 3.5H7c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-10z"/><path d="M14 3.5v5h5"/><path d="M9 13h6M9 16.5h4"/>',
  paperclip: '<path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.1-8.2a3.3 3.3 0 0 1 4.7 4.7l-8 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>',
  send: '<path d="M20.5 3.5 10 14"/><path d="m20.5 3.5-6.5 17-4-6.5-6.5-4z"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.1-4M8.2 13.2l7.1 4"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 5.6 7M4 12.5A8 8 0 0 0 18.4 17"/><path d="M5 3.5V7.5h4M19 20.5v-4h-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2h4"/>',

  // Direction
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  chevronUp: '<path d="m6 14.5 6-6 6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',

  // Objects & status
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  video: '<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="m15.5 10.5 5.5-3v9l-5.5-3"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z"/>',
  sparkles: '<path d="M10 4.5c.6 3.5 2 5 5.5 5.5-3.5.6-4.9 2-5.5 5.5-.6-3.5-2-4.9-5.5-5.5 3.5-.5 4.9-2 5.5-5.5z"/><path d="M17.5 14c.3 1.8 1 2.5 2.5 2.8-1.5.3-2.2 1-2.5 2.7-.3-1.7-1-2.4-2.5-2.7 1.5-.3 2.2-1 2.5-2.8z"/>',
  message: '<path d="M20 12.5c0 3.9-3.6 7-8 7-1.2 0-2.3-.2-3.3-.6L4 20l1.2-3.6A6.6 6.6 0 0 1 4 12.5c0-3.9 3.6-7 8-7s8 3.1 8 7z"/>',
  feedback: '<path d="M4.5 5.5c0-1.1.9-2 2-2h11c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H10l-4.5 4v-4h-1z"/><path d="M8.5 8.5h7M8.5 11.5h4.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  alert: '<path d="M10.3 4.4 2.9 17.3c-.8 1.3.2 3 1.7 3h14.8c1.5 0 2.5-1.7 1.7-3L13.7 4.4c-.8-1.3-2.6-1.3-3.4 0z"/><path d="M12 9.5v4"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  trophy: '<path d="M7.5 4.5h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6.5H4.5c0 2.5 1.2 4 3.3 4.3M16.5 6.5h3c0 2.5-1.2 4-3.3 4.3"/><path d="M12 14v3.5M8.5 20.5h7M9.5 20.5c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3"/>',
  flame: '<path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.9-3.3-6-4.3-9.7-2.4 1.6-3.2 3.7-3.2 5.5-1-.6-1.8-1.7-2-3C6.8 9.6 6 11.8 6 15.2 6 18.6 8.4 21 12 21z"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  coins: '<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 16.4c.6 1.2 2.8 2.1 5.5 2.1 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.8-2.2-4.3-2.4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
};

export const icons = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, svg(v)]));

/**
 * Returns an inline SVG string with class="icon {cls}".
 * Unknown names return an empty string and warn once in the console.
 */
const warned = new Set();
export function icon(name, cls = '') {
  const body = P[name];
  if (!body) {
    if (!warned.has(name)) { warned.add(name); console.warn(`[icons] unknown icon: ${name}`); }
    return '';
  }
  return svg(body).replace('<svg ', `<svg class="icon${cls ? ' ' + cls : ''}" `);
}

export const iconNames = Object.keys(P);
