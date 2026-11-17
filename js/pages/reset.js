// #/forgot (guest): request a reset email. #/new-password (public): set a new password after the recovery link.
import { sb } from '../supabase.js';
import { html, raw } from '../utils.js';
import { icon, fieldError, toast } from '../ui.js';
import { setTitle } from '../shell.js';
import { afterSignIn } from '../main.js';
import { authAside, authTop, passwordField, bindPasswordToggles, strengthMeter, bindStrength, authSubmit } from './login.js';

const I = (n, c) => raw(icon(n, c));
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default async function render({ view, path, alive }) {
  if (path === '/new-password') return renderNew(view, alive);
  return renderForgot(view);
}

function shell(view, inner, quote) {
  view.innerHTML = String(html`<div class="auth">
    <div class="auth__panel"><div class="auth__form" id="rs-root">${inner}</div></div>
    ${authAside({ quote })}
  </div>`);
  return view.querySelector('#rs-root');
}

function renderForgot(view) {
  setTitle('Відновлення пароля');
  const root = shell(view, html`<form class="stack stack--lg" id="rs-form" novalidate>
    ${authTop()}
    <div class="stack stack--xs">
      <h1 class="h1">Забули пароль?</h1>
      <p class="muted">Вкажіть email акаунта — надішлемо посилання, щоб створити новий пароль.</p>
    </div>
    <div class="field">
      <label class="label" for="rs-email">Email</label>
      <input class="input" id="rs-email" name="email" type="email" required autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="olena@gmail.com">
    </div>
    <button class="btn btn--primary btn--lg btn--block" type="submit"><span>Надіслати посилання</span></button>
    <div class="alert">${I('info')}<div><p class="alert__title">Учні: попросіть вчителя скинути пароль</p>Учні входять за логіном, без email. Вчитель може видати тимчасовий пароль у вашій картці.</div></div>
    <p class="text-sm muted pub-center">Згадали? <a class="link-btn" href="#/login">Повернутися до входу</a></p>
  </form>`, 'Буває з кожним. Новий пароль — за хвилину.');

  const form = root.querySelector('#rs-form');
  form.email.focus({ preventScroll: true });
  authSubmit(form, async (v) => {
    if (!v.email.includes('@')) { fieldError(form, 'email', 'Це схоже на логін учня. Учням пароль скидає вчитель.'); return; }
    if (!emailOk(v.email)) { fieldError(form, 'email', 'Перевірте email: наприклад, name@gmail.com'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(v.email.toLowerCase(), { redirectTo: location.origin + location.pathname });
    if (error) {
      if (/rate|seconds|too many/i.test(error.message || '')) throw new Error('Лист уже надіслано. Зачекайте хвилину перед повторною спробою.');
      throw new Error('Не вдалося надіслати лист. Спробуйте ще раз.');
    }
    root.innerHTML = String(html`<div class="stack stack--lg">
      ${authTop()}
      <div class="pub-done">
        <span class="pub-done__icon">${I('mail', 'icon--lg')}</span>
        <h1 class="h1">Перевірте пошту</h1>
        <p class="muted">Якщо акаунт з адресою <b class="pub-ink">${v.email}</b> існує, ми надіслали посилання для нового пароля. Лист може йти кілька хвилин — загляньте і в «Спам».</p>
      </div>
      <a class="btn btn--secondary btn--lg btn--block" href="#/login">Повернутися до входу</a>
    </div>`);
    return true;
  });
}

async function renderNew(view, alive) {
  setTitle('Новий пароль');
  const root = shell(view, html`<div class="stack" aria-busy="true"><span class="skeleton skeleton--title" style="width:60%"></span><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--block" style="height:120px"></span><span class="sr-only" role="status">Завантаження…</span></div>`, 'Новий пароль — і знову до уроків.');
  const { data: { session } } = await sb.auth.getSession();
  if (!alive()) return;

  if (!session) {
    root.innerHTML = String(html`<div class="stack stack--lg">
      ${authTop()}
      <div class="pub-done">
        <span class="pub-done__icon pub-done__icon--warn">${I('alert', 'icon--lg')}</span>
        <h1 class="h1">Посилання не спрацювало</h1>
        <p class="muted">Можливо, воно застаріло або вже було використане. Попросіть нове — це займе хвилину.</p>
      </div>
      <a class="btn btn--primary btn--lg btn--block" href="#/forgot">Надіслати нове посилання</a>
      <a class="btn btn--ghost btn--block" href="#/login">До входу</a>
    </div>`);
    return;
  }

  root.innerHTML = String(html`<form class="stack stack--lg" id="np-form" novalidate>
    ${authTop()}
    <div class="stack stack--xs">
      <h1 class="h1">Створіть новий пароль</h1>
      <p class="muted">Для акаунта <b class="pub-ink">${session.user.email || ''}</b></p>
    </div>
    <input type="text" name="username" autocomplete="username" value="${session.user.email || ''}" hidden>
    <div class="stack">
      <div class="stack stack--sm">
        ${passwordField({ id: 'np-pw1', label: 'Новий пароль', autocomplete: 'new-password', minlength: 8, placeholder: 'Щонайменше 8 символів' })}
        ${strengthMeter('np-strength')}
      </div>
      ${passwordField({ id: 'np-pw2', name: 'confirm', label: 'Повторіть пароль', autocomplete: 'new-password', minlength: 8 })}
    </div>
    <button class="btn btn--primary btn--lg btn--block" type="submit"><span>Зберегти пароль</span></button>
  </form>`);
  bindPasswordToggles(view);
  const form = root.querySelector('#np-form');
  bindStrength(form.password, root.querySelector('#np-strength'));
  form.password.focus({ preventScroll: true });
  authSubmit(form, async () => {
    const pw = form.password.value;
    if (pw.length < 8) { fieldError(form, 'password', 'Пароль має містити щонайменше 8 символів'); form.password.focus(); return; }
    if (pw !== form.confirm.value) { fieldError(form, 'confirm', 'Паролі не збігаються'); form.confirm.focus(); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) {
      if (/different from the old|same/i.test(error.message || '')) { fieldError(form, 'password', 'Новий пароль має відрізнятися від старого'); return; }
      if (/session|jwt|expired/i.test(error.message || '')) throw new Error('Посилання застаріло. Попросіть нове на сторінці «Забули пароль?».');
      throw new Error('Не вдалося зберегти пароль. Спробуйте ще раз.');
    }
    toast('Пароль змінено');
    await afterSignIn();
    return true;
  });
}
