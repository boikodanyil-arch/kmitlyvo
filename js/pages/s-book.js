// Student: interactive textbook (#/s/books/:id?p=N).
import { state } from '../state.js';
import { html, raw } from '../utils.js';
import { icon, emptyState, errorState, pageSkeleton } from '../ui.js';
import { setTitle } from '../shell.js';
import * as B from '../books-api.js';
import { mountBookViewer, pageLabel } from '../components/book-viewer.js';

export default async function render({ view, params, query, alive }) {
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  view.innerHTML = String(pageSkeleton());
  const sid = state.student?.id;
  let link;
  try { link = (await B.myBooks()).find((r) => r.textbook_id === params.id); } catch (err) { if (alive()) view.innerHTML = String(errorState(err.message)); return; }
  if (!alive()) return;
  if (!link || !sid) {
    setTitle('Підручник недоступний');
    view.innerHTML = String(emptyState({ icon: 'book', title: 'Підручник недоступний', text: 'Можливо, вчитель його відкріпив.', action: html`<a class="btn btn--primary" href="#/s/books">Мої підручники</a>` }));
    return;
  }
  const book = link.textbook;
  const key = `kmitlyvo.bp.${book.id}.me`;
  let start = parseInt(query.p, 10);
  if (!Number.isFinite(start)) { try { start = parseInt(localStorage.getItem(key), 10); } catch { /* ignore */ } }
  if (!Number.isFinite(start)) start = Math.min(book.page_count, 1 + (book.page_offset || 0));
  setTitle(book.title);
  view.innerHTML = String(html`
    <div class="page-header">
      <div class="page-header__titles">
        <a class="back-link" href="#/s/books">${raw(icon('chevronLeft'))}Мої підручники</a>
        <h1 class="h1">${book.title}</h1>
        <p class="page-header__meta">Пишіть відповіді в жовтих полях. Усе зберігається саме, а вчитель бачить це одразу.</p>
      </div>
    </div>
    <div data-viewer></div>`);
  mountBookViewer(view.querySelector('[data-viewer]'), {
    book, mode: 'student', studentId: sid, studentName: state.student?.full_name, startPage: start,
    onPage: (p) => {
      try { localStorage.setItem(key, String(p)); } catch { /* ignore */ }
      history.replaceState(null, '', `#/s/books/${book.id}?p=${p}`);
      setTitle(`${pageLabel(book, p)} · ${book.title}`);
    },
  });
}
