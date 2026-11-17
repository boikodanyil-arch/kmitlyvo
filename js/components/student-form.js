// Create / edit student modal + invite card helpers (owner: students agent).
import { state, isAdmin, isSchool } from '../state.js';
import { html, raw, esc, suggestLogin, safeUrl } from '../utils.js';
import { icon, openModal, toast, toastError, setLoading, fieldError, clearErrors, levelOptions, copyText } from '../ui.js';
import { createStudent, updateStudent, listMembers } from '../api.js';

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
export const SITE = () => location.origin + location.pathname;
export const inviteLink = (code) => `${SITE()}#/activate?code=${encodeURIComponent(code)}`;

/** Ukrainian invite message for Telegram / Viber. */
export function inviteText(student) {
  const first = String(student.full_name || '').trim().split(/\s+/)[0] || '';
  return [
    `Привіт${first ? ', ' + first : ''}! Запрошую тебе в Кмітливо — тут будуть наш розклад уроків, домашні завдання й оцінки.`,
    '',
    `1. Відкрий посилання: ${inviteLink(student.activation_code)}`,
    `2. Код активації: ${student.activation_code}`,
    `3. Твій логін: ${student.login} — придумай пароль, і готово.`,
    '',
    'Далі заходь з телефона чи компʼютера за логіном і паролем.',
  ].join('\n');
}

/** Invite block markup (login, code, link, copy/share). Bind with bindInvite(). */
export function inviteBlock(student, { compact = false } = {}) {
  const link = inviteLink(student.activation_code);
  const text = inviteText(student);
  const tg = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text.replace(link, '').replace(/\n{3,}/g, '\n\n'))}`;
  const viber = `viber://forward?text=${encodeURIComponent(text)}`;
  return html`<div class="invite stack" data-invite>
    <dl class="invite__facts">
      <div><dt>Логін</dt><dd class="invite__login">${student.login}</dd></div>
      <div><dt>Код активації</dt><dd><span class="code-box invite__code">${student.activation_code}</span></dd></div>
    </dl>
    <div class="field">
      <label class="label" for="inv-link-${student.id}">Посилання для активації</label>
      <div class="input-wrap input-wrap--action">
        <input class="input" id="inv-link-${student.id}" value="${link}" readonly data-select>
        <button class="btn btn--ghost btn--icon input-wrap__action" type="button" aria-label="Копіювати посилання" data-copy-link>${raw(icon('copy'))}</button>
      </div>
      ${compact ? '' : html`<p class="hint">Учень відкриває посилання, придумує пароль — і акаунт готовий.</p>`}
    </div>
    <div class="invite__actions">
      <button class="btn btn--soft" type="button" data-copy-text>${raw(icon('copy'))}Копіювати запрошення</button>
      <a class="btn btn--secondary" href="${tg}" target="_blank" rel="noopener">${raw(icon('send'))}Telegram</a>
      <a class="btn btn--secondary" href="${viber}">${raw(icon('message'))}Viber</a>
      ${'share' in navigator ? html`<button class="btn btn--ghost" type="button" data-share>${raw(icon('share'))}Ще</button>` : ''}
    </div>
  </div>`;
}
export function bindInvite(root, getStudent) {
  root.addEventListener('click', async (e) => {
    const st = getStudent();
    if (!st?.activation_code) return;
    if (e.target.closest('[data-copy-link]')) copyText(inviteLink(st.activation_code), 'Посилання скопійовано');
    else if (e.target.closest('[data-copy-text]')) copyText(inviteText(st), 'Запрошення скопійовано');
    else if (e.target.closest('[data-share]')) {
      try { await navigator.share({ title: 'Запрошення в Кмітливо', text: inviteText(st) }); } catch { /* cancelled */ }
    }
  });
  root.addEventListener('focusin', (e) => { if (e.target.matches('[data-select]')) e.target.select(); });
}

/** Login suggestion with a stable numeric suffix (so it doesn't jump on each keystroke). */
function makeSuggester() {
  const suffix = String(Math.floor(10 + Math.random() * 89));
  return (name) => (name.trim() ? suggestLogin(name).replace(/\d{2}$/, '') + suffix : '');
}

/**
 * openStudentForm({ student, onSaved })
 * Create: after save shows the invite step in the same modal. Edit: closes on save.
 */
export function openStudentForm({ student = null, onSaved } = {}) {
  const editing = !!student;
  const s = student || { cefr_level: 'A1', lesson_minutes: 60, lesson_price: '', status: 'active' };
  const loginLocked = editing && !!s.user_id;
  const showTeacher = isSchool() && isAdmin();
  const suggest = makeSuggester();
  let loginTouched = editing;

  const body = html`<form class="form" id="st-form" novalidate>
    <div class="field">
      <label class="label" for="st-name">Ім’я та прізвище</label>
      <input class="input" id="st-name" name="full_name" required maxlength="80" autocomplete="off" value="${s.full_name || ''}" placeholder="Наприклад: Марія Коваль">
    </div>
    <div class="form__row">
      <div class="field">
        <label class="label" for="st-login">Логін учня</label>
        <input class="input" id="st-login" name="login" required maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false"
          value="${s.login || ''}" ${loginLocked ? 'readonly' : ''} aria-describedby="st-login-hint" placeholder="maria.k25">
        <p class="hint" id="st-login-hint">${loginLocked ? 'Учень уже активував акаунт — логін змінити не можна.' : 'Латиниця, цифри, крапка, дефіс. З ним учень входитиме.'}</p>
      </div>
      <div class="field">
        <label class="label" for="st-level">Рівень</label>
        <select class="select" id="st-level" name="cefr_level">${levelOptions(s.cefr_level || 'A1')}</select>
      </div>
    </div>
    ${editing ? html`<fieldset class="fieldset">
      <legend>Статус</legend>
      <div class="segmented segmented--block" role="radiogroup" aria-label="Статус">
        ${raw([['active', 'Активний'], ['paused', 'Пауза'], ['archived', 'Архів']].map(([v, l]) => `<label><input type="radio" name="status" value="${v}"${s.status === v ? ' checked' : ''}><span>${l}</span></label>`).join(''))}
      </div>
    </fieldset>` : ''}
    ${showTeacher ? html`<div class="field">
      <label class="label" for="st-teacher">Вчитель</label>
      <select class="select" id="st-teacher" name="teacher_id" disabled><option value="${s.teacher_id || state.user.id}">Завантаження…</option></select>
    </div>` : ''}
    <div class="field">
      <label class="label" for="st-goals">Цілі <span class="label__opt">(необов’язково)</span></label>
      <textarea class="textarea" id="st-goals" name="goals" rows="2" maxlength="1000" placeholder="Наприклад: підготовка до IELTS 6.5 до червня">${s.goals || ''}</textarea>
    </div>
    <div class="field">
      <label class="label" for="st-topic">Наступна тема <span class="label__opt">(необов’язково)</span></label>
      <input class="input" id="st-topic" name="next_topic" maxlength="200" value="${s.next_topic || ''}" placeholder="Present Perfect vs Past Simple">
    </div>
    <div class="form__row">
      <div class="field">
        <label class="label" for="st-min">Тривалість уроку, хв</label>
        <input class="input" id="st-min" name="lesson_minutes" type="number" inputmode="numeric" min="15" max="240" step="5" value="${s.lesson_minutes ?? 60}">
      </div>
      <div class="field">
        <label class="label" for="st-price">Ціна уроку, ${state.space?.currency || '₴'}</label>
        <input class="input" id="st-price" name="lesson_price" type="number" inputmode="decimal" min="0" step="0.01" value="${s.lesson_price || s.lesson_price === 0 ? String(s.lesson_price) : ''}" placeholder="0">
      </div>
    </div>
    <div class="field">
      <label class="label" for="st-url">Посилання на онлайн-урок <span class="label__opt">(необов’язково)</span></label>
      <input class="input" id="st-url" name="meeting_url" type="url" inputmode="url" maxlength="500" value="${s.meeting_url || ''}" placeholder="https://meet.google.com/…">
    </div>
    <div class="field">
      <label class="label" for="st-contact">Контакт <span class="label__opt">(необов’язково)</span></label>
      <input class="input" id="st-contact" name="contact" maxlength="200" value="${s.contact || ''}" placeholder="Телефон, Telegram або email" aria-describedby="st-contact-hint">
      <p class="hint" id="st-contact-hint">Бачите лише ви.</p>
    </div>
    <fieldset class="fieldset">
      <legend class="sr-only">Неповнолітній учень</legend>
      <label class="check"><input type="checkbox" name="is_minor" ${s.is_minor ? 'checked' : ''}><span class="check__body">Учню менше 16 років<span class="check__hint">Для неповнолітніх потрібна згода батьків на обробку даних.</span></span></label>
      <label class="check" data-consent ${s.is_minor ? '' : 'hidden'}><input type="checkbox" name="parent_consent" ${s.parent_consent ? 'checked' : ''}><span class="check__body">Батьки дали згоду<span class="check__hint">Усно чи письмово — головне, щоб вона була.</span></span></label>
    </fieldset>
  </form>`;

  const { dialog, close } = openModal({
    title: editing ? 'Редагувати учня' : 'Новий учень',
    body,
    foot: `<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="submit" form="st-form"><span>${editing ? 'Зберегти зміни' : 'Додати учня'}</span></button>`,
  });
  const form = dialog.querySelector('#st-form');
  const name = form.full_name;
  const login = form.login;

  if (!editing) {
    name.addEventListener('input', () => { if (!loginTouched) login.value = suggest(name.value); });
    login.addEventListener('input', () => {
      loginTouched = login.value.trim() !== '';
      const v = login.value.toLowerCase().replace(/\s+/g, '');
      if (v !== login.value) login.value = v;
    });
  } else if (!loginLocked) {
    login.addEventListener('input', () => { const v = login.value.toLowerCase().replace(/\s+/g, ''); if (v !== login.value) login.value = v; });
  }
  form.is_minor.addEventListener('change', () => { form.querySelector('[data-consent]').hidden = !form.is_minor.checked; });
  setTimeout(() => name.focus(), 50);

  if (showTeacher) {
    (async () => {
      try {
        const members = await listMembers();
        const sel = form.querySelector('#st-teacher');
        if (!sel) return;
        const cur = s.teacher_id || state.user.id;
        sel.innerHTML = members.map((m) => `<option value="${esc(m.user_id)}"${m.user_id === cur ? ' selected' : ''}>${esc(m.profile?.full_name || 'Без імені')}${m.user_id === state.user.id ? ' (я)' : ''}</option>`).join('');
        sel.disabled = false;
      } catch (err) { toastError(err); }
    })();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const btn = dialog.querySelector('[type="submit"]');
    const v = {
      full_name: name.value.trim().replace(/\s+/g, ' '),
      login: login.value.trim().toLowerCase(),
      cefr_level: form.cefr_level.value,
      goals: form.goals.value.trim(),
      next_topic: form.next_topic.value.trim(),
      lesson_minutes: Number(form.lesson_minutes.value || 60),
      lesson_price: form.lesson_price.value === '' ? 0 : Number(form.lesson_price.value),
      meeting_url: form.meeting_url.value.trim(),
      contact: form.contact.value.trim(),
      is_minor: form.is_minor.checked,
      parent_consent: form.is_minor.checked && form.parent_consent.checked,
    };
    if (editing) v.status = form.querySelector('[name="status"]:checked')?.value || s.status;
    if (showTeacher) { const t = form.querySelector('#st-teacher'); if (t && !t.disabled) v.teacher_id = t.value; }

    let bad = false;
    if (v.full_name.length < 2) { fieldError(form, 'full_name', 'Вкажіть ім’я учня'); bad = true; }
    if (!loginLocked && !LOGIN_RE.test(v.login)) { fieldError(form, 'login', 'Від 3 до 32 символів: малі латинські літери, цифри, «.», «_» або «-»'); bad = true; }
    if (!Number.isFinite(v.lesson_minutes) || v.lesson_minutes < 15 || v.lesson_minutes > 240) { fieldError(form, 'lesson_minutes', 'Від 15 до 240 хвилин'); bad = true; }
    if (!Number.isFinite(v.lesson_price) || v.lesson_price < 0) { fieldError(form, 'lesson_price', 'Ціна не може бути від’ємною'); bad = true; }
    if (v.meeting_url && !safeUrl(v.meeting_url)) { fieldError(form, 'meeting_url', 'Посилання має починатися з https://'); bad = true; }
    if (bad) { form.querySelector('[aria-invalid]')?.focus(); return; }
    if (loginLocked) delete v.login;

    setLoading(btn, true);
    try {
      if (editing) {
        const row = await updateStudent(s.id, v);
        close();
        toast('Зміни збережено');
        onSaved?.({ ...s, ...row });
      } else {
        const row = await createStudent(v);
        onSaved?.(row);
        showInviteStep(dialog, row);
      }
    } catch (err) {
      setLoading(btn, false);
      if (/логін/i.test(err.message)) { fieldError(form, 'login', 'Цей логін уже зайнятий. Спробуйте інший, наприклад з цифрами.'); login.focus(); }
      else toastError(err);
    }
  });
  return { dialog, close };
}

function showInviteStep(dialog, st) {
  dialog.querySelector('.modal__title').textContent = 'Учня додано';
  const bodyEl = dialog.querySelector('.modal__body');
  bodyEl.innerHTML = String(html`<div class="stack">
    <div class="alert alert--success">${raw(icon('checkCircle'))}<div><p class="alert__title">${st.full_name} у вашому списку</p>Надішліть запрошення — учень активує акаунт і побачить розклад та домашні.</div></div>
    ${inviteBlock(st)}
  </div>`);
  bindInvite(bodyEl, () => st);
  dialog.querySelector('.modal__foot').innerHTML = String(html`<a class="btn btn--secondary" href="#/t/students/${st.id}" data-close>Відкрити профіль</a><button class="btn btn--primary" type="button" data-close>Готово</button>`);
  toast('Учня додано');
  dialog.querySelector('[data-copy-text]')?.focus();
}
