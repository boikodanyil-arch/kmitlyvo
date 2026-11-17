// #/signup — create a tutor or school space with a beta access code.
import { callSignup } from '../supabase.js';
import { html, raw, debounce } from '../utils.js';
import { icon, fieldError } from '../ui.js';
import { setTitle } from '../shell.js';
import { authAside, authTop, passwordField, bindPasswordToggles, strengthMeter, bindStrength, authSubmit, signInAndGo } from './login.js';

const I = (n, c) => raw(icon(n, c));
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default async function render({ view, query }) {
  setTitle('Бета-доступ');
  const kind0 = query.kind === 'school' ? 'school' : 'tutor';
  view.innerHTML = String(html`<div class="auth">
    <div class="auth__panel">
      <form class="auth__form" id="signup-form" novalidate>
        ${authTop()}
        <div class="stack stack--xs">
          <h1 class="h1">Створіть свій простір</h1>
          <p class="muted">Бета працює за запрошеннями: потрібен код доступу, який ми надсилаємо учасникам особисто.</p>
        </div>

        <div class="stack stack--sm">
          <p class="label" id="kind-l">Хто ви?</p>
          <div class="auth__role pub-role-2" role="radiogroup" aria-labelledby="kind-l">
            <label class="role-card"><input type="radio" name="kind" value="tutor" ${kind0 === 'tutor' ? 'checked' : ''}><span>${I('user')}Репетитор<small class="pub-role-hint">Працюю сам(а)</small></span></label>
            <label class="role-card"><input type="radio" name="kind" value="school" ${kind0 === 'school' ? 'checked' : ''}><span>${I('school')}Онлайн-школа<small class="pub-role-hint">Кілька вчителів</small></span></label>
          </div>
        </div>

        <div class="stack">
          <div class="field">
            <label class="label" for="su-code">Код бета-доступу</label>
            <div class="input-wrap input-wrap--action">
              <input class="input pub-code-input" id="su-code" name="beta_code" required autocomplete="off" autocapitalize="characters" spellcheck="false" value="${query.code || ''}" aria-describedby="su-code-status">
              <span class="input-wrap__action pub-code-state" data-state="" aria-hidden="true"></span>
            </div>
            <p class="hint pub-code-status" id="su-code-status" aria-live="polite">Код є в листі-запрошенні.</p>
          </div>
          <div class="field">
            <label class="label" for="su-name">Ваше імʼя</label>
            <input class="input" id="su-name" name="full_name" required autocomplete="name" maxlength="80" placeholder="Олена Мельник">
          </div>
          <div class="field" data-for="school">
            <label class="label" for="su-space">Назва школи</label>
            <input class="input" id="su-space" name="space_name" maxlength="80" placeholder="English Hub" autocomplete="organization">
          </div>
          <div class="field" data-for="tutor">
            <label class="label" for="su-space-t">Назва вашого простору <span class="label__opt">(необовʼязково)</span></label>
            <input class="input" id="su-space-t" name="space_name_t" maxlength="80" placeholder="Англійська з Оленою" aria-describedby="su-space-t-hint">
            <p class="hint" id="su-space-t-hint">Учні бачитимуть цю назву. Можна змінити пізніше.</p>
          </div>
          <div class="field">
            <label class="label" for="su-email">Email</label>
            <input class="input" id="su-email" name="email" type="email" required autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="olena@gmail.com">
          </div>
          <div class="stack stack--sm">
            ${passwordField({ id: 'su-pw', autocomplete: 'new-password', minlength: 8, label: 'Пароль' })}
            ${strengthMeter('su-strength')}
          </div>
        </div>

        <button class="btn btn--primary btn--lg btn--block" type="submit"><span>Створити простір</span></button>
        <p class="text-sm muted pub-center">Уже є акаунт? <a class="link-btn" href="#/login">Увійти</a> · Вчитель школи? <a class="link-btn" href="#/join">Приєднатися</a></p>
      </form>
    </div>
    ${authAside({ quote: 'Перші 5 хвилин — і ваш розклад уже живий.', points: ['Створіть простір і додайте учнів', 'Учні отримують кабінет з телефона', 'Демо-дані, щоб усе спробувати одразу'], note: 'Бета безкоштовна. Ваші відгуки формують продукт.' })}
  </div>`);

  const form = view.querySelector('#signup-form');
  bindPasswordToggles(view);
  bindStrength(form.password, view.querySelector('#su-strength'));

  // ---- role switch
  const syncKind = () => {
    const k = form.kind.value;
    view.querySelectorAll('[data-for]').forEach((f) => { f.hidden = f.dataset.for !== k; });
    form.space_name.required = k === 'school';
    view.querySelector('#signup-form h1').textContent = k === 'school' ? 'Створіть простір школи' : 'Створіть свій простір';
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'kind') syncKind(); });
  syncKind();

  // ---- live beta-code check
  const codeInput = form.beta_code;
  const status = view.querySelector('#su-code-status');
  const stateEl = view.querySelector('.pub-code-state');
  let codeValid = null; let lastChecked = '';
  const setCodeState = (s, text) => {
    stateEl.dataset.state = s;
    stateEl.innerHTML = s === 'ok' ? icon('checkCircle') : s === 'bad' ? icon('xCircle') : s === 'loading' ? '<span class="spinner"></span>' : '';
    status.className = `hint pub-code-status${s === 'ok' ? ' pub-code-status--ok' : ''}`;
    status.textContent = text;
    const field = codeInput.closest('.field');
    field.classList.toggle('field--error', s === 'bad');
    codeInput.toggleAttribute('aria-invalid', s === 'bad');
  };
  const check = async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { codeValid = null; lastChecked = ''; setCodeState('', 'Код є в листі-запрошенні.'); return null; }
    if (code === lastChecked && codeValid !== null) return codeValid;
    setCodeState('loading', 'Перевіряємо код…');
    try {
      await callSignup({ action: 'lookup', type: 'beta', code });
      if (codeInput.value.trim().toUpperCase() !== code) return null;
      codeValid = true; lastChecked = code;
      setCodeState('ok', 'Код дійсний. Ласкаво просимо в бету!');
    } catch (err) {
      if (codeInput.value.trim().toUpperCase() !== code) return null;
      const net = /звʼязку/.test(err.message);
      codeValid = net ? null : false; lastChecked = net ? '' : code;
      setCodeState('bad', net ? err.message : 'Код недійсний або вже використаний. Перевірте написання.');
    }
    return codeValid;
  };
  const checkSoon = debounce(check, 450);
  codeInput.addEventListener('input', () => { codeValid = null; checkSoon(); });
  if (codeInput.value) check();

  authSubmit(form, async (v) => {
    const kind = form.kind.value;
    const spaceName = kind === 'school' ? v.space_name : v.space_name_t;
    let bad = false;
    if (!v.beta_code) { setCodeState('bad', 'Введіть код бета-доступу'); bad = true; }
    if (!v.full_name) { fieldError(form, 'full_name', 'Вкажіть, як до вас звертатися'); bad = true; }
    if (kind === 'school' && !spaceName) { fieldError(form, 'space_name', 'Вкажіть назву школи'); bad = true; }
    if (!emailOk(v.email)) { fieldError(form, 'email', 'Перевірте email: наприклад, name@gmail.com'); bad = true; }
    if (form.password.value.length < 8) { fieldError(form, 'password', 'Пароль має містити щонайменше 8 символів'); bad = true; }
    if (bad) { form.querySelector('[aria-invalid]')?.focus(); return; }
    if (v.beta_code && (await check()) === false) { codeInput.focus(); return; }

    const password = form.password.value;
    try {
      const res = await callSignup({ action: 'create_space', kind, space_name: spaceName, full_name: v.full_name, email: v.email.toLowerCase(), password, beta_code: v.beta_code.toUpperCase() });
      await signInAndGo(res.email || v.email.toLowerCase(), password);
      return true;
    } catch (err) {
      const m = err.message || '';
      if (/email вже існує/i.test(m)) { fieldError(form, 'email', 'Акаунт з таким email вже існує. Увійдіть.'); form.email.focus(); return; }
      if (/код доступу/i.test(m)) { codeValid = false; setCodeState('bad', 'Код недійсний або вичерпаний'); codeInput.focus(); return; }
      if (/email/i.test(m)) { fieldError(form, 'email', m); return; }
      throw err;
    }
  });
}
