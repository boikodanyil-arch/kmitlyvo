// Textbook library (#/t/books).
import { html, raw, plural } from '../utils.js';
import { icon, pageHeader, emptyState, errorState, on } from '../ui.js';
import { navigate } from '../router.js';
import { setTitle } from '../shell.js';
import * as B from '../books-api.js';
import { openBookUpload, bookCover } from '../components/book-upload.js';

export default async function render({ view, alive }) {
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  setTitle('Підручники');
  const header = pageHeader({
    title: 'Підручники',
    meta: 'Student book і Workbook, у яких учні відповідають прямо на сторінках',
    actions: html`<button class="btn btn--primary" type="button" data-action="add">${raw(icon('upload'))}Завантажити підручник</button>`,
  });
  view.innerHTML = String(html`${header}<div data-body><div class="books-grid">${raw('<div class="skeleton" style="aspect-ratio:3/4.6;border-radius:14px"></div>'.repeat(4))}</div></div>`);
  on(view, '[data-action="add"]', () => openBookUpload({ onCreated: (b) => navigate(`/t/books/${b.id}`) }));

  let books;
  try { books = await B.listBooks(); } catch (err) { if (alive()) view.querySelector('[data-body]').innerHTML = String(errorState(err.message)); return; }
  if (!alive()) return;
  const body = view.querySelector('[data-body]');
  if (!books.length) {
    body.innerHTML = String(emptyState({
      icon: 'book',
      title: 'Завантажте перший підручник',
      text: 'PDF або фото сторінок. Потім позначте на сторінках поля для відповідей і закріпіть підручник за учнями: вони відповідатимуть прямо в ньому, а ви перевірятимете одразу.',
      action: html`<button class="btn btn--primary" type="button" data-action="add">${raw(icon('upload'))}Завантажити підручник</button>`,
    }));
    return;
  }
  body.innerHTML = String(html`<div class="books-grid">${raw(books.map((b) => String(html`<a class="book-card" href="#/t/books/${b.id}">
      ${bookCover(b)}
      <span class="book-card__title">${b.title}</span>
      <span class="book-card__meta"><span>${(B.BOOK_KINDS[b.kind] || B.BOOK_KINDS.other).label}</span>${b.level ? html`<span>· ${b.level}</span>` : ''}<span>· ${b.page_count} ${plural(b.page_count, 'сторінка', 'сторінки', 'сторінок')}</span></span>
    </a>`)).join(''))}</div>`);
}
