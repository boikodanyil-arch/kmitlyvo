// #/t/assignments/new?student=ID&lesson=ID&from=ID: assignment builder.
import * as api from '../api.js';
import { sb } from '../supabase.js';
import { BUCKET } from '../config.js';
import { state, isSchool } from '../state.js';
import { setTitle } from '../shell.js';
import { navigate } from '../router.js';
import { html, raw, esc, plural, uid, todayKey, addDays, fromZoned, fmtFullDate, fmtDate, fmtTime, fmtDateShort, safeUrl, fileSafeName } from '../utils.js';
import { icon, pageHeader, emptyState, errorState, toast, toastError, on, fieldError, clearErrors, setLoading } from '../ui.js';
import {
  ic, KINDS, kindOf, fileIcon, fmtSize, isImage, letter, MAX_MB, studentPickerHtml, bindStudentPicker,
} from './t-assignments.js';

const ACCEPT = 'image/*,audio/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const okType = (f) => /^(image|audio)\//.test(f.type) || /\.(pdf|docx?|jpe?g|png|webp|heic|gif|m4a|mp3|wav|ogg|aac)$/i.test(f.name)
  || ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(f.type);
const DUE_PRESETS = [['1', 'Завтра'], ['3', 'Через 3 дні'], ['7', 'Через тиждень'], ['none', 'Без дедлайну']];
const DEFAULT_TIME = '20:00';
const MAX_OPTS = 6;

const newQuestion = (qtype = 'single') => ({ key: uid().slice(0, 8), qtype, prompt: '', options: ['', ''], correct: null, accepted: '' });

/** Parse the "quick add" textarea. Returns { questions, bad: [lineNumbers] } */
export function parseQuick(text) {
  const questions = []; const bad = [];
  String(text || '').split('\n').forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    const cut = l.lastIndexOf('|');
    if (cut < 1) { bad.push(i + 1); return; }
    const prompt = l.slice(0, cut).trim();
    const parts = l.slice(cut + 1).split(',').map((x) => x.trim()).filter(Boolean);
    if (!prompt || !parts.length) { bad.push(i + 1); return; }
    const star = parts.findIndex((p) => p.startsWith('*'));
    if (star > -1) {
      const options = parts.map((p) => p.replace(/^\*+\s*/, '')).filter(Boolean).slice(0, MAX_OPTS);
      if (options.length < 2) { bad.push(i + 1); return; }
      questions.push({ ...newQuestion('single'), prompt, options, correct: Math.min(star, options.length - 1) });
    } else {
      questions.push({ ...newQuestion('gap'), prompt, options: ['', ''], accepted: parts.join(', ') });
    }
  });
  return { questions, bad };
}

/** Validation message for a question or '' */
function questionError(q) {
  if (!q.prompt.trim()) return 'Напишіть текст питання.';
  if (q.qtype === 'single') {
    const filled = q.options.filter((o) => o.trim()).length;
    if (filled < 2) return 'Додайте щонайменше 2 варіанти відповіді.';
    if (q.correct == null || !q.options[q.correct]?.trim()) return 'Позначте правильну відповідь.';
  } else {
    if (!/_{2,}/.test(q.prompt)) return 'Позначте пропуск у реченні як ___ (три підкреслення).';
    if (!acceptedList(q).length) return 'Вкажіть правильну відповідь.';
  }
  return '';
}
const acceptedList = (q) => q.accepted.split(',').map((x) => x.trim()).filter(Boolean);
/** Builder question → api question */
function toApi(q) {
  if (q.qtype === 'gap') return { qtype: 'gap', prompt: q.prompt.trim(), options: [], answer: acceptedList(q) };
  const kept = []; let answer = 0;
  q.options.forEach((o, i) => { if (o.trim()) { if (i === q.correct) answer = kept.length; kept.push(o.trim()); } });
  return { qtype: 'single', prompt: q.prompt.trim(), options: kept, answer };
}

export default async function render({ view, query, alive }) {
  setTitle('Нове завдання');
  view.classList.add('tk-page');
  view.innerHTML = String(html`${pageHeader({ title: 'Нове завдання', back: { href: '#/t/assignments', label: 'Завдання' } })}
    <div class="split"><div class="stack">${[1, 2, 3].map(() => html`<div class="card"><span class="skeleton skeleton--title" style="width:40%"></span><span class="skeleton skeleton--block" style="height:120px;margin-top:16px"></span></div>`)}</div>
    <div class="card hide-mobile"><span class="skeleton skeleton--text" style="width:70%"></span><span class="skeleton skeleton--text" style="width:50%"></span></div></div>
    <span class="sr-only" role="status">Завантаження…</span>`);

  let students = []; let src = null; let srcQuiz = []; let lesson = null;
  try {
    [students, src, srcQuiz, lesson] = await Promise.all([
      api.listStudents(),
      query.from ? api.getAssignment(query.from) : null,
      query.from ? api.getQuiz(query.from, { withKeys: true }).catch(() => []) : [],
      query.lesson ? api.getLesson(query.lesson).catch(() => null) : null,
    ]);
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(html`${pageHeader({ title: 'Нове завдання', back: { href: '#/t/assignments', label: 'Завдання' } })}${errorState(err.message)}`);
    return;
  }
  if (!alive()) return;

  const preStudent = query.student || lesson?.student_id || null;
  students = students.filter((s) => s.status === 'active' || s.id === preStudent);

  // ---------------- builder state ----------------
  const b = {
    kind: 'text', title: '', instructions: '', link_url: '',
    files: [], // { key, file?, path?, name, type, size, preview? }
    questions: [],
    selected: new Set(preStudent && students.some((s) => s.id === preStudent) ? [preStudent] : []),
    due: { preset: '7', date: addDays(todayKey(), 7), time: DEFAULT_TIME },
    lessonId: lesson?.id || null,
    tried: false,
    busy: false,
  };
  if (src) {
    b.kind = src.kind; b.title = src.title; b.instructions = src.instructions || ''; b.link_url = src.link_url || '';
    b.files = (src.attachments || []).map((f) => ({ key: uid().slice(0, 8), ...f, copy: true }));
    b.questions = srcQuiz.map((q) => ({
      key: uid().slice(0, 8), qtype: q.qtype, prompt: q.prompt || '',
      options: q.qtype === 'single' ? [...(q.options || [])] : ['', ''],
      correct: q.qtype === 'single' ? Number(q.answer ?? 0) : null,
      accepted: q.qtype === 'gap' ? (Array.isArray(q.answer) ? q.answer : []).join(', ') : '',
    }));
    if (b.kind === 'quiz' && !b.questions.length) b.questions.push(newQuestion());
  } else if (lesson?.topic) {
    b.title = `Домашнє: ${lesson.topic}`;
  }

  const titleText = src ? 'Копія завдання' : 'Нове завдання';
  setTitle(titleText);

  // ---------------- static layout ----------------
  view.innerHTML = String(html`
    ${pageHeader({
      title: titleText,
      back: { href: src ? `#/t/assignments/${src.id}` : '#/t/assignments', label: src ? src.title : 'Завдання' },
      meta: src ? 'Змініть, що потрібно, і оберіть учнів. Оригінал залишиться без змін.' : 'Тип, зміст, учні й дедлайн. Займе хвилину.',
    })}
    <div class="split tk-builder">
      <form class="tk-form" id="builder" novalidate>
        <section class="card tk-sec" aria-labelledby="sec-kind">
          <h2 class="h3 tk-sec__title" id="sec-kind">Тип завдання</h2>
          <div class="tk-kinds" role="radiogroup" aria-labelledby="sec-kind">
            ${Object.entries(KINDS).map(([k, v]) => html`<label class="role-card tk-kindcard"><input type="radio" name="kind" value="${k}" ${b.kind === k ? raw('checked') : ''}>
              <span>${ic(v.icon)}<b>${v.label}</b><small class="tk-kindcard__hint">${v.hint}</small></span></label>`)}
          </div>
        </section>

        <section class="card tk-sec" aria-labelledby="sec-content">
          <h2 class="h3 tk-sec__title" id="sec-content">Зміст</h2>
          <div class="form">
            ${lesson ? html`<div class="alert tk-lesson" data-lesson>${ic('calendar')}<div class="grow"><p class="alert__title">Домашнє до уроку</p>
              ${fmtDate(lesson.starts_at)}, ${fmtTime(lesson.starts_at)}${lesson.student ? ` · ${lesson.student.full_name}` : ''}${lesson.topic ? ` · ${lesson.topic}` : ''}</div>
              <button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="unlink-lesson" aria-label="Не привʼязувати до уроку">${ic('x')}</button></div>` : ''}
            <div class="field"><label class="label" for="b-title">Назва</label>
              <input class="input" id="b-title" name="title" maxlength="200" required value="${b.title}" placeholder="Наприклад: Present Perfect — вправи 1–4" autocomplete="off"></div>
            <div class="field"><label class="label" for="b-instr">Інструкція <span class="label__opt">(необовʼязково)</span></label>
              <textarea class="textarea" id="b-instr" name="instructions" rows="4" maxlength="5000" placeholder="">${b.instructions}</textarea>
              <p class="hint" data-instr-hint></p></div>
            <div class="field" data-link-field hidden><label class="label" for="b-link">Посилання</label>
              <div class="input-wrap">${ic('link')}<input class="input" id="b-link" name="link_url" type="url" inputmode="url" placeholder="https://" value="${b.link_url}" autocomplete="off"></div>
              <p class="hint">Відео на YouTube, стаття, вправа на Wordwall чи LearningApps.</p></div>
            <div class="field">
              <span class="label" id="b-files-l">Матеріали <span class="label__opt">(необовʼязково)</span></span>
              <label class="dropzone tk-dropzone" data-dropzone>
                <input type="file" multiple accept="${ACCEPT}" aria-labelledby="b-files-l" aria-describedby="b-files-h" data-files>
                <span class="dropzone__icon">${ic('upload')}</span>
                <span class="dropzone__title"><span class="hide-mobile">Перетягніть файли сюди або натисніть, щоб обрати</span><span class="show-mobile">Додати файли</span></span>
                <span class="dropzone__hint" id="b-files-h">PDF, фото, аудіо, Word — до ${MAX_MB} МБ кожен</span>
              </label>
              <ul class="thumbs tk-upthumbs" data-thumbs></ul>
            </div>
          </div>
        </section>

        <section class="card tk-sec" aria-labelledby="sec-quiz" data-quiz-sec hidden>
          <div class="tk-sec__head">
            <h2 class="h3 tk-sec__title" id="sec-quiz">Питання квізу</h2>
            <span class="badge badge--lg" data-qcount aria-live="polite"></span>
          </div>
          <p class="text-sm muted">Квіз перевіряється автоматично: учень одразу бачить результат, а оцінка ставиться за шкалою ${state.space?.grade_scale || 12}.</p>
          <ol class="tk-qlist" data-qlist></ol>
          <div class="tk-qadd">
            <button class="btn btn--secondary" type="button" data-action="q-add" data-qtype="single">${ic('plus')}Вибір відповіді</button>
            <button class="btn btn--secondary" type="button" data-action="q-add" data-qtype="gap">${ic('plus')}Вписати слово</button>
          </div>
          <details class="tk-quick" data-quick>
            <summary>${ic('sparkles')}Швидке додавання <span class="muted">— вставте кілька рядків</span></summary>
            <div class="tk-quick__body">
              <p class="text-sm">Один рядок — одне питання. Після <kbd>|</kbd> напишіть відповідь. Кілька варіантів через кому, а правильний позначте <kbd>*</kbd>.</p>
              <pre class="tk-quick__ex">She ___ (go) to school every day. | goes
Yesterday I ___ to the cinema. | go, *went, gone</pre>
              <div class="field"><label class="label sr-only" for="b-quick">Питання списком</label>
                <textarea class="textarea tk-mono" id="b-quick" rows="5" placeholder="Речення з ___ | відповідь" data-quick-text></textarea>
                <p class="hint" data-quick-hint aria-live="polite">Перший рядок стане вписуванням слова, другий — вибором відповіді.</p></div>
              <div><button class="btn btn--soft" type="button" data-action="quick-add" disabled>${ic('plus')}<span>Додати питання</span></button></div>
            </div>
          </details>
          <p class="error-text" data-quiz-err hidden></p>
        </section>

        <section class="card tk-sec" aria-labelledby="sec-who">
          <div class="tk-sec__head">
            <h2 class="h3 tk-sec__title" id="sec-who">Кому</h2>
            <span class="text-sm muted" data-who-count aria-live="polite"></span>
          </div>
          ${students.length ? studentPickerHtml(students, { idPrefix: 'b-st', showTeacher: isSchool() })
            : emptyState({ plain: true, icon: 'users', title: 'Поки немає активних учнів', text: 'Завдання можна зберегти в бібліотеку, а призначити пізніше — зі сторінки завдання.', action: html`<a class="btn btn--secondary" href="#/t/students">${ic('plus')}Додати учня</a>` })}
        </section>

        <section class="card tk-sec" aria-labelledby="sec-due">
          <h2 class="h3 tk-sec__title" id="sec-due">Дедлайн</h2>
          <div class="chips" role="group" aria-label="Швидкий вибір дедлайну">
            ${DUE_PRESETS.map(([v, l]) => html`<button class="chip" type="button" data-due="${v}" aria-pressed="${String(b.due.preset === v)}">${l}</button>`)}
          </div>
          <div class="form__row" data-due-fields>
            <div class="field"><label class="label" for="b-date">Дата</label><input class="input" id="b-date" name="due_date" type="date" min="${todayKey()}" value="${b.due.date}"></div>
            <div class="field"><label class="label" for="b-time">Час</label><input class="input" id="b-time" name="due_time" type="time" value="${b.due.time}" step="300"></div>
          </div>
          <p class="hint" data-due-hint></p>
        </section>
      </form>

      <aside class="tk-side">
        <div class="card tk-summary">
          <p class="card__title">Підсумок</p>
          <dl class="tk-summary__list" data-summary></dl>
          <button class="btn btn--primary btn--block btn--lg" type="submit" form="builder" data-submit><span data-submit-label>Призначити</span></button>
          <p class="text-xs muted text-center" data-submit-note></p>
        </div>
      </aside>
    </div>
    <div class="tk-actionbar" data-actionbar>
      <div class="tk-actionbar__info"><span class="fw-600" data-bar-main></span><span class="text-xs muted" data-bar-sub></span></div>
      <button class="btn btn--primary" type="submit" form="builder" data-submit><span data-submit-label>Призначити</span></button>
    </div>`);

  const form = view.querySelector('#builder');
  const $ = (s) => view.querySelector(s);

  // ---------------- kind ----------------
  const INSTR = {
    text: ['Що саме написати? Обсяг, граматика, дедлайн у словах.', 'Наприклад: Напишіть 120–150 слів про свої вихідні. Використайте Past Simple.'],
    file: ['Що сфотографувати чи записати. Учень зможе додати кілька фото або аудіо.', 'Наприклад: Виконайте вправи 1–4 на с. 34 і сфотографуйте сторінки.'],
    link: ['Що зробити за посиланням і що надіслати у відповідь.', 'Наприклад: Подивіться відео і випишіть 10 нових фраз.'],
    quiz: ['Короткий вступ перед питаннями.', 'Наприклад: Оберіть правильну форму дієслова. Одна спроба.'],
  };
  function applyKind() {
    $('[data-link-field]').hidden = b.kind !== 'link';
    $('[data-quiz-sec]').hidden = b.kind !== 'quiz';
    $('[data-instr-hint]').textContent = INSTR[b.kind][0];
    $('#b-instr').placeholder = INSTR[b.kind][1];
    if (b.kind === 'quiz' && !b.questions.length) { b.questions.push(newQuestion()); renderQuestions(); }
    updateSummary();
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'kind') { b.kind = e.target.value; applyKind(); }
  });

  // ---------------- content fields ----------------
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'title') { b.title = t.value; if (b.tried) fieldError(form, 'title', t.value.trim() ? null : 'Дайте завданню назву.'); updateSummary(); }
    if (t.name === 'instructions') b.instructions = t.value;
    if (t.name === 'link_url') { b.link_url = t.value; if (b.tried) fieldError(form, 'link_url', linkError()); }
  });
  const linkError = () => {
    if (b.kind !== 'link') return null;
    const v = b.link_url.trim();
    if (!v) return 'Додайте посилання.';
    if (!/^https?:\/\//i.test(v) || !safeUrl(v)) return 'Посилання має починатися з http:// або https://';
    return null;
  };
  // Friendly: auto-prefix https:// on blur
  $('#b-link').addEventListener('blur', (e) => {
    const v = e.target.value.trim();
    if (v && !/^[a-z]+:\/\//i.test(v) && /\./.test(v)) { e.target.value = `https://${v}`; b.link_url = e.target.value; if (b.tried) fieldError(form, 'link_url', linkError()); }
  });
  on(view, '[data-action="unlink-lesson"]', () => { b.lessonId = null; $('[data-lesson]')?.remove(); toast('Завдання не буде привʼязане до уроку', { type: 'info', timeout: 2500 }); });

  // ---------------- files ----------------
  const dz = $('[data-dropzone]');
  const fileInput = $('[data-files]');
  function addFiles(list) {
    const rejected = [];
    for (const file of list) {
      if (!okType(file)) { rejected.push(`«${file.name}»: такий тип файлу не підтримується`); continue; }
      if (file.size > MAX_MB * 1024 * 1024) { rejected.push(`«${file.name}» більший за ${MAX_MB} МБ`); continue; }
      if (b.files.length >= 20) { rejected.push('Не більше 20 файлів'); break; }
      b.files.push({ key: uid().slice(0, 8), file, name: file.name, type: file.type, size: file.size, preview: isImage(file) ? URL.createObjectURL(file) : null });
    }
    if (rejected.length) toast('Деякі файли не додано', { type: 'error', text: rejected.join('. '), timeout: 7000 });
    renderFiles(); updateSummary();
  }
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dropzone--over'); }));
  ['dragleave', 'dragend'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('dropzone--over')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dropzone--over'); if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });

  function renderFiles() {
    const box = $('[data-thumbs]');
    box.innerHTML = String(html`${b.files.map((f, i) => html`<li class="thumb${f.uploading ? ' thumb--uploading' : ''}" data-fkey="${f.key}" title="${`${f.name} · ${fmtSize(f.size)}`}">
      ${f.preview ? html`<img src="${f.preview}" alt="${f.name}">`
        : f.copy && isImage(f) ? html`<div class="thumb__file">${ic('image')}<span>${f.name}</span></div>`
        : html`<div class="thumb__file">${ic(fileIcon(f.type, f.name))}<span>${f.name}</span><span class="muted">${fmtSize(f.size)}</span></div>`}
      ${f.uploading ? html`<div class="thumb__progress"><div class="progress progress--sm tk-indeterminate" role="progressbar" aria-label="${`Завантаження ${f.name}`}"><div class="progress__bar"></div></div></div>` : ''}
      <button class="thumb__remove" type="button" data-action="file-del" aria-label="${`Прибрати файл ${i + 1}: ${f.name}`}" ${b.busy ? raw('disabled') : ''}>${ic('x')}</button>
    </li>`)}`);
  }
  on(view, '[data-action="file-del"]', (e, btn) => {
    const key = btn.closest('[data-fkey]').dataset.fkey;
    const f = b.files.find((x) => x.key === key);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    b.files = b.files.filter((x) => x.key !== key);
    renderFiles(); updateSummary();
  });

  // ---------------- quiz builder ----------------
  const qlist = $('[data-qlist]');
  function questionHtml(q, i, n) {
    const err = b.tried ? questionError(q) : '';
    return html`<li class="tk-qb${err ? ' tk-qb--error' : ''}" data-q="${i}" id="q-${q.key}">
      <div class="tk-qb__head">
        <span class="tk-qb__num" aria-hidden="true">${i + 1}</span>
        <div class="segmented tk-qb__type" role="radiogroup" aria-label="${`Тип питання ${i + 1}`}">
          <label><input type="radio" name="qt-${q.key}" value="single" data-qtype ${q.qtype === 'single' ? raw('checked') : ''}><span>Вибір відповіді</span></label>
          <label><input type="radio" name="qt-${q.key}" value="gap" data-qtype ${q.qtype === 'gap' ? raw('checked') : ''}><span>Вписати слово</span></label>
        </div>
        <div class="tk-qb__tools">
          <button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="q-up" aria-label="${`Перемістити питання ${i + 1} вище`}" ${i === 0 ? raw('disabled') : ''}>${ic('chevronUp')}</button>
          <button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="q-down" aria-label="${`Перемістити питання ${i + 1} нижче`}" ${i === n - 1 ? raw('disabled') : ''}>${ic('chevronDown')}</button>
          <button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="q-dup" aria-label="${`Дублювати питання ${i + 1}`}">${ic('copy')}</button>
          <button class="btn btn--ghost btn--icon btn--sm tk-danger-ico" type="button" data-action="q-del" aria-label="${`Видалити питання ${i + 1}`}">${ic('trash')}</button>
        </div>
      </div>
      <div class="field">
        <label class="label" for="qp-${q.key}">Питання ${i + 1}</label>
        <textarea class="textarea tk-qb__prompt" id="qp-${q.key}" rows="2" maxlength="1000" data-prompt placeholder="${q.qtype === 'gap' ? 'She ___ (go) to school every day.' : 'Yesterday I ___ to the cinema.'}">${q.prompt}</textarea>
        ${q.qtype === 'gap' ? html`<p class="hint">Пропуск позначте трьома підкресленнями: ___</p>` : ''}
      </div>
      ${q.qtype === 'single'
        ? html`<fieldset class="fieldset tk-opts"><legend>Варіанти <span class="label__opt">— позначте правильний</span></legend>
            ${q.options.map((o, oi) => html`<div class="tk-optrow${q.correct === oi ? ' tk-optrow--correct' : ''}">
              <label class="tk-optrow__radio" title="Правильна відповідь"><input type="radio" name="qc-${q.key}" value="${oi}" data-correct ${q.correct === oi ? raw('checked') : ''}><span class="sr-only">${`Варіант ${letter(oi)} правильний`}</span><span class="tk-optrow__key" aria-hidden="true">${letter(oi)}</span></label>
              <input class="input" data-opt="${oi}" value="${o}" maxlength="300" aria-label="${`Варіант ${letter(oi)}`}" placeholder="${`Варіант ${letter(oi)}`}" autocomplete="off">
              <button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="opt-del" data-o="${oi}" aria-label="${`Прибрати варіант ${letter(oi)}`}" ${q.options.length <= 2 ? raw('disabled') : ''}>${ic('x')}</button>
            </div>`)}
            ${q.options.length < MAX_OPTS ? html`<div><button class="btn btn--ghost btn--sm" type="button" data-action="opt-add">${ic('plus')}Додати варіант</button></div>` : ''}
          </fieldset>`
        : html`<div class="field"><label class="label" for="qa-${q.key}">Правильна відповідь</label>
            <input class="input" id="qa-${q.key}" data-accepted value="${q.accepted}" maxlength="300" placeholder="goes" autocomplete="off" autocapitalize="off" spellcheck="false">
            <p class="hint">Кілька прийнятних варіантів — через кому. Великі й малі літери не важать.</p></div>`}
      <p class="error-text" data-qerr ${err ? '' : raw('hidden')}>${ic('alert')}<span>${err}</span></p>
    </li>`;
  }
  function renderQuestions(focusKey = null, focusSel = '[data-prompt]') {
    qlist.innerHTML = String(html`${b.questions.map((q, i) => questionHtml(q, i, b.questions.length))}`);
    if (focusKey) qlist.querySelector(`#q-${focusKey} ${focusSel}`)?.focus();
    updateQuizMeta();
  }
  function updateQuizMeta() {
    const n = b.questions.length;
    const single = b.questions.filter((q) => q.qtype === 'single').length;
    $('[data-qcount]').textContent = n ? `${n} ${plural(n, 'питання', 'питання', 'питань')} · ${single} вибір, ${n - single} вписати` : 'Немає питань';
    const err = $('[data-quiz-err]');
    if (b.tried && b.kind === 'quiz' && !n) { err.hidden = false; err.innerHTML = `${icon('alert')}Додайте хоча б одне питання.`; } else err.hidden = true;
    updateSummary();
  }
  /** Re-validate one question card in place (after typing) */
  function refreshQError(li) {
    if (!b.tried) return;
    const q = b.questions[Number(li.dataset.q)];
    const msg = questionError(q);
    li.classList.toggle('tk-qb--error', !!msg);
    const p = li.querySelector('[data-qerr]');
    p.hidden = !msg; p.querySelector('span').textContent = msg;
    updateSummary();
  }
  const qOf = (el) => { const li = el.closest('[data-q]'); return [li, b.questions[Number(li.dataset.q)], Number(li.dataset.q)]; };

  qlist.addEventListener('input', (e) => {
    const t = e.target; if (!t.closest('[data-q]')) return;
    const [li, q] = qOf(t);
    if (t.matches('[data-prompt]')) q.prompt = t.value;
    else if (t.matches('[data-opt]')) q.options[Number(t.dataset.opt)] = t.value;
    else if (t.matches('[data-accepted]')) q.accepted = t.value;
    refreshQError(li);
  });
  qlist.addEventListener('change', (e) => {
    const t = e.target; if (!t.closest('[data-q]')) return;
    const [li, q] = qOf(t);
    if (t.matches('[data-qtype]')) {
      // keep data when switching: single correct option → gap answer and back
      if (t.value === 'gap' && q.qtype === 'single' && !q.accepted && q.correct != null) q.accepted = q.options[q.correct] || '';
      if (t.value === 'single' && q.qtype === 'gap' && q.options.every((o) => !o.trim()) && acceptedList(q).length) { q.options = [acceptedList(q)[0], '']; q.correct = 0; }
      q.qtype = t.value; renderQuestions();
    } else if (t.matches('[data-correct]')) {
      q.correct = Number(t.value);
      li.querySelectorAll('.tk-optrow').forEach((r, i) => r.classList.toggle('tk-optrow--correct', i === q.correct));
      refreshQError(li);
    }
  });
  on(view, '[data-action="q-add"]', (e, btn) => {
    const q = newQuestion(btn.dataset.qtype); b.questions.push(q); renderQuestions(q.key);
    qlist.querySelector(`#q-${q.key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  on(view, '[data-action="q-del"]', (e, btn) => {
    const [, , i] = qOf(btn);
    const removed = b.questions.splice(i, 1)[0];
    renderQuestions();
    toast('Питання видалено', { type: 'info', action: { label: 'Повернути', onClick: () => { b.questions.splice(i, 0, removed); renderQuestions(); } } });
  });
  on(view, '[data-action="q-dup"]', (e, btn) => {
    const [, q, i] = qOf(btn);
    const c = { ...q, key: uid().slice(0, 8), options: [...q.options] };
    b.questions.splice(i + 1, 0, c); renderQuestions(c.key);
  });
  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= b.questions.length) return;
    [b.questions[i], b.questions[j]] = [b.questions[j], b.questions[i]];
    const key = b.questions[j].key; renderQuestions(key, `[data-action="${d < 0 ? 'q-up' : 'q-down'}"]`);
    const again = qlist.querySelector(`#q-${key} [data-action="${d < 0 ? 'q-up' : 'q-down'}"]`);
    if (again?.disabled) qlist.querySelector(`#q-${key} [data-action="${d < 0 ? 'q-down' : 'q-up'}"]`)?.focus();
  };
  on(view, '[data-action="q-up"]', (e, btn) => move(qOf(btn)[2], -1));
  on(view, '[data-action="q-down"]', (e, btn) => move(qOf(btn)[2], 1));
  on(view, '[data-action="opt-add"]', (e, btn) => {
    const [, q] = qOf(btn); if (q.options.length >= MAX_OPTS) return;
    q.options.push(''); renderQuestions(q.key, `[data-opt="${q.options.length - 1}"]`);
  });
  on(view, '[data-action="opt-del"]', (e, btn) => {
    const [, q] = qOf(btn); const oi = Number(btn.dataset.o);
    if (q.options.length <= 2) return;
    q.options.splice(oi, 1);
    if (q.correct === oi) q.correct = null; else if (q.correct > oi) q.correct -= 1;
    renderQuestions(q.key, `[data-opt="${Math.max(0, oi - 1)}"]`);
  });
  // Enter in an option field → next option / new option
  qlist.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('[data-opt]')) return;
    e.preventDefault();
    const [li, q] = qOf(e.target); const oi = Number(e.target.dataset.opt);
    const next = li.querySelector(`[data-opt="${oi + 1}"]`);
    if (next) next.focus();
    else if (q.options.length < MAX_OPTS) { q.options.push(''); renderQuestions(q.key, `[data-opt="${oi + 1}"]`); }
  });

  // quick add
  const quickText = $('[data-quick-text]');
  const quickBtn = $('[data-action="quick-add"]');
  quickText.addEventListener('input', () => {
    const { questions, bad } = parseQuick(quickText.value);
    const hint = $('[data-quick-hint]');
    quickBtn.disabled = !questions.length;
    quickBtn.querySelector('span').textContent = questions.length ? `Додати ${questions.length} ${plural(questions.length, 'питання', 'питання', 'питань')}` : 'Додати питання';
    if (!quickText.value.trim()) { hint.textContent = 'Перший рядок стане вписуванням слова, другий — вибором відповіді.'; hint.classList.remove('c-danger'); return; }
    const single = questions.filter((q) => q.qtype === 'single').length;
    const parts = [];
    if (questions.length) parts.push(`Розпізнано: ${single} з вибором, ${questions.length - single} вписати.`);
    if (bad.length) parts.push(`${bad.length > 1 ? 'Рядки' : 'Рядок'} ${bad.join(', ')} не розпізнано — додайте « | відповідь».`);
    hint.textContent = parts.join(' ');
    hint.classList.toggle('c-danger', !!bad.length && !questions.length);
  });
  on(view, '[data-action="quick-add"]', () => {
    const { questions } = parseQuick(quickText.value);
    if (!questions.length) return;
    // replace a single untouched empty starter question
    if (b.questions.length === 1 && !b.questions[0].prompt.trim() && b.questions[0].options.every((o) => !o.trim()) && !b.questions[0].accepted) b.questions = [];
    b.questions.push(...questions);
    quickText.value = ''; quickText.dispatchEvent(new Event('input'));
    renderQuestions();
    toast(`Додано ${questions.length} ${plural(questions.length, 'питання', 'питання', 'питань')}`);
    qlist.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  // ---------------- students ----------------
  bindStudentPicker(view, b.selected, () => {
    const n = b.selected.size;
    const el = $('[data-who-count]'); if (el) el.textContent = students.length ? `Обрано ${n} з ${students.length}` : '';
    updateSummary();
  });

  // ---------------- deadline ----------------
  const dateIn = $('#b-date'); const timeIn = $('#b-time');
  function dueIso() {
    if (b.due.preset === 'none' || !b.due.date) return null;
    return fromZoned(b.due.date, b.due.time || DEFAULT_TIME).toISOString();
  }
  function dueError() {
    if (b.due.preset === 'none') return null;
    if (!b.due.date) return 'Оберіть дату або «Без дедлайну».';
    if (new Date(dueIso()) < new Date()) return 'Дедлайн уже минув — оберіть пізніший час.';
    return null;
  }
  function applyDue() {
    view.querySelectorAll('[data-due]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.due === b.due.preset)));
    $('[data-due-fields]').hidden = b.due.preset === 'none';
    dateIn.value = b.due.date; timeIn.value = b.due.time;
    const iso = dueIso();
    $('[data-due-hint]').textContent = iso ? `${fmtFullDate(iso)}, ${fmtTime(iso)} (час за Варшавою)` : 'Учні бачитимуть завдання без терміну.';
    if (b.tried) fieldError(form, 'due_date', dueError());
    updateSummary();
  }
  on(view, '[data-due]', (e, chip) => {
    b.due.preset = chip.dataset.due;
    if (b.due.preset !== 'none') { b.due.date = addDays(todayKey(), Number(b.due.preset)); b.due.time = b.due.time || DEFAULT_TIME; }
    applyDue();
  });
  const onDueInput = () => {
    b.due.date = dateIn.value; b.due.time = timeIn.value || DEFAULT_TIME;
    const match = DUE_PRESETS.find(([v]) => v !== 'none' && addDays(todayKey(), Number(v)) === b.due.date);
    b.due.preset = match ? match[0] : 'custom';
    applyDue();
  };
  dateIn.addEventListener('change', onDueInput); timeIn.addEventListener('change', onDueInput);

  // ---------------- summary / action bar ----------------
  function updateSummary() {
    const n = b.selected.size;
    const iso = dueIso();
    const k = kindOf(b.kind);
    const qn = b.questions.length;
    const rows = [
      ['Тип', html`${ic(k.icon)}${k.label}`],
      ['Назва', b.title.trim() ? b.title.trim() : html`<span class="muted">не вказано</span>`],
      ...(b.kind === 'quiz' ? [['Питання', qn ? `${qn}` : html`<span class="muted">немає</span>`]] : []),
      ...(b.files.length ? [['Файли', `${b.files.length}`]] : []),
      ['Учні', n ? `${n}` : html`<span class="muted">не обрано</span>`],
      ['Дедлайн', iso ? `${fmtDateShort(iso)}, ${fmtTime(iso)}` : 'без дедлайну'],
    ];
    $('[data-summary]').innerHTML = String(html`${rows.map(([dt, dd]) => html`<div><dt>${dt}</dt><dd>${dd}</dd></div>`)}`);
    const label = n ? `Призначити ${n} ${plural(n, 'учню', 'учням', 'учням')}` : 'Зберегти в бібліотеку';
    view.querySelectorAll('[data-submit-label]').forEach((s) => { s.textContent = n ? 'Призначити' : 'Зберегти'; });
    view.querySelector('.tk-summary [data-submit-label]').textContent = label;
    $('[data-submit-note]').textContent = n ? 'Учні одразу побачать завдання у своєму кабінеті.' : 'Учнів можна додати пізніше.';
    $('[data-bar-main]').textContent = n ? `${n} ${plural(n, 'учень', 'учні', 'учнів')}` : 'Учнів не обрано';
    $('[data-bar-sub]').textContent = [b.kind === 'quiz' ? `${qn} ${plural(qn, 'питання', 'питання', 'питань')}` : k.label, iso ? `до ${fmtDateShort(iso)}, ${fmtTime(iso)}` : 'без дедлайну'].join(' · ');
  }

  // ---------------- submit ----------------
  function validate() {
    clearErrors(form);
    const bad = [];
    if (!b.title.trim()) { fieldError(form, 'title', 'Дайте завданню назву.'); bad.push($('#b-title')); }
    const le = linkError(); if (le) { fieldError(form, 'link_url', le); bad.push($('#b-link')); }
    if (b.kind === 'quiz') {
      renderQuestions();
      if (!b.questions.length) bad.push($('[data-quiz-sec]'));
      const firstBad = qlist.querySelector('.tk-qb--error');
      if (firstBad) bad.push(firstBad);
    }
    const de = dueError(); if (de) { fieldError(form, 'due_date', de); bad.push(dateIn); }
    return bad;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (b.busy) return;
    b.tried = true;
    const bad = validate();
    if (bad.length) {
      const el = bad[0];
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const focusable = el.matches('input,textarea') ? el : el.querySelector('.field--error input, .field--error textarea, [data-prompt]');
      setTimeout(() => focusable?.focus({ preventScroll: true }), 300);
      toast('Перевірте позначені поля', { type: 'error', timeout: 3500 });
      return;
    }
    const btns = [...view.querySelectorAll('[data-submit]')];
    b.busy = true; btns.forEach((x) => setLoading(x, true));
    const id = uid();
    let created = false;
    try {
      const a = {
        id, kind: b.kind, title: b.title.trim(), instructions: b.instructions.trim(),
        link_url: b.kind === 'link' ? safeUrl(b.link_url.trim()) : '',
        attachments: [], lesson_id: b.lessonId,
      };
      const questions = b.kind === 'quiz' ? b.questions.map(toApi) : [];
      await api.createAssignment(a, questions, []);
      created = true;

      // attachments: upload new files / copy files of the source assignment into this assignment's folder
      if (b.files.length) {
        const attachments = [];
        let i = 0;
        for (const f of b.files) {
          i += 1;
          $('[data-bar-sub]').textContent = `Завантажуємо файли: ${i} з ${b.files.length}`;
          f.uploading = true; renderFiles();
          if (f.file) {
            const file = await api.compressImage(f.file);
            attachments.push(await api.uploadFile(file, 'a', id));
          } else if (f.path) {
            const to = `a/${state.space.id}/${id}/${fileSafeName(f.name)}`;
            const { error } = await sb.storage.from(BUCKET).copy(f.path, to);
            if (error) { console.warn('copy failed, keeping reference', error); attachments.push({ path: f.path, name: f.name, type: f.type, size: f.size }); }
            else attachments.push({ path: to, name: f.name, type: f.type, size: f.size });
          }
          f.uploading = false;
        }
        await api.updateAssignment(id, { attachments });
      }

      const due = dueIso();
      const targets = [...b.selected].map((sid) => ({ student_id: sid, due_at: due }));
      if (targets.length) await api.addTargets(id, targets);

      b.files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      const n = targets.length;
      if (n) toast(`Завдання призначено ${n} ${plural(n, 'учню', 'учням', 'учням')}`, { text: due ? `Дедлайн: ${fmtDate(due)}, ${fmtTime(due)}` : '' });
      else toast('Завдання збережено', { text: 'Призначте його учням, коли будете готові.' });
      navigate(`/t/assignments/${id}`);
    } catch (err) {
      if (created) { try { await api.deleteAssignment(id); } catch (e2) { console.warn(e2); } }
      b.files.forEach((f) => { f.uploading = false; });
      if (alive()) { renderFiles(); updateSummary(); }
      toastError(err);
    } finally {
      b.busy = false;
      btns.forEach((x) => x.isConnected && setLoading(x, false));
    }
  });

  // ---------------- init ----------------
  renderFiles();
  renderQuestions();
  applyKind();
  applyDue();
  if (!src) setTimeout(() => { if (alive() && window.matchMedia('(min-width: 821px)').matches) $('#b-title')?.focus({ preventScroll: true }); }, 50);
}
