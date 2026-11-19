// Data access for textbooks (підручники): library, student links, fields, answers, notes.
import { sb, must } from './supabase.js';
import { state } from './state.js';
import { fileSafeName } from './utils.js';

export const BOOKS_BUCKET = 'books';
export const MAX_BOOK_MB = 50;
export const BOOK_KINDS = {
  student_book: { label: 'Student book', short: 'SB' },
  workbook: { label: 'Workbook', short: 'WB' },
  other: { label: 'Інше', short: '•' },
};
export const EMOJIS = ['👍', '🔥', '⭐', '👏', '😊', '💪', '🤔', '❗'];

const spaceId = () => state.space?.id;

// ---------------------------------------------------------------- library
export async function listBooks() {
  return must(await sb.from('textbooks').select('*').eq('space_id', spaceId()).order('created_at', { ascending: false }));
}
export async function getBook(id) {
  return must(await sb.from('textbooks').select('*').eq('id', id).maybeSingle());
}
export async function deleteBook(book) {
  const paths = [book.file_path, ...(book.pages || [])].filter(Boolean);
  if (paths.length) await sb.storage.from(BOOKS_BUCKET).remove(paths);
  return must(await sb.from('textbooks').delete().eq('id', book.id));
}
export async function updateBook(id, patch) {
  return must(await sb.from('textbooks').update(patch).eq('id', id).select().single());
}

/** Count PDF pages in the browser (pdf.js). */
export async function pdfPageCount(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = doc.numPages; doc.destroy();
  return n;
}

/**
 * Create a textbook: insert the row first (storage rules need it), then upload.
 * files: one PDF, or several images (pages in file-name order).
 */
export async function createBook({ title, kind, level, files }, onProgress = () => {}) {
  const isPdf = files.length === 1 && (files[0].type === 'application/pdf' || /\.pdf$/i.test(files[0].name));
  for (const f of files) {
    if (f.size > MAX_BOOK_MB * 1024 * 1024) throw new Error(`Файл «${f.name}» більший за ${MAX_BOOK_MB} МБ. Стисніть PDF (наприклад, ilovepdf.com) або завантажте частинами.`);
  }
  const pageCount = isPdf ? await pdfPageCount(files[0]) : files.length;
  const row = must(await sb.from('textbooks').insert({
    space_id: spaceId(), owner_id: state.user.id, title, kind, level: level || '',
    source: isPdf ? 'pdf' : 'images', page_count: pageCount,
  }).select().single());
  try {
    const base = `${spaceId()}/${row.id}`;
    if (isPdf) {
      onProgress(0, 1);
      const path = `${base}/${fileSafeName(files[0].name) || 'book.pdf'}`;
      const { error } = await sb.storage.from(BOOKS_BUCKET).upload(path, files[0], { contentType: 'application/pdf', upsert: false });
      if (error) throw error;
      onProgress(1, 1);
      return must(await sb.from('textbooks').update({ file_path: path }).eq('id', row.id).select().single());
    }
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const pages = [];
    for (let i = 0; i < sorted.length; i++) {
      onProgress(i, sorted.length);
      const f = sorted[i];
      const path = `${base}/${String(i + 1).padStart(4, '0')}-${fileSafeName(f.name)}`;
      const { error } = await sb.storage.from(BOOKS_BUCKET).upload(path, f, { contentType: f.type || 'image/jpeg', upsert: false });
      if (error) throw error;
      pages.push(path);
    }
    onProgress(sorted.length, sorted.length);
    return must(await sb.from('textbooks').update({ pages }).eq('id', row.id).select().single());
  } catch (err) {
    console.error(err);
    await sb.from('textbooks').delete().eq('id', row.id);
    if (/mime|type/i.test(err?.message || '')) throw new Error('Підтримуються лише PDF або фото (JPG, PNG, WebP).');
    if (/size|large|exceed/i.test(err?.message || '')) throw new Error(`Файл завеликий. Максимум ${MAX_BOOK_MB} МБ.`);
    throw new Error('Не вдалося завантажити підручник. Спробуйте ще раз.');
  }
}

export async function bookUrl(path, expires = 6 * 3600) {
  const { data, error } = await sb.storage.from(BOOKS_BUCKET).createSignedUrl(path, expires);
  if (error) { console.error(error); throw new Error('Не вдалося відкрити файл підручника.'); }
  return data.signedUrl;
}

// ---------------------------------------------------------------- student links
export async function listStudentBooks(studentId) {
  const rows = must(await sb.from('student_textbooks').select('textbook_id, is_primary, created_at, textbook:textbooks(*)').eq('student_id', studentId));
  return rows.filter((r) => r.textbook)
    .sort((a, b) => (b.is_primary - a.is_primary) || a.textbook.kind.localeCompare(b.textbook.kind) || a.textbook.title.localeCompare(b.textbook.title));
}
export async function bookStudents(textbookId) {
  return must(await sb.from('student_textbooks').select('student_id, is_primary, student:students(id, full_name, cefr_level, user_id)').eq('textbook_id', textbookId));
}
export async function attachBook(studentId, textbookId, isPrimary = false) {
  return must(await sb.from('student_textbooks').upsert({ student_id: studentId, textbook_id: textbookId, space_id: spaceId(), is_primary: isPrimary }, { onConflict: 'student_id,textbook_id' }).select().single());
}
export async function setPrimary(studentId, textbookId, isPrimary) {
  return must(await sb.from('student_textbooks').update({ is_primary: isPrimary }).eq('student_id', studentId).eq('textbook_id', textbookId).select().single());
}
export async function detachBook(studentId, textbookId) {
  return must(await sb.from('student_textbooks').delete().eq('student_id', studentId).eq('textbook_id', textbookId));
}
/** Student side: my own linked books. */
export async function myBooks() {
  const ids = (state.studentRecords || []).map((s) => s.id);
  const sid = state.student?.id || ids[0];
  if (!sid) return [];
  return listStudentBooks(sid);
}

// ---------------------------------------------------------------- fields
export async function listFields(textbookId, page) {
  return must(await sb.from('textbook_fields').select('*').eq('textbook_id', textbookId).eq('page', page).order('y').order('x'));
}
export async function createField(f) {
  return must(await sb.from('textbook_fields').insert(f).select().single());
}
export async function updateField(id, patch) {
  return must(await sb.from('textbook_fields').update(patch).eq('id', id).select().single());
}
export async function deleteField(id) {
  return must(await sb.from('textbook_fields').delete().eq('id', id));
}
export async function fieldCounts(textbookId) {
  const rows = must(await sb.from('textbook_fields').select('page').eq('textbook_id', textbookId));
  const m = new Map(); rows.forEach((r) => m.set(r.page, (m.get(r.page) || 0) + 1));
  return m;
}

// ---------------------------------------------------------------- answers & notes
export async function listAnswers(textbookId, studentId, page) {
  return must(await sb.from('textbook_answers').select('*').eq('textbook_id', textbookId).eq('student_id', studentId).eq('page', page));
}
/** Upsert by (field, student). Staff may pass status/correction/comment/emoji; the DB ignores them for students. */
export async function saveAnswer(fieldId, studentId, patch) {
  const row = { field_id: fieldId, student_id: studentId, ...patch };
  return must(await sb.from('textbook_answers').upsert(row, { onConflict: 'field_id,student_id' }).select().single());
}
export async function answerStats(textbookId, studentId) {
  const rows = must(await sb.from('textbook_answers').select('page, status, value').eq('textbook_id', textbookId).eq('student_id', studentId));
  return rows;
}
export async function listNotes(textbookId, studentId, page) {
  return must(await sb.from('textbook_notes').select('*').eq('textbook_id', textbookId).eq('student_id', studentId).eq('page', page).order('created_at'));
}
export async function addNote(n) {
  return must(await sb.from('textbook_notes').insert(n).select().single());
}
export async function updateNote(id, patch) {
  return must(await sb.from('textbook_notes').update(patch).eq('id', id).select().single());
}
export async function deleteNote(id) {
  return must(await sb.from('textbook_notes').delete().eq('id', id));
}

// ---------------------------------------------------------------- pdf.js
let pdfjsPromise = null;
export function loadPdfJs() {
  if (!pdfjsPromise) {
    const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
    pdfjsPromise = import(`${base}pdf.min.mjs`).then((m) => {
      m.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
      return m;
    }).catch((e) => { pdfjsPromise = null; console.error(e); throw new Error('Не вдалося завантажити переглядач PDF. Перевірте інтернет.'); });
  }
  return pdfjsPromise;
}

// ---------------------------------------------------------------- homework on textbook pages
/** Link the book to the student if it isn't yet (keeps an existing "primary" flag). */
export async function ensureAttached(studentId, textbookId) {
  return must(await sb.from('student_textbooks').upsert({ student_id: studentId, textbook_id: textbookId, space_id: spaceId() }, { onConflict: 'student_id,textbook_id', ignoreDuplicates: true }));
}
/** Progress on a page range (PDF indexes): fields, filled, correct, wrong. */
export async function pagesProgress(textbookId, studentId, from, to) {
  const [fields, answers] = await Promise.all([
    must(await sb.from('textbook_fields').select('id').eq('textbook_id', textbookId).gte('page', from).lte('page', to)),
    must(await sb.from('textbook_answers').select('field_id, value, status').eq('textbook_id', textbookId).eq('student_id', studentId).gte('page', from).lte('page', to)),
  ]);
  const ids = new Set(fields.map((f) => f.id));
  const mine = answers.filter((a) => ids.has(a.field_id));
  return {
    fields: ids.size,
    filled: mine.filter((a) => (a.value || '').trim()).length,
    correct: mine.filter((a) => a.status === 'correct').length,
    wrong: mine.filter((a) => a.status === 'wrong').length,
  };
}
export function rangeLabel(book, from, to) {
  const off = book?.page_offset || 0;
  const a = from - off, b = to - off;
  if (a >= 1 && b >= 1) return a === b ? `ст. ${a}` : `ст. ${a}–${b}`;
  return from === to ? `PDF ${from}` : `PDF ${from}–${to}`;
}
