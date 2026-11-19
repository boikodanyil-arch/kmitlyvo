// Linking textbooks ↔ students: panel for the student profile + pickers.
import { html, raw, esc, plural } from '../utils.js';
import { icon, openModal, toast, toastError, setLoading, confirmDialog, emptyState, levelBadge } from '../ui.js';
import { listStudents } from '../api.js';
import * as B from '../books-api.js';
import { bookIcon } from './book-upload.js';

/** Pick students for a book. */
export async function openAttachStudents({ book, attachedIds = [], onDone }) {
  let students;
  try { students = await listStudents(); } catch (err) { toastError(err); return; }
  const free = students.filter((s) => !attachedIds.includes(s.id));
  const { dialog, close } = openModal({
    title: `Закріпити «${book.title}»`,
    body: free.length ? html`<form class="stack" data-form>
        <p class="text-sm muted">Оберіть учнів. Вони побачать підручник у своєму кабінеті й зможуть відповідати прямо на сторінках.</p>
        <ul class="list list--card pick-list">${raw(free.map((s) => `<li><label class="list-row"><input type="checkbox" name="st" value="${s.id}"><span class="list-row__body"><span class="list-row__title">${esc(s.full_name)}</span></span><span class="list-row__trail">${String(levelBadge(s.cefr_level))}</span></label></li>`).join(''))}</ul>
        <label class="switch"><span>Зробити основним ${esc((B.BOOK_KINDS[book.kind] || B.BOOK_KINDS.other).label)} для цих учнів</span><input type="checkbox" name="primary" checked></label>
      </form>`
      : html`<p>${students.length ? 'Цей підручник уже закріплено за всіма вашими учнями.' : 'Спочатку додайте учнів.'}</p>`,
    foot: free.length ? html`<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="button" data-save>Закріпити</button>` : html`<button class="btn btn--primary" type="button" data-close>Зрозуміло</button>`,
  });
  dialog.querySelector('[data-save]')?.addEventListener('click', async (e) => {
    const form = dialog.querySelector('[data-form]');
    const ids = [...form.querySelectorAll('input[name="st"]:checked')].map((i) => i.value);
    if (!ids.length) { toast('Оберіть хоча б одного учня'); return; }
    const primary = form.elements.primary.checked;
    setLoading(e.currentTarget, true);
    try { for (const id of ids) await B.attachBook(id, book.id, primary); close(); toast(`Закріплено за ${ids.length} ${plural(ids.length, 'учнем', 'учнями', 'учнями')}`); onDone?.(); }
    catch (err) { setLoading(e.currentTarget, false); toastError(err); }
  });
}

/** Pick books for a student. */
export async function openAttachBooks({ student, attachedIds = [], onDone }) {
  let books;
  try { books = await B.listBooks(); } catch (err) { toastError(err); return; }
  const free = books.filter((b) => !attachedIds.includes(b.id));
  const { dialog, close } = openModal({
    title: `Підручники для ${student.full_name.split(' ')[0]}`,
    body: free.length ? html`<form class="stack" data-form>
        <ul class="list list--card pick-list">${raw(free.map((b) => `<li><label class="list-row"><input type="checkbox" name="bk" value="${b.id}"><span class="list-row__lead">${String(bookIcon(b))}</span><span class="list-row__body"><span class="list-row__title">${esc(b.title)}</span><span class="list-row__meta">${esc((B.BOOK_KINDS[b.kind] || B.BOOK_KINDS.other).label)}${b.level ? ` · ${esc(b.level)}` : ''}</span></span></label></li>`).join(''))}</ul>
        <label class="switch"><span>Зробити основними (Student book і Workbook)</span><input type="checkbox" name="primary" checked></label>
      </form>`
      : html`${books.length ? html`<p>Усі підручники бібліотеки вже закріплено за цим учнем.</p>` : emptyState({ icon: 'book', title: 'Бібліотека порожня', text: 'Завантажте PDF чи фото підручника, щоб закріпити його за учнем.', plain: true })}`,
    foot: free.length
      ? html`<a class="btn btn--ghost" href="#/t/books">${raw(icon('upload'))}Завантажити новий</a><button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="button" data-save>Закріпити</button>`
      : html`<a class="btn btn--primary" href="#/t/books">${raw(icon('upload'))}До бібліотеки</a>`,
  });
  dialog.querySelector('[data-save]')?.addEventListener('click', async (e) => {
    const form = dialog.querySelector('[data-form]');
    const ids = [...form.querySelectorAll('input[name="bk"]:checked')].map((i) => i.value);
    if (!ids.length) { toast('Оберіть підручник'); return; }
    const primary = form.elements.primary.checked;
    setLoading(e.currentTarget, true);
    try { for (const id of ids) await B.attachBook(student.id, id, primary); close(); toast('Підручник закріплено'); onDone?.(); }
    catch (err) { setLoading(e.currentTarget, false); toastError(err); }
  });
}

/** Panel for the student profile tab. Mounts into host and manages itself. */
export async function mountStudentBooks(host, student) {
  host.innerHTML = '<div class="skeleton" style="height:120px;border-radius:14px"></div>';
  let rows = [];
  async function load() {
    try { rows = await B.listStudentBooks(student.id); draw(); }
    catch (err) { host.innerHTML = `<p class="error-text">${esc(err.message)}</p>`; }
  }
  function draw() {
    host.innerHTML = String(html`<section class="stack">
      <div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <p class="text-sm muted" style="margin:0">Учень відповідає прямо на сторінках, ви бачите й перевіряєте одразу.</p>
        <button class="btn btn--secondary btn--sm" type="button" data-sb="add">${raw(icon('plus'))}<span>Закріпити підручник</span></button>
      </div>
      ${rows.length ? html`<ul class="list list--card">${raw(rows.map(({ textbook: b, is_primary }) => `<li class="list-row">
          <span class="list-row__lead">${String(bookIcon(b))}</span>
          <span class="list-row__body"><span class="list-row__title">${esc(b.title)} ${is_primary ? '<span class="badge badge--success">основний</span>' : ''}</span>
            <span class="list-row__meta">${esc((B.BOOK_KINDS[b.kind] || B.BOOK_KINDS.other).label)}${b.level ? ` · ${esc(b.level)}` : ''} · ${b.page_count} стор.</span></span>
          <span class="list-row__trail cluster">
            <a class="btn btn--primary btn--sm" href="#/t/books/${b.id}?student=${student.id}">${icon('edit', 'icon--sm')}<span>Відкрити зошит учня</span></a>
            <button class="btn btn--ghost btn--icon btn--sm" type="button" data-sb="primary" data-id="${b.id}" data-on="${is_primary}" aria-label="${is_primary ? 'Зняти позначку основного' : 'Зробити основним'}" title="${is_primary ? 'Зняти «основний»' : 'Зробити основним'}">${icon('star')}</button>
            <button class="btn btn--ghost btn--icon btn--sm" type="button" data-sb="detach" data-id="${b.id}" aria-label="Відкріпити ${esc(b.title)}">${icon('x')}</button>
          </span></li>`).join(''))}</ul>`
        : emptyState({ icon: 'book', title: 'Підручник не закріплено', text: 'Закріпіть Student book і Workbook, за якими ви працюєте з учнем.', plain: true })}
    </section>`);
  }
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sb]'); if (!b) return;
    const k = b.dataset.sb;
    if (k === 'add') openAttachBooks({ student, attachedIds: rows.map((r) => r.textbook_id), onDone: load });
    if (k === 'primary') { try { await B.setPrimary(student.id, b.dataset.id, b.dataset.on !== 'true'); load(); } catch (err) { toastError(err); } }
    if (k === 'detach') {
      const r = rows.find((x) => x.textbook_id === b.dataset.id);
      if (!(await confirmDialog({ title: 'Відкріпити підручник?', text: `Учень більше не бачитиме «${r?.textbook.title}». Його відповіді збережуться, якщо закріпите знову.`, confirmLabel: 'Відкріпити', danger: true }))) return;
      try { await B.detachBook(student.id, b.dataset.id); load(); } catch (err) { toastError(err); }
    }
  });
  await load();
}
