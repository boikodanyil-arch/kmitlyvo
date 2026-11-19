// Interactive textbook viewer (PDF or page photos) with answer fields, teacher review, notes and realtime.
//
// mountBookViewer(root, {
//   book,                 textbooks row
//   mode: 'author' | 'review' | 'student'
//     author  – teacher marks answer fields on pages (shared by all students using this book)
//     review  – teacher works in one student's copy: sees/edits answers, ✓/✗, corrections, comments, emoji, notes
//     student – student fills fields and leaves notes; sees teacher marks live
//   studentId, studentName,  required for review/student
//   startPage,               PDF page index (1-based)
//   onPage(index),           called when the page changes
// }) → { destroy, goTo }
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { html, raw, esc, debounce, fmtDateTime } from '../utils.js';
import { icon, openModal, toast, toastError, confirmDialog } from '../ui.js';
import * as B from '../books-api.js';

const ZOOMS = [0.6, 0.75, 1, 1.25, 1.5, 2];
const narrow = () => window.matchMedia('(max-width: 640px)').matches;
const MAX_BASE_W = 920;

export const pageLabel = (book, idx) => {
  const p = idx - (book.page_offset || 0);
  return p >= 1 ? `ст. ${p}` : `PDF ${idx}`;
};
export const printedToIndex = (book, printed) => printed + (book.page_offset || 0);

export function mountBookViewer(root, opts) {
  const { book, mode } = opts;
  const studentId = opts.studentId || null;
  const isTeacher = mode !== 'student';
  const total = Math.max(1, book.page_count || 1);
  let page = Math.min(Math.max(1, opts.startPage || 1), total);
  let zoom = 1;
  let markup = mode === 'author';
  let placingNote = false;
  let fields = [];
  let answers = new Map(); // field_id → answer row
  let notes = [];
  let pdfDoc = null;
  let renderTicket = 0;
  let destroyed = false;
  let channel = null;
  let presence = [];
  const imgUrls = new Map();
  const saveTimers = new Map();
  let pendingSaves = 0;
  let pageCounts = new Map();

  root.innerHTML = String(html`<div class="bv bv--${mode}">
    <div class="bv-bar" role="toolbar" aria-label="Керування підручником">
      <div class="bv-bar__group">
        <button class="btn btn--secondary btn--icon btn--sm" type="button" data-bv="prev" aria-label="Попередня сторінка">${raw(icon('chevronLeft'))}</button>
        <label class="bv-pageinput"><span class="sr-only">Сторінка</span>
          <input class="input input--sm" type="number" inputmode="numeric" data-bv="pageinput" aria-describedby="bv-total">
        </label>
        <span class="text-sm muted" id="bv-total" data-bv="total"></span>
        <button class="btn btn--secondary btn--icon btn--sm" type="button" data-bv="next" aria-label="Наступна сторінка">${raw(icon('chevronRight'))}</button>
      </div>
      <div class="bv-bar__group">
        <button class="btn btn--ghost btn--icon btn--sm" type="button" data-bv="zoomout" aria-label="Зменшити">${raw(icon('minus'))}</button>
        <span class="text-sm bv-zoom" data-bv="zoom">100%</span>
        <button class="btn btn--ghost btn--icon btn--sm" type="button" data-bv="zoomin" aria-label="Збільшити">${raw(icon('plus'))}</button>
      </div>
      <div class="bv-bar__group bv-bar__group--end">
        ${isTeacher ? html`<button class="btn btn--sm ${markup ? 'btn--primary' : 'btn--secondary'}" type="button" data-bv="markup" aria-pressed="${markup}">${raw(icon('edit'))}<span>Поля</span></button>` : ''}
        ${mode !== 'author' ? html`<button class="btn btn--secondary btn--sm" type="button" data-bv="note" aria-pressed="false">${raw(icon('message'))}<span>Нотатка</span></button>` : ''}
        <span class="bv-presence" data-bv="presence" hidden></span>
        <span class="bv-save text-xs muted" data-bv="save" aria-live="polite"></span>
      </div>
    </div>
    <p class="bv-hint text-sm" data-bv="hint" hidden></p>
    <div class="bv-body">
      <div class="bv-stage" data-bv="stage">
        <div class="bv-page" data-bv="page">
          <div class="bv-sheet" data-bv="sheet"></div>
          <div class="bv-layer" data-bv="layer"></div>
        </div>
        <div class="bv-loading" data-bv="loading">${raw(icon('book'))}<span>Відкриваю сторінку…</span></div>
      </div>
      <aside class="bv-side" data-bv="side" aria-label="Сторінка"></aside>
    </div>
  </div>`);

  const $ = (k) => root.querySelector(`[data-bv="${k}"]`);
  const stage = $('stage'), pageEl = $('page'), sheet = $('sheet'), layer = $('layer');

  // ------------------------------------------------------------ helpers
  function setHint() {
    const h = $('hint');
    let t = '';
    if (placingNote) t = 'Торкніться місця на сторінці, де залишити нотатку. Esc — скасувати.';
    else if (markup) t = 'Режим полів: протягніть прямокутник там, де учень має писати відповідь. Натисніть на поле, щоб змінити або видалити.';
    h.hidden = !t; h.textContent = t;
    layer.classList.toggle('bv-layer--draw', markup && !placingNote);
    layer.classList.toggle('bv-layer--place', placingNote);
  }
  function setSave(text) { $('save').textContent = text; }
  function bumpSaving(d) {
    pendingSaves = Math.max(0, pendingSaves + d);
    setSave(pendingSaves ? 'Зберігаю…' : 'Збережено');
  }
  function syncBar() {
    const inp = $('pageinput');
    const printed = page - (book.page_offset || 0);
    inp.value = printed;
    inp.min = 1 - (book.page_offset || 0); inp.max = total - (book.page_offset || 0);
    $('total').textContent = book.page_offset ? `${pageLabel(book, page)} · PDF ${page} з ${total}` : `з ${total}`;
    $('prev').disabled = page <= 1;
    $('next').disabled = page >= total;
    $('zoom').textContent = `${Math.round(zoom * 100)}%`;
  }

  // ------------------------------------------------------------ rendering a page
  async function ensurePdf() {
    if (pdfDoc) return pdfDoc;
    const pdfjs = await B.loadPdfJs();
    const url = await B.bookUrl(book.file_path);
    pdfDoc = await pdfjs.getDocument({ url, disableAutoFetch: true, rangeChunkSize: 262144 }).promise;
    return pdfDoc;
  }
  async function imageUrl(idx) {
    if (!imgUrls.has(idx)) imgUrls.set(idx, B.bookUrl(book.pages[idx - 1]));
    return imgUrls.get(idx);
  }
  function baseWidth() { return Math.min(stage.clientWidth || 600, MAX_BASE_W); }

  async function drawSheet(ticket) {
    const w = Math.round(baseWidth() * zoom);
    if (book.source === 'pdf') {
      const doc = await ensurePdf();
      const pg = await doc.getPage(page);
      if (ticket !== renderTicket) return;
      const vp1 = pg.getViewport({ scale: 1 });
      const scale = w / vp1.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale: scale * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.className = 'bv-img';
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (ticket !== renderTicket) return;
      pageEl.style.width = `${w}px`;
      pageEl.style.height = `${Math.round(w * vp1.height / vp1.width)}px`;
      sheet.replaceChildren(canvas);
    } else {
      const url = await imageUrl(page);
      const img = new Image();
      img.className = 'bv-img'; img.alt = `Сторінка ${page}`; img.decoding = 'async';
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Не вдалося завантажити сторінку.')); img.src = url; });
      if (ticket !== renderTicket) return;
      pageEl.style.width = `${w}px`;
      pageEl.style.height = `${Math.round(w * img.naturalHeight / img.naturalWidth)}px`;
      sheet.replaceChildren(img);
    }
  }

  async function loadPageData() {
    const jobs = [B.listFields(book.id, page)];
    if (studentId) jobs.push(B.listAnswers(book.id, studentId, page), B.listNotes(book.id, studentId, page));
    const [f, a = [], n = []] = await Promise.all(jobs);
    fields = f; answers = new Map(a.map((r) => [r.field_id, r])); notes = n;
  }

  async function show(idx, { keepScroll = false } = {}) {
    page = Math.min(Math.max(1, idx), total);
    const ticket = ++renderTicket;
    syncBar();
    $('loading').hidden = false;
    pageEl.classList.add('bv-page--loading');
    try {
      await Promise.all([drawSheet(ticket), loadPageData()]);
      if (ticket !== renderTicket || destroyed) return;
      drawLayer();
      drawSide();
      if (!keepScroll) stage.scrollTo({ top: 0 });
      opts.onPage?.(page);
      trackPresence();
    } catch (err) {
      if (ticket !== renderTicket) return;
      console.error(err);
      sheet.innerHTML = String(html`<div class="bv-error">${raw(icon('alert'))}<p>${err.message || 'Не вдалося відкрити сторінку.'}</p></div>`);
      pageEl.style.height = 'auto';
    } finally {
      if (ticket === renderTicket) { $('loading').hidden = true; pageEl.classList.remove('bv-page--loading'); }
    }
  }

  // ------------------------------------------------------------ overlay layer
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  function fieldNo(f) { return fields.indexOf(f) + 1; }

  function fieldHtml(f) {
    const n = fieldNo(f);
    const style = `left:${pct(f.x)};top:${pct(f.y)};width:${pct(f.w)};height:${pct(f.h)}`;
    if (markup || mode === 'author') {
      return `<div class="bv-field bv-field--edit" data-fid="${f.id}" style="${style}" tabindex="0" role="button" aria-label="Поле ${n}${f.multiline ? ', багаторядкове' : ''}"><span class="bv-field__num">${n}</span></div>`;
    }
    const a = answers.get(f.id);
    const val = a?.value || '';
    const st = a?.status || '';
    const cls = ['bv-field', 'bv-field--answer', f.x + f.w > 0.72 ? 'bv-field--edge' : '', f.h > 0.06 ? 'bv-field--tall' : '', val ? 'bv-field--filled' : '', st === 'correct' ? 'bv-field--correct' : '', st === 'wrong' ? 'bv-field--wrong' : ''].filter(Boolean).join(' ');
    const fs = fontFor(f);
    const ro = narrow() ? ' readonly' : '';
    const input = f.multiline
      ? `<textarea class="bv-input" data-input="${f.id}" aria-label="Відповідь ${n}" style="font-size:${fs}px" maxlength="2000"${ro}>${esc(val)}</textarea>`
      : `<input class="bv-input" data-input="${f.id}" aria-label="Відповідь ${n}" style="font-size:${fs}px" maxlength="2000" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(val)}"${ro}>`;
    const hasMsg = a && (a.comment || a.emoji || a.correction);
    const badge = hasMsg ? `<button class="bv-badge" type="button" data-open="${f.id}" aria-label="Коментар вчителя до відповіді ${n}">${a.emoji ? esc(a.emoji) : icon('message', 'icon--sm')}</button>` : '';
    const mark = st === 'correct' ? `<span class="bv-mark bv-mark--ok" aria-label="правильно">${icon('check', 'icon--sm')}</span>` : st === 'wrong' ? `<span class="bv-mark bv-mark--bad" aria-label="неправильно">${icon('x', 'icon--sm')}</span>` : '';
    const corr = a?.correction ? `<div class="bv-corr" title="Виправлення вчителя">${esc(a.correction)}</div>` : '';
    const acts = mode === 'review' ? `<div class="bv-acts" role="group" aria-label="Перевірка відповіді ${n}">
        <button type="button" class="bv-act bv-act--ok" data-mark="correct" data-fid="${f.id}" aria-label="Правильно" aria-pressed="${st === 'correct'}">${icon('check', 'icon--sm')}</button>
        <button type="button" class="bv-act bv-act--bad" data-mark="wrong" data-fid="${f.id}" aria-label="Неправильно" aria-pressed="${st === 'wrong'}">${icon('x', 'icon--sm')}</button>
        <button type="button" class="bv-act" data-open="${f.id}" aria-label="Виправлення, коментар, емодзі">${icon('message', 'icon--sm')}</button>
      </div>` : '';
    return `<div class="${cls}" data-fid="${f.id}" style="${style}">${input}${mark}${badge}${corr}${acts}</div>`;
  }
  function fontFor(f) {
    const h = (pageEl.clientHeight || 1000) * f.h;
    const px = f.multiline ? Math.min(18, Math.max(11, (pageEl.clientWidth || 800) * 0.017)) : Math.min(20, Math.max(10, h * 0.62));
    return Math.round(px);
  }
  function noteHtml(n) {
    const mine = n.author_id === state.user?.id;
    return `<button type="button" class="bv-pin bv-pin--${n.author_role}${n.resolved ? ' bv-pin--resolved' : ''}" data-note="${n.id}" style="left:${pct(n.x)};top:${pct(n.y)}" aria-label="Нотатка від ${n.author_role === 'teacher' ? 'вчителя' : 'учня'}${mine ? ' (ваша)' : ''}">${n.emoji ? esc(n.emoji) : icon('message', 'icon--sm')}</button>`;
  }

  function drawLayer() {
    const focused = document.activeElement?.closest?.('[data-fid]')?.dataset.fid;
    const caret = document.activeElement?.selectionStart;
    layer.innerHTML = fields.map(fieldHtml).join('') + (mode !== 'author' ? notes.map(noteHtml).join('') : '');
    if (focused) {
      const el = layer.querySelector(`[data-input="${focused}"]`) || layer.querySelector(`[data-fid="${focused}"]`);
      if (el) { el.focus({ preventScroll: true }); try { if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); } catch { /* ignore */ } }
    }
  }
  function redrawField(fid) {
    const f = fields.find((x) => x.id === fid);
    const el = layer.querySelector(`.bv-field[data-fid="${fid}"]`);
    if (!f || !el) return drawLayer();
    const input = el.querySelector('[data-input]');
    if (input && document.activeElement === input) {
      // Don't clobber what the user is typing: refresh only the marks around the input.
      const tmp = document.createElement('div'); tmp.innerHTML = fieldHtml(f);
      const fresh = tmp.firstElementChild;
      const nv = answers.get(fid)?.value ?? '';
      if (!saveTimers.has(fid) && input.value !== nv) input.value = nv;
      el.className = fresh.className;
      [...el.children].forEach((c) => { if (c !== input) c.remove(); });
      [...fresh.children].forEach((c) => { if (!c.matches('[data-input]')) el.appendChild(c); });
      return;
    }
    el.outerHTML = fieldHtml(f);
  }

  // ------------------------------------------------------------ side panel
  async function drawSide() {
    const side = $('side');
    if (mode === 'author') {
      if (!pageCounts.size) { try { pageCounts = await B.fieldCounts(book.id); } catch { /* ignore */ } }
      const pages = [...pageCounts.entries()].sort((a, b) => a[0] - b[0]);
      side.innerHTML = String(html`<div class="card bv-card">
        <h2 class="h4">${pageLabel(book, page)}</h2>
        <p class="text-sm muted">${fields.length ? `${fields.length} ${fields.length === 1 ? 'поле' : fields.length < 5 ? 'поля' : 'полів'} для відповідей` : 'Полів ще немає.'}</p>
        <p class="text-sm">Поля, які ви тут позначите, побачать усі учні з цим підручником.</p>
        ${pages.length ? html`<h3 class="h5 bv-side__sub">Сторінки з полями</h3>
          <div class="bv-chips">${raw(pages.map(([p, c]) => `<button type="button" class="chip${p === page ? ' chip--active' : ''}" data-goto="${p}">${esc(pageLabel(book, p))} · ${c}</button>`).join(''))}</div>` : ''}
      </div>`);
      return;
    }
    const list = fields.map((f) => ({ f, a: answers.get(f.id) }));
    const filled = list.filter((x) => x.a?.value).length;
    const ok = list.filter((x) => x.a?.status === 'correct').length;
    const bad = list.filter((x) => x.a?.status === 'wrong').length;
    const unchecked = list.filter((x) => x.a?.value && x.a.status === 'answered').length;
    side.innerHTML = String(html`<div class="card bv-card">
      <h2 class="h4">${pageLabel(book, page)}</h2>
      ${fields.length ? html`<div class="bv-stats">
          <span><b>${filled}</b>/${fields.length} заповнено</span>
          <span class="bv-stat--ok">${raw(icon('check', 'icon--sm'))}${ok}</span>
          <span class="bv-stat--bad">${raw(icon('x', 'icon--sm'))}${bad}</span>
          ${unchecked ? html`<span class="muted">${unchecked} без перевірки</span>` : ''}
        </div>
        ${mode === 'review' && unchecked ? html`<button class="btn btn--secondary btn--sm btn--block" type="button" data-bv="allok">${raw(icon('checkCircle'))}<span>Неперевірені — правильно</span></button>` : ''}
        <ol class="bv-answers">${raw(list.map(({ f, a }, i) => `<li><button type="button" class="bv-answers__row" data-focus="${f.id}">
            <span class="bv-answers__n">${i + 1}</span>
            <span class="bv-answers__v ${a?.value ? '' : 'muted'}">${a?.value ? esc(a.value) : 'порожньо'}</span>
            ${a?.status === 'correct' ? `<span class="bv-stat--ok">${icon('check', 'icon--sm')}</span>` : a?.status === 'wrong' ? `<span class="bv-stat--bad">${icon('x', 'icon--sm')}</span>` : ''}
            ${a?.emoji ? `<span>${esc(a.emoji)}</span>` : ''}
          </button></li>`).join(''))}</ol>`
        : html`<p class="text-sm muted">${mode === 'review' ? 'На цій сторінці ще немає полів. Увімкніть «Поля», щоб їх позначити, або залиште нотатку.' : 'На цій сторінці немає полів для відповідей. Можна залишити нотатку чи питання вчителю.'}</p>`}
      ${notes.length ? html`<h3 class="h5 bv-side__sub">Нотатки</h3>
        <ul class="bv-notes">${raw(notes.map((n) => `<li><button type="button" class="bv-notes__row" data-note="${n.id}"><span class="bv-notes__who">${n.emoji ? esc(n.emoji) + ' ' : ''}${n.author_role === 'teacher' ? 'Вчитель' : 'Учень'}</span><span class="bv-notes__body">${esc(n.body)}</span></button></li>`).join(''))}</ul>` : ''}
    </div>`);
  }

  // ------------------------------------------------------------ saving answers
  function queueSave(fid, value) {
    clearTimeout(saveTimers.get(fid));
    if (!saveTimers.has(`p:${fid}`)) { saveTimers.set(`p:${fid}`, true); bumpSaving(1); }
    saveTimers.set(fid, setTimeout(async () => {
      saveTimers.delete(fid); saveTimers.delete(`p:${fid}`);
      try {
        const row = await B.saveAnswer(fid, studentId, { value });
        answers.set(fid, row);
        redrawField(fid);
        drawSide();
      } catch (err) { toastError(err); setSave('Не збережено'); }
      finally { bumpSaving(-1); }
    }, 650));
  }
  async function saveReview(fid, patch) {
    bumpSaving(1);
    try {
      const cur = answers.get(fid);
      const row = await B.saveAnswer(fid, studentId, { value: cur?.value ?? '', ...patch });
      answers.set(fid, row);
      redrawField(fid);
      drawSide();
    } catch (err) { toastError(err); }
    finally { bumpSaving(-1); }
  }

  function openStudentSheet(fid) {
    const f = fields.find((x) => x.id === fid); if (!f) return;
    const a = answers.get(fid) || {};
    const n = fieldNo(f);
    const { dialog, close } = openModal({
      title: `Відповідь ${n}`,
      body: html`<div class="stack">
        <div class="field"><label class="sr-only" for="bv-sheet">Ваша відповідь</label>
          <textarea class="textarea bv-sheet-input" id="bv-sheet" rows="${f.multiline ? 5 : 2}" maxlength="2000" autocapitalize="off" spellcheck="false">${a.value || ''}</textarea></div>
        ${a.status === 'correct' ? html`<p class="badge badge--success">${raw(icon('check', 'icon--sm'))}Вчитель: правильно</p>` : a.status === 'wrong' ? html`<p class="badge badge--danger">${raw(icon('x', 'icon--sm'))}Вчитель: є помилка</p>` : ''}
        ${a.correction ? html`<div><p class="label">Виправлення</p><p class="bv-quote bv-quote--corr">${a.correction}</p></div>` : ''}
        ${a.comment || a.emoji ? html`<div><p class="label">Коментар вчителя</p><p class="bv-quote">${a.emoji ? html`<span class="bv-bigemoji">${a.emoji}</span> ` : ''}${a.comment || ''}</p></div>` : ''}
      </div>`,
      foot: html`<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="button" data-save>Зберегти</button>`,
      onOpen: (d) => { const t = d.querySelector('textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); },
    });
    dialog.querySelector('[data-save]').addEventListener('click', async () => {
      const value = dialog.querySelector('textarea').value;
      close();
      bumpSaving(1);
      try { const row = await B.saveAnswer(fid, studentId, { value }); answers.set(fid, row); redrawField(fid); drawSide(); }
      catch (err) { toastError(err); }
      finally { bumpSaving(-1); }
    });
  }

  function openAnswer(fid) {
    const f = fields.find((x) => x.id === fid); if (!f) return;
    const a = answers.get(fid) || {};
    const n = fieldNo(f);
    if (mode === 'student') {
      openModal({
        title: `Відповідь ${n}`,
        body: html`<div class="stack">
          <div><p class="label">Ваша відповідь</p><p class="bv-quote">${a.value || '—'}</p></div>
          ${a.status === 'correct' ? html`<p class="badge badge--success">${raw(icon('check', 'icon--sm'))}Правильно</p>` : a.status === 'wrong' ? html`<p class="badge badge--danger">${raw(icon('x', 'icon--sm'))}Є помилка</p>` : ''}
          ${a.correction ? html`<div><p class="label">Виправлення вчителя</p><p class="bv-quote bv-quote--corr">${a.correction}</p></div>` : ''}
          ${a.comment || a.emoji ? html`<div><p class="label">Коментар вчителя</p><p class="bv-quote">${a.emoji ? html`<span class="bv-bigemoji">${a.emoji}</span> ` : ''}${a.comment || ''}</p></div>` : ''}
        </div>`,
        foot: html`<button class="btn btn--primary" type="button" data-close>Зрозуміло</button>`,
      });
      return;
    }
    let emoji = a.emoji || '';
    let status = a.status || 'answered';
    const { dialog, close } = openModal({
      title: `Відповідь ${n} · ${opts.studentName || 'учень'}`,
      body: html`<form class="stack" data-form>
        <div class="field"><label class="label" for="bv-val">Відповідь учня</label>
          <textarea class="textarea" id="bv-val" name="value" rows="2" maxlength="2000">${a.value || ''}</textarea></div>
        <fieldset class="field"><legend class="label">Оцінка</legend>
          <div class="segmented segmented--block" role="radiogroup">
            ${raw([['answered', 'Без оцінки'], ['correct', '✓ Правильно'], ['wrong', '✗ Помилка']].map(([k, l]) => `<label class="segmented__item"><input type="radio" name="status" value="${k}" ${status === k ? 'checked' : ''}><span>${l}</span></label>`).join(''))}
          </div></fieldset>
        <div class="field"><label class="label" for="bv-corr">Виправлення <span class="muted">(учень побачить червоним під полем)</span></label>
          <input class="input" id="bv-corr" name="correction" maxlength="2000" value="${a.correction || ''}"></div>
        <div class="field"><label class="label" for="bv-com">Коментар</label>
          <textarea class="textarea" id="bv-com" name="comment" rows="2" maxlength="1000" placeholder="Наприклад: чудово, лише подивись на артикль">${a.comment || ''}</textarea></div>
        <div class="field"><p class="label" id="bv-emo-l">Емодзі</p>
          <div class="bv-emojis" role="radiogroup" aria-labelledby="bv-emo-l">
            ${raw(['', ...B.EMOJIS].map((e) => `<button type="button" class="bv-emoji${e === emoji ? ' is-on' : ''}" data-emoji="${e}" role="radio" aria-checked="${e === emoji}" aria-label="${e || 'Без емодзі'}">${e || '∅'}</button>`).join(''))}
          </div></div>
      </form>`,
      foot: html`<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="button" data-save>Зберегти</button>`,
    });
    dialog.addEventListener('click', (e) => {
      const b = e.target.closest('[data-emoji]'); if (!b) return;
      emoji = b.dataset.emoji;
      dialog.querySelectorAll('[data-emoji]').forEach((x) => { const onn = x === b; x.classList.toggle('is-on', onn); x.setAttribute('aria-checked', onn); });
    });
    dialog.querySelector('[data-save]').addEventListener('click', async () => {
      const fd = new FormData(dialog.querySelector('[data-form]'));
      close();
      await saveReview(fid, { value: String(fd.get('value') || ''), status: String(fd.get('status') || 'answered'), correction: String(fd.get('correction') || '').trim(), comment: String(fd.get('comment') || '').trim(), emoji });
    });
  }

  // ------------------------------------------------------------ fields (markup)
  function openFieldMenu(fid) {
    const f = fields.find((x) => x.id === fid); if (!f) return;
    const { dialog, close } = openModal({
      title: `Поле ${fieldNo(f)}`,
      body: html`<div class="stack">
        <label class="switch"><span>Багаторядкове (для речень і текстів)</span><input type="checkbox" data-multi ${f.multiline ? raw('checked') : ''}></label>
        <p class="text-sm muted">Щоб змінити розмір, видаліть поле й позначте заново.</p>
      </div>`,
      foot: html`<button class="btn btn--danger-ghost" type="button" data-del>${raw(icon('trash'))}<span>Видалити поле</span></button><button class="btn btn--primary" type="button" data-close>Готово</button>`,
    });
    dialog.querySelector('[data-multi]').addEventListener('change', async (e) => {
      try { const row = await B.updateField(fid, { multiline: e.target.checked }); fields = fields.map((x) => (x.id === fid ? row : x)); drawLayer(); }
      catch (err) { toastError(err); }
    });
    dialog.querySelector('[data-del]').addEventListener('click', async () => {
      const used = studentId ? !!answers.get(fid)?.value : true;
      if (used && !(await confirmDialog({ title: 'Видалити поле?', text: 'Відповіді учнів у цьому полі теж буде видалено.', confirmLabel: 'Видалити', danger: true }))) return;
      close();
      try { await B.deleteField(fid); fields = fields.filter((x) => x.id !== fid); answers.delete(fid); bumpCount(-1); drawLayer(); drawSide(); }
      catch (err) { toastError(err); }
    });
  }
  function bumpCount(d) { pageCounts.set(page, Math.max(0, (pageCounts.get(page) || 0) + d)); if (!pageCounts.get(page)) pageCounts.delete(page); }

  let drag = null;
  function relPos(e) {
    const r = layer.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  layer.addEventListener('pointerdown', (e) => {
    if (placingNote) return;
    if (!markup || e.button > 0 || e.target.closest('.bv-field, .bv-pin')) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    const p = relPos(e);
    const ghost = document.createElement('div'); ghost.className = 'bv-field bv-field--ghost';
    layer.appendChild(ghost);
    drag = { start: p, ghost, id: e.pointerId };
  });
  layer.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = relPos(e); const s = drag.start;
    const x = Math.min(s.x, p.x), y = Math.min(s.y, p.y), w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
    Object.assign(drag.ghost.style, { left: pct(x), top: pct(y), width: pct(w), height: pct(h) });
    drag.rect = { x, y, w, h };
  });
  const endDrag = async (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { rect, ghost } = drag; drag = null;
    ghost.remove();
    if (!rect || rect.w < 0.015 || rect.h < 0.008) { if (rect) toast('Поле замале: протягніть трохи більший прямокутник.'); return; }
    try {
      const row = await B.createField({ textbook_id: book.id, page, x: rect.x, y: rect.y, w: rect.w, h: Math.max(rect.h, 0.012), multiline: rect.h > 0.05 });
      fields = [...fields, row].sort((a, b) => a.y - b.y || a.x - b.x);
      bumpCount(1); drawLayer(); drawSide();
    } catch (err) { toastError(err); }
  };
  layer.addEventListener('pointerup', endDrag);
  layer.addEventListener('pointercancel', (e) => { if (drag) { drag.ghost.remove(); drag = null; } });

  // ------------------------------------------------------------ notes
  async function placeNote(e) {
    const p = relPos(e);
    placingNote = false; setNoteBtn(); setHint();
    let emoji = '';
    const { dialog, close } = openModal({
      title: 'Нотатка на сторінці',
      body: html`<div class="stack">
        <div class="field"><label class="label" for="bv-note">${isTeacher ? 'Коментар чи підказка для учня' : 'Питання чи нотатка для вчителя'}</label>
          <textarea class="textarea" id="bv-note" rows="3" maxlength="1000" required></textarea></div>
        <div class="field"><p class="label">Емодзі</p><div class="bv-emojis">${raw(['', ...B.EMOJIS].map((x) => `<button type="button" class="bv-emoji${x === '' ? ' is-on' : ''}" data-emoji="${x}" aria-label="${x || 'Без емодзі'}">${x || '∅'}</button>`).join(''))}</div></div>
      </div>`,
      foot: html`<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="button" data-save>Додати</button>`,
      onOpen: (d) => d.querySelector('textarea').focus(),
    });
    dialog.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-emoji]'); if (!b) return;
      emoji = b.dataset.emoji; dialog.querySelectorAll('[data-emoji]').forEach((x) => x.classList.toggle('is-on', x === b));
    });
    dialog.querySelector('[data-save]').addEventListener('click', async () => {
      const body = dialog.querySelector('textarea').value.trim();
      if (!body) { dialog.querySelector('textarea').focus(); return; }
      close();
      try {
        const row = await B.addNote({ textbook_id: book.id, student_id: studentId, page, x: p.x, y: p.y, body, emoji });
        if (!notes.some((n) => n.id === row.id)) notes.push(row);
        drawLayer(); drawSide();
      } catch (err) { toastError(err); }
    });
  }
  function openNote(nid) {
    const n = notes.find((x) => x.id === nid); if (!n) return;
    const canDel = n.author_id === state.user?.id || isTeacher;
    const { dialog, close } = openModal({
      title: n.author_role === 'teacher' ? 'Нотатка вчителя' : 'Нотатка учня',
      body: html`<div class="stack"><p class="bv-quote">${n.emoji ? html`<span class="bv-bigemoji">${n.emoji}</span> ` : ''}${n.body}</p><p class="text-xs muted">${fmtDateTime ? fmtDateTime(n.created_at) : ''}</p></div>`,
      foot: html`${canDel ? html`<button class="btn btn--danger-ghost" type="button" data-del>${raw(icon('trash'))}<span>Видалити</span></button>` : ''}<button class="btn btn--primary" type="button" data-close>Закрити</button>`,
    });
    dialog.querySelector('[data-del]')?.addEventListener('click', async () => {
      close();
      try { await B.deleteNote(nid); notes = notes.filter((x) => x.id !== nid); drawLayer(); drawSide(); }
      catch (err) { toastError(err); }
    });
  }
  function setNoteBtn() {
    const b = $('note'); if (!b) return;
    b.setAttribute('aria-pressed', placingNote);
    b.classList.toggle('btn--primary', placingNote); b.classList.toggle('btn--secondary', !placingNote);
  }

  // ------------------------------------------------------------ realtime + presence
  function onAnswerChange(payload) {
    const row = payload.new;
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id;
      for (const [fid, a] of answers) if (a.id === id) { answers.delete(fid); redrawField(fid); drawSide(); }
      return;
    }
    if (!row || row.textbook_id !== book.id || row.page !== page) return;
    const prev = answers.get(row.field_id);
    if (prev && prev.updated_at && row.updated_at && prev.updated_at > row.updated_at) return;
    // While I'm typing in this field, keep my text; take the other side's marks.
    if (saveTimers.has(row.field_id) && prev) row.value = prev.value;
    answers.set(row.field_id, row);
    redrawField(row.field_id);
    drawSide();
    if (row.updated_by && row.updated_by !== state.user?.id) flash(row.field_id);
  }
  function flash(fid) {
    const el = layer.querySelector(`.bv-field[data-fid="${fid}"]`);
    if (!el) return;
    el.classList.remove('bv-field--flash'); void el.offsetWidth; el.classList.add('bv-field--flash');
  }
  function onNoteChange(payload) {
    if (payload.eventType === 'DELETE') { notes = notes.filter((n) => n.id !== payload.old?.id); drawLayer(); drawSide(); return; }
    const row = payload.new;
    if (!row || row.textbook_id !== book.id || row.page !== page) return;
    const i = notes.findIndex((n) => n.id === row.id);
    if (i >= 0) notes[i] = row; else notes.push(row);
    drawLayer(); drawSide();
  }
  async function onFieldChange(payload) {
    const row = payload.new || payload.old;
    if (payload.eventType !== 'DELETE' && row?.page !== page) return;
    try { fields = await B.listFields(book.id, page); } catch { return; }
    if (!document.activeElement?.closest?.('.bv-layer')) drawLayer(); else drawLayer();
    drawSide();
  }
  function subscribe() {
    if (mode === 'author' || !studentId) return;
    channel = sb.channel(`tb:${book.id}:${studentId}`, { config: { presence: { key: state.user?.id || 'anon' } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'textbook_answers', filter: `student_id=eq.${studentId}` }, onAnswerChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'textbook_notes', filter: `student_id=eq.${studentId}` }, onNoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'textbook_fields', filter: `textbook_id=eq.${book.id}` }, onFieldChange)
      .on('presence', { event: 'sync' }, () => {
        const st = channel.presenceState();
        presence = Object.entries(st).filter(([k]) => k !== state.user?.id).map(([, v]) => v[v.length - 1]).filter(Boolean);
        drawPresence();
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') trackPresence(); });
  }
  function trackPresence() {
    if (!channel) return;
    channel.track({ role: isTeacher ? 'teacher' : 'student', page, at: Date.now() }).catch(() => {});
  }
  function drawPresence() {
    const el = $('presence');
    const other = presence.find((p) => p.role !== (isTeacher ? 'teacher' : 'student'));
    if (!other) { el.hidden = true; return; }
    const who = other.role === 'student' ? (opts.studentName ? opts.studentName.split(' ')[0] : 'Учень') : 'Вчитель';
    const same = other.page === page;
    el.hidden = false;
    el.innerHTML = same
      ? `<span class="bv-dot" aria-hidden="true"></span>${esc(who)} тут`
      : `<span class="bv-dot" aria-hidden="true"></span><button type="button" class="link-btn" data-goto="${other.page}">${esc(who)} на ${esc(pageLabel(book, other.page))}</button>`;
  }

  // ------------------------------------------------------------ events
  root.addEventListener('click', (e) => {
    const t = e.target;
    const btn = t.closest('button[data-bv]');
    if (btn) {
      const k = btn.dataset.bv;
      if (k === 'prev' && page > 1) show(page - 1);
      if (k === 'next' && page < total) show(page + 1);
      if (k === 'zoomin' || k === 'zoomout') {
        const i = ZOOMS.indexOf(zoom) + (k === 'zoomin' ? 1 : -1);
        if (i >= 0 && i < ZOOMS.length) { zoom = ZOOMS[i]; show(page, { keepScroll: true }); }
      }
      if (k === 'markup') {
        markup = !markup; placingNote = false; setNoteBtn();
        btn.setAttribute('aria-pressed', markup); btn.classList.toggle('btn--primary', markup); btn.classList.toggle('btn--secondary', !markup);
        setHint(); drawLayer();
      }
      if (k === 'note') {
        placingNote = !placingNote;
        if (placingNote && markup && mode !== 'author') { markup = false; const mb = $('markup'); if (mb) { mb.setAttribute('aria-pressed', false); mb.classList.remove('btn--primary'); mb.classList.add('btn--secondary'); } drawLayer(); }
        setNoteBtn(); setHint();
      }
      if (k === 'allok') {
        const todo = fields.filter((f) => answers.get(f.id)?.value && answers.get(f.id).status === 'answered');
        Promise.all(todo.map((f) => saveReview(f.id, { status: 'correct' }))).then(() => toast('Готово'));
      }
      return;
    }
    const go = t.closest('[data-goto]'); if (go) { show(Number(go.dataset.goto)); return; }
    const mk = t.closest('[data-mark]');
    if (mk) {
      const fid = mk.dataset.fid; const cur = answers.get(fid)?.status;
      saveReview(fid, { status: cur === mk.dataset.mark ? 'answered' : mk.dataset.mark });
      return;
    }
    const op = t.closest('[data-open]'); if (op) { openAnswer(op.dataset.open); return; }
    const ti = t.closest('[data-input]');
    if (ti && narrow() && !markup) { if (mode === 'student') openStudentSheet(ti.dataset.input); else openAnswer(ti.dataset.input); return; }
    const pin = t.closest('[data-note]'); if (pin) { openNote(pin.dataset.note); return; }
    const fo = t.closest('[data-focus]');
    if (fo) { const inp = layer.querySelector(`[data-input="${fo.dataset.focus}"]`); if (inp) { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); inp.focus({ preventScroll: true }); } else { const fe = layer.querySelector(`[data-fid="${fo.dataset.focus}"]`); fe?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
    const fe = t.closest('.bv-field--edit');
    if (fe && markup) { openFieldMenu(fe.dataset.fid); return; }
    if (placingNote && t.closest('[data-bv="layer"]')) placeNote(e);
  });
  root.addEventListener('keydown', (e) => {
    const fe = e.target.closest?.('.bv-field--edit');
    if (fe && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openFieldMenu(fe.dataset.fid); }
    if (e.key === 'Escape' && placingNote) { placingNote = false; setNoteBtn(); setHint(); }
  });
  root.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-input]');
    if (inp && studentId) { inp.closest('.bv-field')?.classList.toggle('bv-field--filled', !!inp.value); queueSave(inp.dataset.input, inp.value); }
  });
  $('pageinput').addEventListener('change', (e) => {
    const printed = parseInt(e.target.value, 10);
    if (Number.isFinite(printed)) show(printedToIndex(book, printed)); else syncBar();
  });
  const onKey = (e) => {
    if (!root.isConnected) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    if (e.key === 'ArrowRight' && page < total) show(page + 1);
    if (e.key === 'ArrowLeft' && page > 1) show(page - 1);
  };
  document.addEventListener('keydown', onKey);
  const onResize = debounce(() => { if (root.isConnected) show(page, { keepScroll: true }); }, 250);
  let lastW = stage.clientWidth;
  const ro = new ResizeObserver(() => { if (Math.abs(stage.clientWidth - lastW) > 24) { lastW = stage.clientWidth; onResize(); } });
  ro.observe(stage);
  const beforeUnload = (e) => { if (pendingSaves) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const onHash = () => setTimeout(() => { if (!root.isConnected) destroy(); }, 0);
  window.addEventListener('hashchange', onHash);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('hashchange', onHash);
    ro.disconnect();
    if (channel) sb.removeChannel(channel);
    pdfDoc?.destroy?.();
  }

  setHint();
  setSave('');
  subscribe();
  show(page);
  return { destroy, goTo: (idx) => show(idx) };
}
