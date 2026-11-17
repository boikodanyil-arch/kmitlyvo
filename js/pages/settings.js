// #/settings — profile, password, theme, space settings (staff), demo data, about beta, logout.
import { sb } from '../supabase.js';
import { state, isStaff, isAdmin, isStudent, isSchool, signOut } from '../state.js';
import { html, raw } from '../utils.js';
import { icon, pageHeader, fieldError, toast, toastError, onSubmit, confirmDialog, setLoading, avatar, copyText } from '../ui.js';
import { setTitle, unmountShell } from '../shell.js';
import { navigate } from '../router.js';
import { APP_VERSION } from '../config.js';
import * as api from '../api.js';
import { passwordField, bindPasswordToggles, strengthMeter, bindStrength } from './login.js';

const I = (n, c) => raw(icon(n, c));
const CURRENCIES = ['zł', '₴', '€', '$', '£'];
const SCALES = [[12, '12-бальна'], [10, '10-бальна'], [5, '5-бальна'], [100, '100 балів (відсотки)']];

function roleName() {
  return { owner: isSchool() ? 'Власник школи' : 'Репетитор', admin: 'Адміністратор', teacher: 'Вчитель', student: 'Учень' }[state.role] || '';
}

export default async function render({ view }) {
  setTitle('Налаштування');
  const name = state.profile?.full_name || '';
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const sp = state.space || {};
  const canEditSpace = isStaff() && isAdmin();
  const scale = Number(sp.grade_scale || 12);
  const cur = sp.currency || 'zł';
  const curList = CURRENCIES.includes(cur) ? CURRENCIES : [cur, ...CURRENCIES];

  view.innerHTML = String(html`
    ${pageHeader({ title: 'Налаштування', meta: [roleName(), sp.name].filter(Boolean).join(' · ') })}
    <div class="pub-settings">
      <div class="stack stack--lg">

        <section class="card" aria-labelledby="st-profile">
          <div class="card__head"><div><h2 class="card__title" id="st-profile">Профіль</h2><p class="card__sub">Як вас бачать ${isStudent() ? 'вчитель і школа' : 'учні й колеги'}</p></div>${avatar(name, 'lg')}</div>
          <form class="form" id="st-profile-form" novalidate>
            <div class="field">
              <label class="label" for="st-name">Імʼя та прізвище</label>
              <input class="input" id="st-name" name="full_name" required maxlength="80" autocomplete="name" value="${name}" ${isStudent() ? raw('aria-describedby="st-name-hint"') : ''}>
              ${isStudent() ? html`<p class="hint" id="st-name-hint">Так вас бачить вчитель.</p>` : ''}
            </div>
            ${isStudent() ? html`<div class="field">
              <label class="label" for="st-login">Логін для входу</label>
              <div class="input-wrap input-wrap--action">
                <input class="input pub-mono" id="st-login" value="${state.student?.login || ''}" readonly aria-describedby="st-login-hint">
                <button class="btn btn--ghost btn--icon input-wrap__action" type="button" data-action="copy-login" aria-label="Копіювати логін">${I('copy')}</button>
              </div>
              <p class="hint" id="st-login-hint">Логін не змінюється. Забули пароль — попросіть вчителя скинути його.</p>
            </div>` : html`<div class="field">
              <label class="label" for="st-email">Email</label>
              <input class="input" id="st-email" value="${state.user?.email || ''}" readonly disabled>
            </div>`}
            <div class="form__actions"><button class="btn btn--primary" type="submit"><span>Зберегти профіль</span></button></div>
          </form>
        </section>

        <section class="card" aria-labelledby="st-pw">
          <div class="card__head"><div><h2 class="card__title" id="st-pw">Пароль</h2><p class="card__sub">Щонайменше 8 символів. Після зміни ви залишитесь у системі.</p></div></div>
          <form class="form" id="st-pw-form" novalidate>
            <input type="text" name="username" autocomplete="username" value="${state.user?.email || ''}" hidden>
            <div class="form__row">
              <div class="stack stack--sm">
                ${passwordField({ id: 'st-pw1', label: 'Новий пароль', autocomplete: 'new-password', minlength: 8 })}
                ${strengthMeter('st-strength')}
              </div>
              ${passwordField({ id: 'st-pw2', name: 'confirm', label: 'Повторіть пароль', autocomplete: 'new-password', minlength: 8 })}
            </div>
            <div class="form__actions"><button class="btn btn--secondary" type="submit"><span>Змінити пароль</span></button></div>
          </form>
        </section>

        ${isStaff() ? html`<section class="card" aria-labelledby="st-space">
          <div class="card__head"><div><h2 class="card__title" id="st-space">${isSchool() ? 'Школа' : 'Простір'}</h2><p class="card__sub">${canEditSpace ? 'Назву бачать учні; шкала оцінок застосовується до нових оцінок.' : 'Змінювати може власник або адміністратор.'}</p></div></div>
          <form class="form" id="st-space-form" novalidate>
            <fieldset class="pub-fieldset-plain" ${canEditSpace ? '' : raw('disabled')}>
              <div class="stack">
                <div class="field">
                  <label class="label" for="st-sname">Назва</label>
                  <input class="input" id="st-sname" name="name" required maxlength="80" value="${sp.name || ''}">
                </div>
                <div class="form__row">
                  <div class="field">
                    <label class="label" for="st-scale">Шкала оцінок</label>
                    <select class="select" id="st-scale" name="grade_scale">${SCALES.map(([v, l]) => html`<option value="${v}" ${v === scale ? raw('selected') : ''}>${l}</option>`)}</select>
                  </div>
                  <div class="field">
                    <label class="label" for="st-cur">Валюта оплат</label>
                    <select class="select" id="st-cur" name="currency">${curList.map((c) => html`<option value="${c}" ${c === cur ? raw('selected') : ''}>${c}</option>`)}</select>
                  </div>
                </div>
              </div>
            </fieldset>
            ${canEditSpace ? html`<div class="form__actions"><button class="btn btn--secondary" type="submit"><span>Зберегти</span></button></div>` : ''}
          </form>
        </section>` : ''}

        ${isStaff() ? html`<section class="card" aria-labelledby="st-demo">
          <div class="card__head"><div><h2 class="card__title" id="st-demo">Демо-дані</h2><p class="card__sub">Приклад учнів, уроків і домашніх, щоб спробувати все без реальних даних. Демо-записи легко прибрати одним кліком.</p></div><span class="pub-tile-icon">${I('sparkles')}</span></div>
          <div class="cluster">
            <button class="btn btn--soft" type="button" data-action="seed">${I('sparkles')}<span>Заповнити прикладом</span></button>
            <button class="btn btn--danger-ghost" type="button" data-action="clear">${I('trash')}<span>Видалити демо-дані</span></button>
          </div>
        </section>` : ''}
      </div>

      <div class="stack stack--lg">
        <section class="card" aria-labelledby="st-look">
          <div class="card__head"><div><h2 class="card__title" id="st-look">Вигляд</h2><p class="card__sub">Темна тема зручна ввечері.</p></div></div>
          <div class="segmented segmented--block" role="radiogroup" aria-labelledby="st-look">
            <label><input type="radio" name="theme" value="light" ${theme === 'light' ? raw('checked') : ''}><span>${I('sun', 'icon--sm')}Світла</span></label>
            <label><input type="radio" name="theme" value="dark" ${theme === 'dark' ? raw('checked') : ''}><span>${I('moon', 'icon--sm')}Темна</span></label>
          </div>
        </section>

        <section class="card card--quiet" aria-labelledby="st-about">
          <div class="card__head"><div><h2 class="card__title" id="st-about">Про бету</h2><p class="card__sub">Кмітливо · ${APP_VERSION}</p></div><span class="brand__beta">бета</span></div>
          <p class="text-sm">Ми щодня покращуємо платформу. Помітили помилку чи бракує функції? Натисніть <b>«Відгук»</b> ${raw('<span class="hide-mobile">унизу праворуч</span><span class="show-mobile">(кнопка над меню)</span>')} — ми читаємо кожне повідомлення.</p>
          <p class="text-xs muted pub-about-by">by Danyil Boiko</p>
        </section>

        <button class="btn btn--secondary btn--block" type="button" data-action="logout">${I('logout')}<span>Вийти з акаунта</span></button>
      </div>
    </div>`);

  bindPasswordToggles(view);

  // ---- profile
  const pf = view.querySelector('#st-profile-form');
  onSubmit(pf, async (v) => {
    if (!v.full_name) { fieldError(pf, 'full_name', 'Вкажіть імʼя'); return; }
    const row = await api.updateProfile({ full_name: v.full_name });
    state.profile = { ...(state.profile || {}), ...(row || {}), full_name: v.full_name };
    document.querySelectorAll('.sidebar__school .fw-600').forEach((el) => { el.textContent = v.full_name; });
    toast('Профіль збережено');
  });

  // ---- password
  const pwf = view.querySelector('#st-pw-form');
  bindStrength(pwf.password, view.querySelector('#st-strength'));
  onSubmit(pwf, async () => {
    const pw = pwf.password.value;
    if (pw.length < 8) { fieldError(pwf, 'password', 'Пароль має містити щонайменше 8 символів'); return; }
    if (pw !== pwf.confirm.value) { fieldError(pwf, 'confirm', 'Паролі не збігаються'); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) {
      if (/different from the old|same/i.test(error.message || '')) { fieldError(pwf, 'password', 'Новий пароль має відрізнятися від поточного'); return; }
      if (/reauth|recent/i.test(error.message || '')) throw new Error('З міркувань безпеки вийдіть і увійдіть знову, потім змініть пароль.');
      throw new Error('Не вдалося змінити пароль. Спробуйте ще раз.');
    }
    pwf.reset();
    pwf.password.dispatchEvent(new Event('input'));
    toast('Пароль змінено');
  });

  // ---- space
  const sf = view.querySelector('#st-space-form');
  if (sf && canEditSpace) {
    onSubmit(sf, async (v) => {
      if (!v.name) { fieldError(sf, 'name', 'Вкажіть назву'); return; }
      const patch = { name: v.name, grade_scale: Number(v.grade_scale), currency: v.currency };
      const row = await api.updateSpace(patch);
      Object.assign(state.space, patch, row ? { name: row.name, grade_scale: row.grade_scale, currency: row.currency } : {});
      const m = state.memberships.find((x) => x.space_id === state.space.id);
      if (m?.space && m.space !== state.space) Object.assign(m.space, patch);
      document.querySelectorAll('.sidebar > .nav__label').forEach((el) => { el.textContent = state.space.name; });
      document.querySelectorAll('#space-switch option').forEach((o) => { if (o.value === state.space.id) o.textContent = state.space.name; });
      toast('Налаштування збережено');
    });
  }

  // ---- theme
  view.addEventListener('change', (e) => {
    if (e.target.name !== 'theme') return;
    const t = e.target.value;
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('kmitlyvo.theme', t); } catch { /* ignore */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0F1714' : '#1A5244');
  });

  // ---- actions
  view.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !view.contains(el)) return;
    const a = el.dataset.action;
    if (a === 'copy-login') {
      copyText(state.student?.login || '', 'Логін скопійовано');
    }
    if (a === 'seed') {
      setLoading(el, true);
      try {
        await api.seedDemo();
        toast('Приклад додано', { text: 'Демо-учні, уроки й домашні вже на місці.', action: { label: 'Переглянути', onClick: () => navigate('/t') } });
      } catch (err) { toastError(err); } finally { if (el.isConnected) setLoading(el, false); }
    }
    if (a === 'clear') {
      const ok = await confirmDialog({ title: 'Видалити демо-дані?', text: 'Буде видалено всіх демо-учнів разом з їхніми уроками, оплатами й домашніми. Ваші справжні учні залишаться без змін.', confirmLabel: 'Видалити демо-дані', danger: true });
      if (!ok) return;
      setLoading(el, true);
      try { await api.clearDemo(); toast('Демо-дані видалено'); } catch (err) { toastError(err); } finally { if (el.isConnected) setLoading(el, false); }
    }
    if (a === 'logout') {
      setLoading(el, true);
      try { await signOut(); } catch (err) { console.error(err); }
      unmountShell();
      navigate('/login');
    }
  });
}
