/**
 * Tiny hash router. Routes look like '#/t/students/:id'.
 * register(pattern, { load, title, area }) where load() returns a module with default export render(view, params, query).
 * area: 'public' | 'staff' | 'student' | 'any'
 */
const routes = [];
let beforeEach = null;
let notFound = null;

export function route(pattern, opts) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '\\/?$');
  routes.push({ pattern, re, keys, ...opts });
}
export function onBeforeEach(fn) { beforeEach = fn; }
export function onNotFound(fn) { notFound = fn; }

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path: path || '/', query };
}

export function match(path) {
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (replace) { history.replaceState(null, '', target); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

export function currentPath() { return parseHash().path; }

let resolving = 0;
export async function resolve() {
  const ticket = ++resolving;
  const { path, query } = parseHash();
  const found = match(path);
  if (!found) { if (notFound) await notFound(path); return; }
  if (beforeEach) {
    const redirect = await beforeEach(found.route, found.params, path);
    if (ticket !== resolving) return;
    if (redirect && redirect !== path) { navigate(redirect, { replace: true }); return; }
  }
  if (ticket !== resolving) return;
  await found.route.render(found.params, query, path, () => ticket === resolving);
}

export function start() {
  window.addEventListener('hashchange', () => resolve());
  return resolve();
}
