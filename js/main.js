import { route, onBeforeEach, onNotFound, start, navigate, resolve } from './router.js';
import { state, loadSession, loadContext, isStaff, isStudent, isAdmin, isSchool, resetState } from './state.js';
import { sb } from './supabase.js';
import { shellPage, unmountShell, setTitle } from './shell.js';
import { pageSkeleton, errorState, emptyState, icon } from './ui.js';
import { html, raw } from './utils.js';

// ---- theme ----
try { const t = localStorage.getItem('kmitlyvo.theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }

const app = document.getElementById('app');
export const home = () => (isStudent() ? '/s' : isStaff() ? '/t' : '/');

/**
 * area: 'public' (no shell, available to everyone), 'guest' (only when logged out),
 *       'staff', 'student', 'user' (any logged-in user, with shell)
 * file: module in ./pages exporting default async render({ view, params, query, path, alive })
 */
const ROUTES = [
  ['/', 'public', 'landing'],
  ['/login', 'guest', 'login'],
  ['/signup', 'guest', 'signup'],
  ['/join', 'guest', 'join'],
  ['/activate', 'guest', 'activate'],
  ['/forgot', 'guest', 'reset'],
  ['/new-password', 'public', 'reset'],
  ['/t', 'staff', 't-dashboard'],
  ['/t/students', 'staff', 't-students'],
  ['/t/students/:id', 'staff', 't-student'],
  ['/t/calendar', 'staff', 't-calendar'],
  ['/t/lessons/:id', 'staff', 't-lesson'],
  ['/t/assignments', 'staff', 't-assignments'],
  ['/t/assignments/new', 'staff', 't-assignment-new'],
  ['/t/assignments/:id', 'staff', 't-assignment'],
  ['/t/review', 'staff', 't-review'],
  ['/t/review/:id', 'staff', 't-review-item'],
  ['/t/payments', 'staff', 't-payments'],
  ['/t/school', 'staff', 't-school'],
  ['/s', 'student', 's-home'],
  ['/s/tasks', 'student', 's-tasks'],
  ['/s/tasks/:id', 'student', 's-task'],
  ['/s/schedule', 'student', 's-schedule'],
  ['/s/progress', 'student', 's-progress'],
  ['/settings', 'user', 'settings'],
  ['/more', 'staff', null],
];

const cache = {};
async function loadPage(file) {
  if (!cache[file]) cache[file] = import(`./pages/${file}.js`);
  return (await cache[file]).default;
}

for (const [pattern, area, file] of ROUTES) {
  route(pattern, {
    area,
    async render(params, query, path, alive) {
      let view;
      if (area === 'public' || area === 'guest') {
        unmountShell();
        app.innerHTML = '';
        view = app;
      } else {
        view = shellPage(path);
        view.innerHTML = String(pageSkeleton());
      }
      try {
        if (!file) { renderMore(view); return; }
        const render = await loadPage(file);
        if (!alive()) return;
        if (area !== 'public' && area !== 'guest') view.innerHTML = '';
        await render({ view, params, query, path, alive });
      } catch (err) {
        console.error(err);
        if (alive()) { setTitle('Помилка'); view.innerHTML = String(errorState(err?.message)); }
      }
      if (area !== 'public' && area !== 'guest') document.getElementById('main')?.focus({ preventScroll: true });
    },
  });
}

onBeforeEach(async (r, params, path) => {
  if (!state.ready) await loadSession();
  const logged = !!state.user;
  if (r.area === 'guest' && logged && state.role) return home();
  if (['staff', 'student', 'user'].includes(r.area) && !logged) return '/login';
  if (logged && !state.role && r.area !== 'public' && r.area !== 'guest') return '/';
  if (r.area === 'staff' && !isStaff()) return home();
  if (r.area === 'student' && !isStudent()) return home();
  if (path === '/t/school' && !(isAdmin() && isSchool())) return '/t';
  return null;
});

onNotFound(async () => {
  unmountShell();
  setTitle('Сторінку не знайдено');
  app.innerHTML = String(html`<div class="auth"><div class="auth__panel"><div class="auth__form">${emptyState({ icon: 'search', title: 'Такої сторінки немає', text: 'Можливо, посилання застаріло.', action: html`<a class="btn btn--primary" href="#${home()}">На головну</a>` })}</div></div></div>`);
});

function renderMore(view) {
  setTitle('Ще');
  const items = [
    ['#/t/assignments', 'clipboard', 'Завдання', 'Створення та призначення'],
    ['#/t/payments', 'wallet', 'Оплати', 'Баланс уроків і борги'],
    ...(isAdmin() && isSchool() ? [['#/t/school', 'school', 'Школа', 'Вчителі, учні, коди запрошень']] : []),
    ['#/settings', 'settings', 'Налаштування', 'Профіль, пароль, демо-дані'],
  ];
  view.innerHTML = String(html`<div class="page-header"><div class="page-header__titles"><h1 class="h1">Ще</h1></div></div>
    <ul class="list list--card">${raw(items.map(([h, ic, t, m]) => `<li><a class="list-row" href="${h}"><span class="list-row__lead">${icon(ic)}</span><span class="list-row__body"><span class="list-row__title">${t}</span><span class="list-row__meta">${m}</span></span><span class="list-row__trail">${icon('chevronRight')}</span></a></li>`).join(''))}</ul>`);
}

// ---- auth events ----
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') { navigate('/new-password'); return; }
  if (event === 'SIGNED_OUT') { resetState(); state.ready = true; unmountShell(); return; }
  if (event === 'SIGNED_IN' && session && state.ready && !signingIn && state.user?.id !== session.user.id) {
    state.user = session.user;
    setTimeout(async () => { await loadContext(); unmountShell(); resolve(); }, 0);
  }
});

/** Called by login/signup pages after a successful sign-in. */
let signingIn = false;
export async function afterSignIn() {
  signingIn = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    state.user = session?.user ?? null;
    await loadContext();
    state.ready = true;
    unmountShell();
    navigate(home(), { replace: true });
  } finally { setTimeout(() => { signingIn = false; }, 500); }
}

// Retry links in error states
document.addEventListener('click', (e) => { if (e.target.closest('[data-reload]')) { e.preventDefault(); resolve(); } });

(async () => {
  try { await loadSession(); } catch (e) { console.error(e); state.ready = true; }
  if ((!location.hash || location.hash === '#/' || location.hash === '#') && state.user && state.role) history.replaceState(null, '', '#' + home());
  await start();
})();
