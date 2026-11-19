// Student: my textbooks (#/s/books).
import { html, raw, esc } from '../utils.js';
import { icon, pageHeader, emptyState, errorState } from '../ui.js';
import { setTitle } from '../shell.js';
import { navigate } from '../router.js';
import * as B from '../books-api.js';
import { bookIcon } from '../components/book-upload.js';

export default async function render({ view, query, alive }) {
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  setTitle('Підручник');
  view.innerHTML = String(html`${pageHeader({ title: 'Мої підручники', meta: 'Відповідайте прямо на сторінках: вчитель бачить і перевіряє одразу' })}<div data-body><div class="skeleton" style="height:96px;border-radius:14px"></div></div>`);
  let rows;
  try { rows = await B.myBooks(); } catch (err) { if (alive()) view.querySelector('[data-body]').innerHTML = String(errorState(err.message)); return; }
  if (!alive()) return;
  const body = view.querySelector('[data-body]');
  if (!rows.length) {
    body.innerHTML = String(emptyState({ icon: 'book', title: 'Підручника ще немає', text: 'Коли вчитель закріпить за вами Student book чи Workbook, він з’явиться тут.' }));
    return;
  }
  body.innerHTML = String(html`<div class="s-books">${raw(rows.map(({ textbook: b, is_primary }) => `<a class="s-book-row" href="#/s/books/${b.id}">
      ${String(bookIcon(b))}
      <span class="grow"><span class="fw-600" style="display:block">${esc(b.title)}</span>
        <span class="text-sm muted">${esc((B.BOOK_KINDS[b.kind] || B.BOOK_KINDS.other).label)}${b.level ? ` · ${esc(b.level)}` : ''}${is_primary ? ' · основний' : ''}</span></span>
      ${icon('chevronRight')}
    </a>`).join(''))}</div>`);
}
