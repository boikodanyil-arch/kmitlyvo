// Textbook workspace for teachers (#/t/books/:id?student=ID&p=N).
//   no student → mark answer fields (shared by all students)
//   ?student=  → that student's copy: answers, review, notes, realtime
import { state } from '../state.js';
import { html, raw, esc, plural } from '../utils.js';
import { icon, emptyState, errorState, pageSkeleton, on } from '../ui.js';
import { navigate } from '../router.js';
import { setTitle } from '../shell.js';
import * as B from '../books-api.js';
import { mountBookViewer, pageLabel } from '../components/book-viewer.js';
import { openBookSettings } from '../components/book-upload.js';
import { openAttachStudents } from '../components/student-books.js';

const lastKey = (bookId, sid) => `kmitlyvo.bp.${bookId}.${sid || 'author'}`;

export default async function render({ view, params, query, alive }) {
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  view.innerHTML = String(pageSkeleton());
  let book, links;
  try {
    [book, links] = await Promise.all([B.getBook(params.id), B.bookStudents(params.id).catch(() => [])]);
  } catch (err) { if (alive()) view.innerHTML = String(errorState(err.message)); return; }
  if (!alive()) return;
  if (!book) {
    setTitle('Підручник не знайдено');
    view.innerHTML = String(emptyState({ icon: 'book', title: 'Підручник не знайдено', text: 'Можливо, його видалили.', action: html`<a class="btn btn--primary" href="#/t/books">До підручників</a>` }));
    return;
  }
  const students = links.filter((l) => l.student).map((l) => l.student).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const sid = query.student && students.some((s) => s.id === query.student) ? query.student : null;
  const student = students.find((s) => s.id === sid) || null;
  setTitle(student ? `${book.title} · ${student.full_name}` : book.title);
  const canAdmin = book.owner_id === state.user?.id || ['owner', 'admin'].includes(state.role);
  let start = parseInt(query.p, 10);
  if (!Number.isFinite(start)) { try { start = parseInt(localStorage.getItem(lastKey(book.id, sid)), 10); } catch { /* ignore */ } }
  if (!Number.isFinite(start)) start = Math.min(book.page_count, 1 + (book.page_offset || 0));

  const kind = (B.BOOK_KINDS[book.kind] || B.BOOK_KINDS.other).label;
  view.innerHTML = String(html`
    <div class="page-header">
      <div class="page-header__titles">
        <a class="back-link" href="${student ? `#/t/students/${student.id}?tab=books` : '#/t/books'}">${raw(icon('chevronLeft'))}${student ? student.full_name : 'Підручники'}</a>
        <h1 class="h1">${book.title}</h1>
        <p class="page-header__meta">${kind}${book.level ? ` · ${book.level}` : ''} · ${book.page_count} ${plural(book.page_count, 'сторінка', 'сторінки', 'сторінок')}</p>
      </div>
      <div class="page-header__actions">
        <label class="sr-only" for="bk-who">Чий зошит</label>
        <select class="select" id="bk-who" data-who>
          <option value="">Розмітка полів (для всіх учнів)</option>
          ${raw(students.map((s) => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>Зошит: ${esc(s.full_name)}</option>`).join(''))}
        </select>
        <button class="btn btn--secondary" type="button" data-action="attach">${raw(icon('users'))}<span>Закріпити</span></button>
        ${canAdmin ? html`<button class="btn btn--ghost btn--icon" type="button" data-action="settings" aria-label="Налаштування підручника">${raw(icon('settings'))}</button>` : ''}
      </div>
    </div>
    ${student ? html`<div class="alert alert--info bk-mode">${raw(icon('users'))}<div><p class="alert__title">Зошит учня: ${student.full_name}</p>Відповіді й позначки з'являються в обох одразу. Наведіть або торкніться поля, щоб поставити ✓ / ✗ чи додати коментар з емодзі.</div></div>`
      : students.length ? '' : html`<div class="alert alert--warning bk-mode">${raw(icon('info'))}<div>Підручник ще ні за ким не закріплено. Позначте поля для відповідей і натисніть «Закріпити».</div></div>`}
    <div data-viewer></div>`);

  const viewer = mountBookViewer(view.querySelector('[data-viewer]'), {
    book,
    mode: student ? 'review' : 'author',
    studentId: student?.id,
    studentName: student?.full_name,
    startPage: start,
    onPage: (p) => {
      try { localStorage.setItem(lastKey(book.id, sid), String(p)); } catch { /* ignore */ }
      const qs = new URLSearchParams(); if (sid) qs.set('student', sid); qs.set('p', String(p));
      history.replaceState(null, '', `#/t/books/${book.id}?${qs}`);
      setTitle(`${pageLabel(book, p)} · ${student ? student.full_name : book.title}`);
    },
  });

  view.querySelector('[data-who]').addEventListener('change', (e) => {
    viewer.destroy();
    const v = e.target.value;
    navigate(`/t/books/${book.id}${v ? `?student=${v}` : ''}`);
  });
  on(view, '[data-action="attach"]', () => openAttachStudents({ book, attachedIds: students.map((s) => s.id), onDone: () => navigate(`/t/books/${book.id}${sid ? `?student=${sid}` : ''}`, { replace: true }) }));
  on(view, '[data-action="settings"]', () => openBookSettings({
    book,
    onSaved: () => navigate(`/t/books/${book.id}${sid ? `?student=${sid}` : ''}`, { replace: true }),
    onDeleted: () => { viewer.destroy(); navigate('/t/books'); },
  }));
}
