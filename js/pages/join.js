// #/join?code= — a teacher joins an existing school with the school's invite code.
import { callSignup } from '../supabase.js';
import { html, raw, debounce } from '../utils.js';
import { icon, fieldError } from '../ui.js';
import { setTitle } from '../shell.js';
import { authAside, authTop, passwordField, bindPasswordToggles, strengthMeter, bindStrength, authSubmit, signInAndGo } from './login.js';

const I = (n, c) => raw(icon(n, c));
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default async function render({ view, query }) {
  setTitle('Приєднатися до школи');
  view.innerHTML = String(html`<div class="auth">
    <div class="auth__panel">
      <form class="auth__form" id="join-form" novalidate>
        ${authTop()}
        <div class="stack stack--xs">
          <h1 class="h1">Приєднатися до школи</h1>
          <p class="muted">Код школи дає адміністратор. Після входу ви побачите свій розклад і своїх учнів.</p>
        </div>

        <div class="stack">
          <div class="field">
            <label class="label" for="jn-code">Код школи</label>
            <div class="input-wrap input-wrap--action">
              <input class="input pub-code-input" id="jn-code" name="school_code" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="Наприклад, YXNFHKGA" value="${query.code || ''}" aria-describedby="jn-code-status">
              <span class="input-wrap__action pub-code-state" data-state="" aria-hidden="true"></span>
            </div>
            <p class="hint pub-code-status" id="jn-code-status" aria-live="polite">Введіть код, і ми покажемо назву школи.</p>
          </div>
          <div class="pub-found" id="jn-school" hidden></div>
          <div class="field">
            <label class="label" for="jn-name">Ваше імʼя</label>
            <input class="input" id="jn-name" name="full_name" required autocomplete="name" maxlength="80" placeholder="Ірина Савчук">
          </div>
          <div class="field">
            <label class="label" for="jn-email">Email</label>
            <input class="input" id="jn-email" name="email" type="email" required autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="iryna@gmail.com">
          </div>
          <div class="stack stack--sm">
            ${passwordField({ id: 'jn-pw', autocomplete: 'new-password', minlength: 8 })}
            ${strengthMeter('jn-strength')}
          </div>
        </div>

        <button class="btn btn--primary btn--lg btn--block" type="submit"><span>Приєднатися</span></button>
        <p class="text-sm muted pub-center">Уже маєте акаунт? <a class="link-btn" href="#/login">Увійти</a></p>
      </form>
    </div>
    ${authAside({ quote: 'Уся школа — один спільний розклад.', points: ['Ваші учні та уроки — окремо від колег', 'Домашні з фото й автоперевірка квізів', 'Адміністратор бачить загальну картину'] })}
  </div>`);

  const form = view.querySelector('#join-form');
  bindPasswordToggles(view);
  bindStrength(form.password, view.querySelector('#jn-strength'));

  const codeInput = form.school_code;
  const status = view.querySelector('#jn-code-status');
  const stateEl = view.querySelector('.pub-code-state');
  const found = view.querySelector('#jn-school');
  let school = null; let lastChecked = '';
  const setState = (s, text) => {
    stateEl.dataset.state = s;
    stateEl.innerHTML = s === 'ok' ? icon('checkCircle') : s === 'bad' ? icon('xCircle') : s === 'loading' ? '<span class="spinner"></span>' : '';
    status.className = `hint pub-code-status${s === 'ok' ? ' pub-code-status--ok' : ''}`;
    status.textContent = text;
    codeInput.closest('.field').classList.toggle('field--error', s === 'bad');
    codeInput.toggleAttribute('aria-invalid', s === 'bad');
  };
  const showSchool = (name) => {
    found.hidden = !name;
    found.innerHTML = name ? String(html`<span class="pub-found__icon">${I('school')}</span><span><small>Ви приєднуєтесь до школи</small><b>${name}</b></span>`) : '';
  };
  const check = async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { school = null; lastChecked = ''; showSchool(''); setState('', 'Введіть код, і ми покажемо назву школи.'); return null; }
    if (code === lastChecked && school) return school;
    setState('loading', 'Шукаємо школу…');
    try {
      const res = await callSignup({ action: 'lookup', type: 'school', code });
      if (codeInput.value.trim().toUpperCase() !== code) return null;
      school = res.name; lastChecked = code;
      setState('ok', 'Код дійсний');
      showSchool(school);
    } catch (err) {
      if (codeInput.value.trim().toUpperCase() !== code) return null;
      school = null; lastChecked = '';
      showSchool('');
      setState('bad', /звʼязку/.test(err.message) ? err.message : 'Школу з таким кодом не знайдено. Перевірте код в адміністратора.');
    }
    return school;
  };
  const checkSoon = debounce(check, 450);
  codeInput.addEventListener('input', () => { school = null; checkSoon(); });
  if (codeInput.value) check(); else codeInput.focus({ preventScroll: true });

  authSubmit(form, async (v) => {
    let bad = false;
    if (!v.school_code) { setState('bad', 'Введіть код школи'); bad = true; }
    if (!v.full_name) { fieldError(form, 'full_name', 'Вкажіть, як до вас звертатися'); bad = true; }
    if (!emailOk(v.email)) { fieldError(form, 'email', 'Перевірте email: наприклад, name@gmail.com'); bad = true; }
    if (form.password.value.length < 8) { fieldError(form, 'password', 'Пароль має містити щонайменше 8 символів'); bad = true; }
    if (bad) { form.querySelector('[aria-invalid]')?.focus(); return; }
    if (!(await check())) { codeInput.focus(); return; }
    const password = form.password.value;
    try {
      const res = await callSignup({ action: 'join_school', school_code: v.school_code.toUpperCase(), full_name: v.full_name, email: v.email.toLowerCase(), password });
      await signInAndGo(res.email || v.email.toLowerCase(), password);
      return true;
    } catch (err) {
      const m = err.message || '';
      if (/email вже існує/i.test(m)) { fieldError(form, 'email', 'Акаунт з таким email вже існує. Увійдіть.'); form.email.focus(); return; }
      if (/код школи/i.test(m)) { setState('bad', m); showSchool(''); codeInput.focus(); return; }
      throw err;
    }
  });
}
