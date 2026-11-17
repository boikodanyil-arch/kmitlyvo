// App shell: sidebar (desktop), topbar + tabbar (mobile), feedback button.
import { state, isAdmin, isSchool, signOut, switchSpace } from './state.js';
import { esc, html, raw } from './utils.js';
import { icon, brand, brandMark, avatar, openModal, toast, toastError, setLoading } from './ui.js';
import { sendFeedback } from './api.js';
import { navigate } from './router.js';

const app = () => document.getElementById('app');

function staffNav() {
  const items = [
    { href: '#/t', icon: 'home', label: 'Головна', match: /^\/t\/?$/ },
    { href: '#/t/calendar', icon: 'calendar', label: 'Розклад', match: /^\/t\/(calendar|lessons)/ },
    { href: '#/t/students', icon: 'users', label: 'Учні', match: /^\/t\/students/ },
    { href: '#/t/assignments', icon: 'clipboard', label: 'Завдання', match: /^\/t\/assignments/ },
    { href: '#/t/review', icon: 'inbox', label: 'Перевірка', match: /^\/t\/review/, countKey: 'review' },
    { href: '#/t/payments', icon: 'wallet', label: 'Оплати', match: /^\/t\/payments/ },
  ];
  if (isSchool() && isAdmin()) items.push({ href: '#/t/school', icon: 'school', label: 'Школа', match: /^\/t\/school/, group: 'Школа' });
  return items;
}
function studentNav() {
  return [
    { href: '#/s', icon: 'home', label: 'Головна', match: /^\/s\/?$/ },
    { href: '#/s/tasks', icon: 'clipboard', label: 'Завдання', match: /^\/s\/tasks/, countKey: 'tasks' },
    { href: '#/s/schedule', icon: 'calendar', label: 'Розклад', match: /^\/s\/schedule/ },
    { href: '#/s/progress', icon: 'trophy', label: 'Прогрес', match: /^\/s\/progress/ },
  ];
}
/** Tab bar (max 5): staff gets Головна, Розклад, Учні, Перевірка, Ще(menu) */
function tabItems(nav) {
  if (state.role === 'student') return [...nav, { href: '#/settings', icon: 'user', label: 'Профіль', match: /^\/settings/ }];
  const pick = ['#/t', '#/t/calendar', '#/t/students', '#/t/review'];
  return [...nav.filter((n) => pick.includes(n.href)), { href: '#/more', icon: 'menu', label: 'Ще', match: /^\/(more|t\/assignments|t\/payments|t\/school|settings)/ }];
}

export const counts = { review: 0, tasks: 0 };

function roleLabel() {
  return { owner: isSchool() ? 'Власник школи' : 'Репетитор', admin: 'Адміністратор', teacher: 'Вчитель', student: 'Учень' }[state.role] || '';
}

let mounted = false;

/** Render the shell (once) and return the page container. */
export function mountShell() {
  const nav = state.role === 'student' ? studentNav() : staffNav();
  const name = state.profile?.full_name || 'Користувач';
  const spaces = state.memberships;
  app().innerHTML = String(html`
    <a class="skip-link" href="#main">Перейти до змісту</a>
    <div class="app">
      <aside class="sidebar">
        <div class="sidebar__brand">${brand({ href: state.role === 'student' ? '#/s' : '#/t' })}</div>
        ${spaces.length > 1 ? html`<div class="field" style="padding:0 var(--s-3) var(--s-3)"><label class="sr-only" for="space-switch">Простір</label>
          <select class="select" id="space-switch">${raw(spaces.map((m) => `<option value="${m.space_id}"${m.space_id === state.space?.id ? ' selected' : ''}>${esc(m.space.name)}</option>`).join(''))}</select></div>`
          : html`<p class="nav__label">${state.space?.name || ''}</p>`}
        <nav class="nav" aria-label="Головне меню">
          ${raw(nav.map((n) => `${n.group ? `<p class="nav__label">${esc(n.group)}</p>` : ''}<a class="nav__item" href="${n.href}" data-nav="${n.href}">${icon(n.icon)}<span class="nav__label-text">${esc(n.label)}</span>${n.countKey ? `<span class="nav__count" data-count="${n.countKey}" hidden></span>` : ''}</a>`).join(''))}
        </nav>
        <div class="sidebar__footer">
          <a class="nav__item" href="#/settings" data-nav="#/settings">${raw(icon('settings'))}<span class="nav__label-text">Налаштування</span></a>
          <div class="sidebar__school">
            ${avatar(name, 'sm')}
            <div class="grow"><div class="fw-600 truncate">${name}</div><div class="text-xs muted">${roleLabel()}</div></div>
            <button class="btn btn--ghost btn--icon btn--sm" type="button" aria-label="Вийти" data-logout>${raw(icon('logout'))}</button>
          </div>
        </div>
      </aside>

      <header class="topbar">
        <a class="brand" href="${state.role === 'student' ? '#/s' : '#/t'}" aria-label="Кмітливо, на головну">${brandMark()}</a>
        <a href="#/settings" aria-label="Профіль і налаштування">${avatar(name, 'sm')}</a>
      </header>

      <main class="main" id="main" tabindex="-1"><div class="page" id="page"></div></main>

      <nav class="tabbar" aria-label="Головне меню">
        ${raw(tabItems(nav).map((n) => `<a class="tabbar__item" href="${n.href}" data-nav="${n.href}"><span class="tabbar__icon">${icon(n.icon)}${n.countKey ? `<span class="tabbar__dot" data-dot="${n.countKey}" hidden></span>` : ''}</span>${esc(n.label)}</a>`).join(''))}
      </nav>

      <button class="feedback-fab" type="button" data-feedback>${raw(icon('feedback'))}<span class="feedback-fab__label">Відгук</span></button>
    </div>
    <div class="toast-region" aria-live="polite"></div>`);

  const root = app();
  root.querySelector('[data-logout]').addEventListener('click', async () => { await signOut(); unmountShell(); navigate('/login'); });
  root.querySelector('[data-feedback]').addEventListener('click', openFeedback);
  root.querySelector('#space-switch')?.addEventListener('change', (e) => { switchSpace(e.target.value); unmountShell(); navigate(state.role === 'student' ? '/s' : '/t'); });
  root._navItems = [...nav, ...tabItems(nav), { href: '#/settings', match: /^\/settings/ }];
  mounted = true;
  return root.querySelector('#page');
}
export function unmountShell() { mounted = false; }
export function isShellMounted() { return mounted && !!document.getElementById('page'); }

/** Ensure shell exists and highlight the active nav. Returns the page container (cleared). */
export function shellPage(path) {
  const page = isShellMounted() ? document.getElementById('page') : mountShell();
  const root = app();
  root.querySelectorAll('[data-nav]').forEach((a) => {
    const item = root._navItems.find((n) => n.href === a.dataset.nav);
    const active = item?.match?.test(path);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Replace the container so listeners bound by the previous page are dropped.
  const fresh = page.cloneNode(false);
  fresh.className = 'page';
  page.replaceWith(fresh);
  window.scrollTo(0, 0);
  return fresh;
}

/** Update nav counters, e.g. setCount('review', 5) */
export function setCount(key, n) {
  counts[key] = n;
  document.querySelectorAll(`[data-count="${key}"]`).forEach((el) => { el.textContent = n; el.hidden = !n; });
  document.querySelectorAll(`[data-dot="${key}"]`).forEach((el) => { el.hidden = !n; });
}

export function setTitle(t) { document.title = t ? `${t} · Кмітливо` : 'Кмітливо'; }

function openFeedback() {
  const { dialog, close } = openModal({
    title: 'Відгук про бета-версію',
    body: `<form class="form" id="fb-form">
      <p class="muted">Що незручно, що зламалось, чого не вистачає? Пишіть як є, кожен відгук читаємо.</p>
      <div class="field"><label class="label" for="fb-msg">Ваш відгук</label>
        <textarea class="textarea" id="fb-msg" name="message" rows="5" required maxlength="4000" placeholder="Наприклад: не зрозуміла, як перенести урок на інший день"></textarea>
        <p class="hint">Ми автоматично додамо сторінку, на якій ви зараз.</p></div>
    </form>`,
    foot: '<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="submit" form="fb-form">Надіслати</button>',
  });
  const form = dialog.querySelector('#fb-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.message.value.trim();
    if (!msg) { form.message.focus(); return; }
    const btn = dialog.querySelector('[type="submit"]');
    setLoading(btn, true);
    try { await sendFeedback(msg, location.hash || '#/'); close(); toast('Дякуємо! Відгук надіслано'); } catch (err) { toastError(err); setLoading(btn, false); }
  });
}
