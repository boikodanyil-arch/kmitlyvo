// Payments overview (#/t/payments): balances for all students + recent payments.
import { state, isAdmin, isSchool } from '../state.js';
import { html, raw, esc, money, plural, fmtDate, todayKey, debounce } from '../utils.js';
import { icon, avatar, pageHeader, emptyState, errorState, skeletonRows, confirmDialog, toast, toastError, on } from '../ui.js';
import { listStudents, listPayments, deletePayment, balances } from '../api.js';
import { navigate } from '../router.js';
import { setTitle } from '../shell.js';
import { openPaymentForm, balanceChip, bal, balanceKind, lessonsWord } from '../components/payment-form.js';
import { openStudentForm } from '../components/student-form.js';

const FILTERS = [['all', 'Усі'], ['debt', 'Борги'], ['low', 'Мало уроків']];
const cur = () => state.space?.currency || '₴';
const payDate = (p) => fmtDate(p.paid_on + 'T12:00:00');

export default async function render({ view, query, alive }) {
  // Listeners must die with the page: #page is reused across routes, so bind to a fresh root.
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  setTitle('Оплати');
  const admin = isSchool() && isAdmin();
  const f = { kind: ['debt', 'low'].includes(query.filter) ? query.filter : 'all', q: '', teacher: '' };

  view.innerHTML = String(html`
    ${pageHeader({ title: 'Оплати', meta: 'Баланс уроків: оплачено мінус проведені й неявки', actions: html`<button class="btn btn--primary" type="button" data-action="pay">${raw(icon('plus'))}Додати оплату</button>` })}
    <div data-body>${skeletonRows(6)}</div>`);
  const bodyEl = view.querySelector('[data-body]');
  let data = null;

  const reload = () => load();
  on(view, '[data-action="pay"]', (e, el) => openPaymentForm({ studentId: el.dataset.id || null, onSaved: reload }));
  on(view, '[data-action="add-student"]', () => openStudentForm({ onSaved: reload }));
  on(view, '[data-kind]', (e, el) => {
    f.kind = el.dataset.kind;
    view.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === f.kind)));
    drawTable();
  });
  on(view, '[data-action="reset"]', () => { Object.assign(f, { kind: 'all', q: '', teacher: '' }); drawAll(); });
  on(view, '[data-action="del"]', async (e, el) => {
    const p = data.payments.find((x) => x.id === el.dataset.id);
    if (!p) return;
    const ok = await confirmDialog({ title: 'Видалити оплату?', text: `${p.student?.full_name || 'Учень'}: ${p.lessons_count} ${lessonsWord(p.lessons_count)} · ${money(p.amount, cur())} від ${payDate(p)}. Баланс учня зменшиться.`, confirmLabel: 'Видалити оплату', danger: true });
    if (!ok) return;
    try { await deletePayment(p.id); toast('Оплату видалено'); await load(); } catch (err) { toastError(err); }
  });
  on(view, 'tr[data-href]', (e, el) => {
    if (e.target.closest('a, button')) return;
    navigate(el.dataset.href.slice(1));
  });

  async function load() {
    try {
      const teacherId = admin ? null : state.user.id;
      const [students, payments, bmap] = await Promise.all([listStudents({ teacherId }), listPayments(), balances()]);
      if (!alive()) return;
      const ids = new Set(students.map((s) => s.id));
      data = { students, payments: payments.filter((p) => ids.has(p.student_id) || admin), bmap };
      drawAll();
    } catch (err) {
      if (alive()) bodyEl.innerHTML = String(errorState(err.message));
    }
  }

  function rows() {
    return data.students.map((s) => ({ s, b: bal(data.bmap, s.id) }));
  }

  function drawAll() {
    if (!data.students.length) {
      bodyEl.innerHTML = String(emptyState({ icon: 'wallet', title: 'Тут буде баланс уроків', text: 'Спершу додайте учня, а потім фіксуйте оплати — Кмітливо порахує, скільки уроків лишилось.', action: html`<button class="btn btn--primary" type="button" data-action="add-student">${raw(icon('plus'))}Додати учня</button>` }));
      return;
    }
    const all = rows();
    const month = todayKey().slice(0, 7);
    const monthPays = data.payments.filter((p) => String(p.paid_on).startsWith(month));
    const monthSum = monthPays.reduce((s, p) => s + Number(p.amount), 0);
    const debts = all.filter(({ b }) => balanceKind(b) === 'debt');
    const debtLessons = debts.reduce((s, { b }) => s - b.balance, 0);
    const low = all.filter(({ b }) => balanceKind(b) === 'low');
    const prepaid = all.reduce((s, { b }) => s + Math.max(0, b.balance), 0);
    const teachers = admin ? [...new Map(data.students.filter((s) => s.teacher).map((s) => [s.teacher_id, s.teacher.full_name || 'Без імені'])).entries()] : [];

    bodyEl.innerHTML = String(html`<div class="stack stack--xl">
      <div class="grid-4">
        <div class="stat"><span class="stat__label">${raw(icon('coins'))}Цього місяця</span><span class="stat__value">${Math.round(monthSum).toLocaleString('uk-UA')}<span class="stat__unit">${cur()}</span></span><span class="stat__hint">${monthPays.length} ${plural(monthPays.length, 'оплата', 'оплати', 'оплат')}</span></div>
        <button class="stat stat-link${debts.length ? ' stat--attention' : ''}" type="button" data-kind="debt" aria-pressed="${f.kind === 'debt'}"><span class="stat__label">${raw(icon('alert'))}Борги</span><span class="stat__value">${debts.length}</span><span class="stat__hint">${debts.length ? `${debtLessons} ${lessonsWord(debtLessons)} без оплати` : 'боргів немає'}</span></button>
        <button class="stat stat-link" type="button" data-kind="low" aria-pressed="${f.kind === 'low'}"><span class="stat__label">${raw(icon('clock'))}Мало уроків</span><span class="stat__value">${low.length}</span><span class="stat__hint">залишок 0–1 урок</span></button>
        <div class="stat"><span class="stat__label">${raw(icon('wallet'))}Передоплачено</span><span class="stat__value">${prepaid}<span class="stat__unit">${lessonsWord(prepaid)}</span></span><span class="stat__hint">наперед в усіх учнів</span></div>
      </div>

      <section class="section" aria-labelledby="bal-h">
        <div class="section__head"><h2 class="h3" id="bal-h">Баланси учнів</h2></div>
        <div class="toolbar">
          <div class="input-wrap toolbar__search"><label class="sr-only" for="pay-q">Пошук учня</label>${raw(icon('search'))}<input class="input" id="pay-q" type="search" placeholder="Пошук учня" value="${f.q}" autocomplete="off"></div>
          ${admin && teachers.length > 1 ? html`<div class="toolbar__select"><label class="sr-only" for="pay-teacher">Вчитель</label><select class="select" id="pay-teacher"><option value="">Усі вчителі</option>${raw(teachers.map(([id, n]) => `<option value="${esc(id)}"${f.teacher === id ? ' selected' : ''}>${esc(n)}${id === state.user.id ? ' (я)' : ''}</option>`).join(''))}</select></div>` : ''}
        </div>
        <div class="chips" role="group" aria-label="Фільтр балансу">
          ${raw(FILTERS.map(([v, l]) => `<button class="chip" type="button" data-kind="${v}" aria-pressed="${f.kind === v}">${l} <span class="chip__count">${v === 'all' ? all.length : v === 'debt' ? debts.length : low.length}</span></button>`).join(''))}
        </div>
        <div data-table></div>
      </section>

      <section class="section" aria-labelledby="recent-h">
        <div class="section__head"><h2 class="h3" id="recent-h">Останні оплати</h2></div>
        ${recent()}
      </section>
    </div>`);
    const q = bodyEl.querySelector('#pay-q');
    q.addEventListener('input', debounce(() => { f.q = q.value; drawTable(); }, 150));
    bodyEl.querySelector('#pay-teacher')?.addEventListener('change', (e) => { f.teacher = e.target.value; drawTable(); });
    drawTable();
  }

  function drawTable() {
    const host = bodyEl.querySelector('[data-table]');
    if (!host) return;
    const q = f.q.trim().toLowerCase();
    const list = rows()
      .filter(({ s, b }) => (f.kind === 'all' || balanceKind(b) === f.kind)
        && (!f.teacher || s.teacher_id === f.teacher)
        && (!q || s.full_name.toLowerCase().includes(q)))
      .sort((a, b) => a.b.balance - b.b.balance || a.s.full_name.localeCompare(b.s.full_name, 'uk'));
    if (!list.length) {
      host.innerHTML = String(f.kind !== 'all' && !q
        ? emptyState({ icon: 'checkCircle', title: f.kind === 'debt' ? 'Боргів немає' : 'Усі мають запас уроків', text: 'Чудово — нікому не треба нагадувати про оплату.', plain: true })
        : emptyState({ icon: 'search', title: 'Нікого не знайдено', text: 'Спробуйте інший запит.', action: html`<button class="btn btn--secondary" type="button" data-action="reset">Скинути фільтри</button>` }));
      return;
    }
    const showT = admin;
    const mobile = html`<ul class="list list--card show-mobile">${list.map(({ s, b }) => html`<li class="action-row">
      <a class="list-row grow" href="#/t/students/${s.id}?tab=payments">
        ${avatar(s.full_name, 'sm')}
        <span class="list-row__body">
          <span class="list-row__title">${s.full_name}</span>
          <span class="list-row__meta">${balanceChip(b)}<span>${b.paid} опл. · ${b.used} пров.</span>${showT && s.teacher?.full_name ? html`<span>${s.teacher.full_name}</span>` : ''}</span>
        </span>
      </a>
      <div class="action-row__act"><button class="btn btn--soft btn--sm" type="button" data-action="pay" data-id="${s.id}" aria-label="Додати оплату: ${s.full_name}">${raw(icon('plus'))}<span>Оплата</span></button></div>
    </li>`)}</ul>`;
    host.innerHTML = String(html`${mobile}<div class="table-wrap table-wrap--stack hide-mobile">
      <table class="table table--stack pay-table">
        <thead><tr><th>Учень</th>${showT ? html`<th>Вчитель</th>` : ''}<th class="num">Оплачено</th><th class="num">Проведено</th><th>Залишок</th><th class="num">Сума</th><th class="table__actions"><span class="sr-only">Дії</span></th></tr></thead>
        <tbody>${list.map(({ s, b }) => html`<tr data-href="#/t/students/${s.id}?tab=payments">
          <td class="table__primary"><span class="row">${avatar(s.full_name, 'sm')}<a class="st-name" href="#/t/students/${s.id}?tab=payments">${s.full_name}</a></span></td>
          ${showT ? html`<td data-label="Вчитель">${s.teacher?.full_name || '—'}</td>` : ''}
          <td data-label="Оплачено" class="num">${b.paid}</td>
          <td data-label="Проведено" class="num">${b.used}</td>
          <td data-label="Залишок">${balanceChip(b)}</td>
          <td data-label="Сума" class="num">${money(b.amount, cur())}</td>
          <td class="table__actions"><button class="btn btn--soft btn--sm" type="button" data-action="pay" data-id="${s.id}" aria-label="Додати оплату: ${s.full_name}">${raw(icon('plus'))}<span>Оплата</span></button></td>
        </tr>`)}</tbody>
      </table>
    </div>`);
  }

  function recent() {
    const list = data.payments.slice(0, 20);
    if (!list.length) {
      return emptyState({ icon: 'coins', title: 'Оплат ще немає', text: 'Додайте першу оплату — баланс уроків порахується сам.', plain: true, action: html`<button class="btn btn--secondary btn--sm" type="button" data-action="pay">${raw(icon('plus'))}Додати оплату</button>` });
    }
    return html`<ul class="list list--card">${list.map((p) => html`<li class="action-row">
      <a class="list-row grow" href="#/t/students/${p.student_id}?tab=payments">
        ${avatar(p.student?.full_name || '?', 'sm')}
        <span class="list-row__body">
          <span class="list-row__title">${p.student?.full_name || 'Учень'}</span>
          <span class="list-row__meta"><span>${payDate(p)}</span><span>${p.lessons_count} ${lessonsWord(p.lessons_count)}</span>${p.note ? html`<span class="truncate">${p.note}</span>` : ''}</span>
        </span>
        <span class="list-row__trail fw-600 num pay-amount">+${money(p.amount, cur())}</span>
      </a>
      <div class="action-row__act"><button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="del" data-id="${p.id}" aria-label="Видалити оплату: ${p.student?.full_name || ''}, ${payDate(p)}">${raw(icon('trash'))}</button></div>
    </li>`)}</ul>`;
  }

  await load();
}
