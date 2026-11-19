// Upload / edit a textbook (modal).
import { html, raw, esc, LEVELS } from '../utils.js';
import { icon, openModal, toast, toastError, setLoading, fieldError, clearErrors } from '../ui.js';
import * as B from '../books-api.js';

const ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,image/webp';

function kindRadios(selected = 'student_book') {
  return raw(Object.entries(B.BOOK_KINDS).map(([k, v]) => `<label><input type="radio" name="kind" value="${k}" ${k === selected ? 'checked' : ''}><span>${esc(v.label)}</span></label>`).join(''));
}
function levelSelect(selected = '') {
  return raw(['', ...LEVELS].map((l) => `<option value="${l}" ${l === selected ? 'selected' : ''}>${l || 'Без рівня'}</option>`).join(''));
}

/** openBookUpload({ onCreated(book) }) */
export function openBookUpload({ onCreated }) {
  let files = [];
  const { dialog, close } = openModal({
    title: 'Новий підручник',
    wide: true,
    body: html`<form class="stack" data-form novalidate>
      <div class="field"><label class="label" for="bk-title">Назва</label>
        <input class="input" id="bk-title" name="title" required maxlength="120" placeholder="Наприклад: Solutions Pre-Intermediate"></div>
      <fieldset class="field"><legend class="label">Тип</legend>
        <div class="segmented segmented--block">${kindRadios()}</div></fieldset>
      <div class="field"><label class="label" for="bk-level">Рівень</label>
        <select class="select" id="bk-level" name="level">${levelSelect()}</select></div>
      <div class="field" data-field="files">
        <p class="label">Файл</p>
        <label class="drop-zone" data-drop>
          ${raw(icon('upload'))}
          <span class="fw-600" data-drop-title>Оберіть PDF або фото сторінок</span>
          <span class="text-sm muted" data-drop-sub>Один PDF до ${B.MAX_BOOK_MB} МБ, або кілька фото (порядок за назвою файлу)</span>
          <input type="file" name="files" accept="${ACCEPT}" multiple data-file>
        </label>
      </div>
      <details class="field"><summary class="text-sm fw-600">Нумерація сторінок</summary>
        <div class="field" style="margin-top:8px"><label class="label" for="bk-offset">Сторінка 1 книжки — це сторінка PDF №</label>
          <input class="input" id="bk-offset" name="first" type="number" min="1" max="500" value="1" inputmode="numeric">
          <p class="text-xs muted">Якщо в PDF перед першою сторінкою є обкладинка і зміст, вкажіть, на якій сторінці PDF починається «ст. 1». Тоді «ст. 34» у завданнях збігатиметься з книжкою.</p></div>
      </details>
      <div class="alert alert--warning">${raw(icon('lock'))}<div>Підручник бачите лише ви, колеги вашої школи та учні, за якими ви його закріпите. Завантажуйте лише ті матеріали, які маєте право використовувати.</div></div>
      <div class="stack stack--xs" data-progress hidden><div class="upload-progress"><span data-bar></span></div><p class="text-sm muted" data-ptext>Завантажую…</p></div>
    </form>`,
    foot: html`<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="button" data-save>${raw(icon('upload'))}<span>Завантажити</span></button>`,
    onOpen: (d) => d.querySelector('#bk-title').focus(),
  });
  const form = dialog.querySelector('[data-form]');
  const drop = dialog.querySelector('[data-drop]');
  const input = dialog.querySelector('[data-file]');
  const setFiles = (list) => {
    files = [...list].filter((f) => /pdf|jpe?g|png|webp/i.test(f.type) || /\.(pdf|jpe?g|png|webp)$/i.test(f.name));
    const pdfs = files.filter((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (pdfs.length && files.length > 1) { files = [pdfs[0]]; toast('Можна один PDF або кілька фото. Залишив PDF.'); }
    dialog.querySelector('[data-drop-title]').textContent = files.length ? (files.length === 1 ? files[0].name : `${files.length} фото сторінок`) : 'Оберіть PDF або фото сторінок';
    const mb = files.reduce((s, f) => s + f.size, 0) / 1048576;
    dialog.querySelector('[data-drop-sub]').textContent = files.length ? `${mb.toFixed(1)} МБ` : `Один PDF до ${B.MAX_BOOK_MB} МБ, або кілька фото`;
    const t = form.elements.title;
    if (files.length === 1 && !t.value.trim()) t.value = files[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 120);
  };
  input.addEventListener('change', () => setFiles(input.files));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => setFiles(e.dataTransfer.files));

  dialog.querySelector('[data-save]').addEventListener('click', async (e) => {
    clearErrors(form);
    const title = form.elements.title.value.trim();
    let bad = false;
    if (!title) { fieldError(form, 'title', 'Вкажіть назву'); bad = true; }
    if (!files.length) { fieldError(form, 'files', 'Оберіть файл підручника'); bad = true; }
    if (bad) return;
    const btn = e.currentTarget;
    setLoading(btn, true, 'Завантажую…');
    dialog.querySelector('[data-progress]').hidden = false;
    const bar = dialog.querySelector('[data-bar]'); const ptext = dialog.querySelector('[data-ptext]');
    try {
      const first = Math.max(1, parseInt(form.elements.first.value, 10) || 1);
      let book = await B.createBook({ title, kind: form.elements.kind.value, level: form.elements.level.value, files }, (done, all) => {
        bar.style.width = `${Math.round((done / Math.max(all, 1)) * 100)}%`;
        ptext.textContent = all > 1 ? `Завантажено ${done} з ${all}` : (done ? 'Готово' : 'Завантажую файл… Великий PDF може йти хвилину-дві.');
      });
      if (first > 1) book = await B.updateBook(book.id, { page_offset: first - 1 });
      close();
      toast('Підручник додано');
      onCreated?.(book);
    } catch (err) {
      setLoading(btn, false);
      dialog.querySelector('[data-progress]').hidden = true;
      toastError(err);
    }
  });
}

/** openBookSettings({ book, onSaved(book), onDeleted() }) */
export function openBookSettings({ book, canDelete = true, onSaved, onDeleted }) {
  const { dialog, close } = openModal({
    title: 'Налаштування підручника',
    body: html`<form class="stack" data-form novalidate>
      <div class="field"><label class="label" for="bs-title">Назва</label>
        <input class="input" id="bs-title" name="title" required maxlength="120" value="${book.title}"></div>
      <fieldset class="field"><legend class="label">Тип</legend>
        <div class="segmented segmented--block">${kindRadios(book.kind)}</div></fieldset>
      <div class="field"><label class="label" for="bs-level">Рівень</label>
        <select class="select" id="bs-level" name="level">${levelSelect(book.level)}</select></div>
      <div class="field"><label class="label" for="bs-first">Сторінка 1 книжки — це сторінка PDF №</label>
        <input class="input" id="bs-first" name="first" type="number" min="1" max="500" value="${(book.page_offset || 0) + 1}" inputmode="numeric"></div>
      ${canDelete ? html`<div class="danger-zone__row"><div class="grow"><p class="fw-600">Видалити підручник</p><p class="text-sm muted">Зникне в усіх учнів разом із полями й відповідями.</p></div>
        <button class="btn btn--danger-ghost" type="button" data-del>${raw(icon('trash'))}<span>Видалити</span></button></div>` : ''}
    </form>`,
    foot: html`<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="button" data-save>Зберегти</button>`,
  });
  const form = dialog.querySelector('[data-form]');
  dialog.querySelector('[data-save]').addEventListener('click', async (e) => {
    clearErrors(form);
    const title = form.elements.title.value.trim();
    if (!title) { fieldError(form, 'title', 'Вкажіть назву'); return; }
    setLoading(e.currentTarget, true);
    try {
      const saved = await B.updateBook(book.id, { title, kind: form.elements.kind.value, level: form.elements.level.value, page_offset: Math.max(1, parseInt(form.elements.first.value, 10) || 1) - 1 });
      close(); toast('Збережено'); onSaved?.(saved);
    } catch (err) { setLoading(e.currentTarget, false); toastError(err); }
  });
  dialog.querySelector('[data-del]')?.addEventListener('click', async (e) => {
    const { confirmDialog } = await import('../ui.js');
    if (!(await confirmDialog({ title: 'Видалити підручник?', text: `«${book.title}» зникне в усіх учнів разом із відповідями. Це не можна скасувати.`, confirmLabel: 'Видалити', danger: true }))) return;
    try { await B.deleteBook(book); close(); toast('Підручник видалено'); onDeleted?.(); }
    catch (err) { toastError(err); }
  });
}

export function bookCover(book) {
  const k = B.BOOK_KINDS[book.kind] || B.BOOK_KINDS.other;
  return html`<span class="book-card__cover book-card__cover--${book.kind}" aria-hidden="true">${k.short}</span>`;
}
export function bookIcon(book) {
  const k = B.BOOK_KINDS[book.kind] || B.BOOK_KINDS.other;
  return html`<span class="book-row__icon book-row__icon--${book.kind}" aria-hidden="true">${k.short}</span>`;
}
