// "Додати оплату" modal + shared balance helpers (owner: students agent).
import { state, isAdmin, isSchool } from '../state.js';
import { html, raw, esc, money, plural, todayKey } from '../utils.js';
import { icon, openModal, toast, toastError, setLoading, fieldError, clearErrors } from '../ui.js';
import { listStudents, getStudent, addPayment } from '../api.js';

const PRESETS = [1, 4, 8, 12];
const cur = () => state.space?.currency || 'zł';

export const lessonsWord = (n) => plural(Math.abs(n), 'урок', 'уроки', 'уроків');

/** Normalised balance record for a student (missing → zeros). */
export function bal(map, id) {
  return (map && map.get && map.get(id)) || { paid: 0, used: 0, balance: 0, amount: 0 };
}
/** 'debt' | 'low' | 'ok' | 'none' */
export function balanceKind(b) {
  if (!b || (!b.paid && !b.used)) return 'none';
  if (b.balance < 0) return 'debt';
  if (b.balance <= 1) return 'low';
  return 'ok';
}
/** Status chip for a balance. Always text + colour, never colour alone. */
export function balanceChip(b) {
  const kind = balanceKind(b);
  if (kind === 'none') return html`<span class="badge badge--outline">Без оплат</span>`;
  if (kind === 'debt') return html`<span class="badge badge--danger">${raw(icon('alert', 'icon--sm'))}Борг ${-b.balance} ${lessonsWord(b.balance)}</span>`;
  if (kind === 'low') return html`<span class="badge badge--warning">Залишок ${b.balance} ${lessonsWord(b.balance)}</span>`;
  return html`<span class="badge badge--success">${b.balance} ${lessonsWord(b.balance)}</span>`;
}

/**
 * openPaymentForm({ studentId, onSaved })
 * Student select (when no studentId), presets 1/4/8/12 that auto-fill amount from lesson_price.
 */
export function openPaymentForm({ studentId = null, onSaved } = {}) {
  let students = [];
  let amountTouched = false;

  const body = html`<form class="form" id="pay-form" novalidate>
    ${studentId ? '' : html`<div class="field">
      <label class="label" for="pay-student">Учень</label>
      <select class="select" id="pay-student" name="student_id" required disabled><option value="">Завантаження…</option></select>
    </div>`}
    <div class="stack stack--xs">
      <p class="label" id="pay-presets-l">Скільки уроків</p>
      <div class="chips" role="group" aria-labelledby="pay-presets-l">
        ${raw(PRESETS.map((n) => `<button type="button" class="chip" data-preset="${n}" aria-pressed="false">${n} ${lessonsWord(n)}</button>`).join(''))}
      </div>
    </div>
    <div class="form__row">
      <div class="field"><label class="label" for="pay-count">Кількість уроків</label>
        <input class="input" id="pay-count" name="lessons_count" type="number" inputmode="numeric" min="0" max="500" step="1" value="4" required></div>
      <div class="field"><label class="label" for="pay-amount">Сума, ${cur()}</label>
        <input class="input" id="pay-amount" name="amount" type="number" inputmode="decimal" min="0" step="0.01" value="" required>
        <p class="hint" id="pay-price-hint" aria-live="polite"></p></div>
    </div>
    <div class="form__row">
      <div class="field"><label class="label" for="pay-date">Дата оплати</label>
        <input class="input" id="pay-date" name="paid_on" type="date" value="${todayKey()}" max="${todayKey()}" required></div>
      <div class="field"><label class="label" for="pay-note">Примітка <span class="label__opt">(необов’язково)</span></label>
        <input class="input" id="pay-note" name="note" maxlength="200" placeholder="Наприклад: переказ на картку"></div>
    </div>
  </form>`;

  const { dialog, close } = openModal({
    title: 'Додати оплату',
    body,
    foot: '<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="submit" form="pay-form"><span>Додати оплату</span></button>',
  });
  const form = dialog.querySelector('#pay-form');
  const count = form.querySelector('#pay-count');
  const amount = form.querySelector('#pay-amount');
  const hint = form.querySelector('#pay-price-hint');
  const select = form.querySelector('#pay-student');
  const submitBtn = dialog.querySelector('[type="submit"]');

  let current = null; // selected student row
  const price = () => Number(current?.lesson_price || 0);

  function syncPresets() {
    const n = Number(count.value);
    form.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.preset) === n)));
  }
  function autoAmount() {
    if (amountTouched) return;
    const n = Number(count.value) || 0;
    amount.value = price() ? String(Math.round(n * price() * 100) / 100) : amount.value;
  }
  function syncHint() {
    hint.textContent = price() ? `Ціна уроку: ${money(price(), cur())}` : current ? 'Ціну уроку не вказано — введіть суму вручну' : '';
  }
  function setStudent(st) {
    current = st;
    amountTouched = false;
    syncHint();
    autoAmount();
  }

  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    count.value = b.dataset.preset;
    amountTouched = false;
    autoAmount(); syncPresets();
  });
  count.addEventListener('input', () => { autoAmount(); syncPresets(); });
  amount.addEventListener('input', () => { amountTouched = amount.value !== ''; });
  syncPresets();

  // load student(s)
  (async () => {
    try {
      if (studentId) {
        const st = await getStudent(studentId);
        if (st) dialog.querySelector('.modal__title').textContent = `Оплата: ${st.full_name}`;
        setStudent(st);
      } else {
        const opts = isSchool() && isAdmin() ? {} : { teacherId: state.user?.id };
        students = await listStudents(opts);
        if (!dialog.open) return;
        select.disabled = false;
        if (!students.length) {
          select.innerHTML = '<option value="">Спершу додайте учня</option>';
          select.disabled = true; submitBtn.disabled = true;
          return;
        }
        select.innerHTML = '<option value="">Оберіть учня</option>' + students.map((s) => `<option value="${esc(s.id)}">${esc(s.full_name)}${s.status === 'paused' ? ' (пауза)' : ''}</option>`).join('');
        select.addEventListener('change', () => { setStudent(students.find((s) => s.id === select.value) || null); fieldError(form, 'student_id', null); });
        select.focus();
      }
    } catch (err) { toastError(err); }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const sid = studentId || select?.value;
    const n = Number(count.value);
    const sum = amount.value === '' ? 0 : Number(amount.value);
    let bad = false;
    if (!sid) { fieldError(form, 'student_id', 'Оберіть учня'); bad = true; }
    if (!Number.isInteger(n) || n < 0 || n > 500) { fieldError(form, 'lessons_count', 'Вкажіть ціле число від 0 до 500'); bad = true; }
    if (!Number.isFinite(sum) || sum < 0) { fieldError(form, 'amount', 'Сума не може бути від’ємною'); bad = true; }
    if (!bad && n === 0 && sum === 0) { fieldError(form, 'lessons_count', 'Вкажіть кількість уроків або суму'); bad = true; }
    if (!form.paid_on.value) { fieldError(form, 'paid_on', 'Вкажіть дату'); bad = true; }
    if (bad) { form.querySelector('[aria-invalid]')?.focus(); return; }
    setLoading(submitBtn, true);
    try {
      const row = await addPayment({ student_id: sid, lessons_count: n, amount: sum, paid_on: form.paid_on.value, note: form.note.value.trim() });
      close();
      toast('Оплату додано', { text: `${n} ${lessonsWord(n)} · ${money(sum, cur())}` });
      onSaved?.(row);
    } catch (err) { toastError(err); setLoading(submitBtn, false); }
  });
  return { dialog, close };
}
