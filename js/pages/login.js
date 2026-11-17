// #/login — one form for everyone: email (teachers) or login (students) + password.
// Also exports small helpers shared by the other auth pages (signup, join, activate, reset).
import { sb } from '../supabase.js';
import { STUDENT_EMAIL_DOMAIN } from '../config.js';
import { html, raw } from '../utils.js';
import { icon, brand, fieldError, clearErrors, setLoading, formValues, toastError } from '../ui.js';
import { setTitle } from '../shell.js';
import { afterSignIn } from '../main.js';

const I = (n, c) => raw(icon(n, c));

// ---------------------------------------------------------------- shared helpers

/** Brand panel shown on the right of auth screens (hidden ≤ 900px). */
export function authAside({ quote, points = [], note = '' } = {}) {
  return html`<aside class="auth__aside pub-aside" aria-hidden="true">
    <div class="pub-aside__top">${brand({ tag: false, beta: true, href: '#/' })}</div>
    <div class="pub-aside__chalk">
      <span class="pub-aside__line pub-aside__line--1">Present Perfect</span>
      <span class="pub-aside__line pub-aside__line--2">I <u>have been</u> to London.</span>
      <span class="pub-aside__line pub-aside__line--3">✓ 7 / 8</span>
    </div>
    <p class="auth__quote">${quote}</p>
    ${points.length ? html`<ul class="pub-aside__points">${points.map((p) => html`<li>${I('check', 'icon--sm')}<span>${p}</span></li>`)}</ul>` : ''}
    ${note ? html`<p class="pub-aside__note">${note}</p>` : ''}
  </aside>`;
}

/** Top row of an auth form: brand + optional back link to the landing page. */
export function authTop() {
  return html`<div class="pub-auth-top">${brand({ large: true, tag: false })}<a class="link-btn pub-auth-top__home" href="#/" aria-label="На головну">${I('arrowLeft', 'icon--sm')}<span class="pub-auth-top__txt">На головну</span></a></div>`;
}

/** Password input with show/hide toggle. */
export function passwordField({ id, name = 'password', label = 'Пароль', autocomplete = 'current-password', hint = '', minlength = 0, placeholder = '' }) {
  return html`<div class="field">
    <label class="label" for="${id}">${label}</label>
    <div class="input-wrap input-wrap--action">
      <input class="input" id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required ${minlength ? raw(`minlength="${minlength}"`) : ''} placeholder="${placeholder}" ${hint ? raw(`aria-describedby="${id}-hint"`) : ''}>
      <button class="btn btn--ghost btn--icon input-wrap__action" type="button" data-pw-toggle="${id}" aria-label="Показати пароль" aria-pressed="false">${I('eye')}</button>
    </div>
    ${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
  </div>`;
}

/** Wire every [data-pw-toggle] inside root. */
export function bindPasswordToggles(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pw-toggle]');
    if (!btn || !root.contains(btn)) return;
    const input = root.querySelector(`#${btn.dataset.pwToggle}`);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Сховати пароль' : 'Показати пароль');
    btn.innerHTML = icon(show ? 'eyeOff' : 'eye');
  });
}

/** Password strength 0..3 with label. */
export function passwordStrength(pw = '') {
  if (!pw) return { score: 0, label: '' };
  if (pw.length < 8) return { score: 0, label: 'Закороткий: щонайменше 8 символів' };
  let s = 1;
  if (pw.length >= 12) s++;
  if (/[a-zа-яії]/.test(pw) && /[A-ZА-ЯІЇ]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^\w\s]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^\w\s]/.test(pw)) s = Math.max(s, 2);
  const score = Math.min(3, s);
  return { score, label: ['', 'Можна надійніше: додайте цифри або довшу фразу', 'Нормальний пароль', 'Надійний пароль'][score] };
}

/** Strength meter markup, updated by bindStrength. */
export function strengthMeter(id) {
  return html`<div class="pub-strength" id="${id}" data-score="0" aria-live="polite"><span class="pub-strength__bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="pub-strength__label"></span></div>`;
}
export function bindStrength(input, meter) {
  const upd = () => {
    const { score, label } = passwordStrength(input.value);
    meter.dataset.score = input.value ? String(score) : '0';
    meter.dataset.filled = input.value ? '1' : '';
    meter.querySelector('.pub-strength__label').textContent = label;
  };
  input.addEventListener('input', upd);
  upd();
}

/** Turn a login-or-email identifier into the auth email. */
export function identifierToEmail(id) {
  const v = String(id || '').trim();
  return v.includes('@') ? v.toLowerCase() : `${v.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
}

/** Sign in after a successful signup/activation; falls back to the login page on failure. */
export async function signInAndGo(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    toastError(new Error('Акаунт створено, але не вдалося увійти автоматично. Увійдіть вручну.'));
    location.hash = '#/login';
    return;
  }
  await afterSignIn();
}

/** Simple async submit wrapper for auth forms (keeps button in loading state on success, since we navigate away). */
export function authSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    clearErrors(form);
    setLoading(btn, true);
    let keep = false;
    try { keep = (await handler(formValues(form), form)) === true; } catch (err) { toastError(err); }
    if (!keep && btn.isConnected) setLoading(btn, false);
  });
}

// ---------------------------------------------------------------- page

export default async function render({ view, query }) {
  setTitle('Вхід');
  view.innerHTML = String(html`<div class="auth">
    <div class="auth__panel">
      <form class="auth__form" id="login-form" novalidate>
        ${authTop()}
        <div class="stack stack--xs">
          <h1 class="h1">Вхід</h1>
          <p class="muted">Вчителі входять через email, учні — через логін від вчителя.</p>
        </div>
        <div class="stack">
          <div class="field">
            <label class="label" for="login-id">Email або логін</label>
            <input class="input" id="login-id" name="identifier" type="text" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required placeholder="olena@gmail.com або maria.k24" value="${query.login || ''}">
          </div>
          ${passwordField({ id: 'login-pw' })}
          <div class="pub-row-end"><a class="link-btn" href="#/forgot">Забули пароль?</a></div>
        </div>
        <button class="btn btn--primary btn--lg btn--block" type="submit"><span>Увійти</span></button>
        <div class="auth__divider">вперше тут?</div>
        <ul class="pub-links">
          <li><a class="pub-link" href="#/activate">${I('sparkles')}<span><b>Є код запрошення від вчителя?</b><small>Учні: активуйте акаунт і створіть пароль</small></span>${I('chevronRight', 'icon--sm')}</a></li>
          <li><a class="pub-link" href="#/join">${I('school')}<span><b>Вчитель школи?</b><small>Приєднайтеся за кодом школи</small></span>${I('chevronRight', 'icon--sm')}</a></li>
          <li><a class="pub-link" href="#/signup">${I('star')}<span><b>Отримати бета-доступ</b><small>Створіть простір репетитора або школи</small></span>${I('chevronRight', 'icon--sm')}</a></li>
        </ul>
      </form>
    </div>
    ${authAside({ quote: 'Уроки, учні й домашні — в одному спокійному місці.', points: ['Розклад і нагадування', 'Домашні з фото та квізи', 'Баланс оплат кожного учня'] })}
  </div>`);

  const form = view.querySelector('#login-form');
  bindPasswordToggles(view);
  if (!query.login) form.identifier.focus({ preventScroll: true }); else form.password.focus({ preventScroll: true });

  authSubmit(form, async (v) => {
    let bad = false;
    if (!v.identifier) { fieldError(form, 'identifier', 'Вкажіть email або логін'); bad = true; }
    if (!form.password.value) { fieldError(form, 'password', 'Введіть пароль'); bad = true; }
    if (bad) return;
    const email = identifierToEmail(v.identifier);
    const { error } = await sb.auth.signInWithPassword({ email, password: form.password.value });
    if (error) {
      const msg = error.message || '';
      if (/invalid login|invalid credentials|invalid grant/i.test(msg) || error.status === 400) {
        fieldError(form, 'password', v.identifier.includes('@') ? 'Невірний email або пароль' : 'Невірний логін або пароль');
        form.password.focus();
        return;
      }
      if (/fetch|network/i.test(msg)) throw new Error('Немає звʼязку з сервером. Перевірте інтернет.');
      if (/rate|too many/i.test(msg)) throw new Error('Забагато спроб. Зачекайте хвилину і спробуйте ще раз.');
      throw new Error('Не вдалося увійти. Спробуйте ще раз.');
    }
    await afterSignIn();
    return true;
  });
}
