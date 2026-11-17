// #/activate?code= — a student activates the personal invite from their teacher.
// Step 1: code → lookup. Step 2: see your login, create a password.
import { callSignup } from '../supabase.js';
import { html, raw } from '../utils.js';
import { icon, fieldError, clearErrors, copyText } from '../ui.js';
import { setTitle } from '../shell.js';
import { authAside, authTop, passwordField, bindPasswordToggles, strengthMeter, bindStrength, authSubmit, signInAndGo } from './login.js';

const I = (n, c) => raw(icon(n, c));

export default async function render({ view, query }) {
  setTitle('Активація акаунта');
  let info = null; // { full_name, login, space, code }

  view.innerHTML = String(html`<div class="auth pub-activate">
    <div class="auth__panel"><div class="auth__form" id="act-root"></div></div>
    ${authAside({ quote: 'Твої уроки, домашні й прогрес — у телефоні.', points: ['Розклад уроків і посилання на дзвінок', 'Домашні: фото зошита за 10 секунд', 'Квізи з миттєвою перевіркою'] })}
  </div>`);
  const root = view.querySelector('#act-root');
  bindPasswordToggles(view);

  const steps = (n) => html`<div class="pub-steps"><div class="steps" aria-hidden="true"><span class="steps__item ${n > 1 ? 'steps__item--done' : 'steps__item--current'}"></span><span class="steps__item ${n === 2 ? 'steps__item--current' : ''}"></span></div><span class="text-xs muted">Крок ${n} з 2</span></div>`;

  function step1(code = '', error = '') {
    root.innerHTML = String(html`<form class="stack stack--lg" id="act-code" novalidate>
      ${authTop()}
      ${steps(1)}
      <div class="stack stack--xs">
        <h1 class="h1">Привіт! Активуймо твій акаунт</h1>
        <p class="muted">Введи код запрошення, який надіслав вчитель. Він виглядає приблизно так: <b class="pub-mono">K7P2QX</b></p>
      </div>
      <div class="field">
        <label class="label" for="act-code-in">Код запрошення</label>
        <input class="input pub-code-input pub-code-input--xl" id="act-code-in" name="code" required autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="20" value="${code}" placeholder="КОД">
      </div>
      <button class="btn btn--primary btn--lg btn--block" type="submit"><span>Далі</span>${I('arrowRight')}</button>
      <div class="auth__divider">або</div>
      <p class="text-sm muted pub-center">Уже активував(ла)? <a class="link-btn" href="#/login">Увійти з логіном</a></p>
      <p class="text-sm muted pub-center">Немає коду? Попроси вчителя надіслати запрошення.</p>
    </form>`);
    const form = root.querySelector('#act-code');
    const input = form.code;
    if (error) fieldError(form, 'code', error);
    input.addEventListener('input', () => { const p = input.selectionStart; input.value = input.value.toUpperCase().replace(/\s+/g, ''); input.setSelectionRange(p, p); });
    if (!code) input.focus({ preventScroll: true });
    authSubmit(form, async (v) => {
      const c = (v.code || '').toUpperCase().replace(/\s+/g, '');
      if (!c) { fieldError(form, 'code', 'Введи код із запрошення'); input.focus(); return; }
      try {
        const res = await callSignup({ action: 'lookup', type: 'student', code: c });
        info = { ...res, code: c };
        step2();
        return true;
      } catch (err) {
        if (/звʼязку/.test(err.message)) throw err;
        fieldError(form, 'code', 'Код не знайдено або його вже використано. Перевір написання або попроси вчителя новий код.');
        input.focus(); input.select();
      }
    });
  }

  function step2() {
    const first = String(info.full_name || '').trim().split(/\s+/)[0] || '';
    root.innerHTML = String(html`<form class="stack stack--lg" id="act-pw" novalidate>
      ${authTop()}
      ${steps(2)}
      <div class="stack stack--xs">
        <h1 class="h1">Вітаємо, ${first || info.full_name}!</h1>
        <p class="muted">${info.space ? html`Вчитель: <b class="pub-ink">${info.space}</b>` : 'Ти майже на місці.'}</p>
      </div>
      <div class="pub-login-card" role="group" aria-labelledby="act-login-l">
        <p class="pub-login-card__label" id="act-login-l">${I('user', 'icon--sm')}Твій логін для входу</p>
        <div class="pub-login-card__row">
          <span class="pub-login-card__value" id="act-login">${info.login}</span>
          <button class="btn btn--secondary btn--sm" type="button" data-copy>${I('copy', 'icon--sm')}<span>Копіювати</span></button>
        </div>
        <p class="pub-login-card__hint">Запиши або збережи його: логін не змінюється. Входити будеш з ним і паролем, який створиш зараз.</p>
      </div>
      <input type="text" name="username" autocomplete="username" value="${info.login}" hidden>
      <div class="stack">
        <div class="stack stack--sm">
          ${passwordField({ id: 'act-pw1', label: 'Придумай пароль', autocomplete: 'new-password', minlength: 8, placeholder: 'Щонайменше 8 символів' })}
          ${strengthMeter('act-strength')}
        </div>
        ${passwordField({ id: 'act-pw2', name: 'confirm', label: 'Повтори пароль', autocomplete: 'new-password', minlength: 8 })}
      </div>
      <button class="btn btn--primary btn--lg btn--block" type="submit"><span>Створити пароль і увійти</span></button>
      <button class="btn btn--ghost btn--block" type="button" data-back>${I('arrowLeft', 'icon--sm')}Інший код</button>
    </form>`);
    const form = root.querySelector('#act-pw');
    bindStrength(form.password, root.querySelector('#act-strength'));
    root.querySelector('[data-copy]').addEventListener('click', () => copyText(info.login, 'Логін скопійовано'));
    root.querySelector('[data-back]').addEventListener('click', () => step1(''));
    form.password.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    authSubmit(form, async () => {
      clearErrors(form);
      const pw = form.password.value; const pw2 = form.confirm.value;
      if (pw.length < 8) { fieldError(form, 'password', 'Пароль має містити щонайменше 8 символів'); form.password.focus(); return; }
      if (pw !== pw2) { fieldError(form, 'confirm', 'Паролі не збігаються'); form.confirm.focus(); return; }
      try {
        const res = await callSignup({ action: 'activate_student', activation_code: info.code, password: pw });
        try { localStorage.setItem('kmitlyvo.lastLogin', res.login || info.login); } catch { /* ignore */ }
        await signInAndGo(res.email, pw);
        return true;
      } catch (err) {
        if (/код запрошення/i.test(err.message)) { step1(info.code, err.message); return; }
        throw err;
      }
    });
  }

  step1((query.code || '').toUpperCase());
  if (query.code) root.querySelector('#act-code').requestSubmit();
}
