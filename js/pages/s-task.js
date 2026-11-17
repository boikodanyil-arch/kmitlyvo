// Student: one task (#/s/tasks/:id) — instructions, attachments, submission by kind, quiz player, results.
import * as api from '../api.js';
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { setTitle, setCount } from '../shell.js';
import { esc, html, raw, fmtDate, fmtTime, safeUrl, isOverdue, plural, debounce } from '../utils.js';
import { icon, avatar, targetStatus, emptyState, errorState, toast, toastError, openModal, confirmDialog, setLoading, on } from '../ui.js';
import { kindOf, dueText, scale, fmtScore, teacherName } from './s-tasks.js';

// ---------------- drafts (localStorage, best effort) ----------------
const draftKey = (id) => `kmitlyvo.draft.${id}`;
function loadDraft(id) { try { return JSON.parse(localStorage.getItem(draftKey(id)) || '{}') || {}; } catch { return {}; } }
function saveDraft(id, patch) { try { localStorage.setItem(draftKey(id), JSON.stringify({ ...loadDraft(id), ...patch, at: Date.now() })); return true; } catch { return false; } }
function clearDraft(id) { try { localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } }

const wordCount = (s) => (String(s || '').trim().match(/\S+/g) || []).length;
const isImage = (f) => /^image\//.test(f?.type || '') || /\.(jpe?g|png|webp|gif|heic)$/i.test(f?.name || '');
const isAudio = (f) => /^audio\//.test(f?.type || '') || /\.(mp3|m4a|wav|ogg|aac|webm)$/i.test(f?.name || '');
const fileIcon = (f) => (isAudio(f) ? 'headphones' : isImage(f) ? 'image' : 'file');
const sizeLabel = (b) => (!b ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);
const BLANK_RE = /_{2,}/;
const KEYS = 'ABCDEFGH';

async function refreshTaskCount() {
  try {
    const { count } = await sb.from('assignment_targets').select('id', { count: 'exact', head: true }).eq('student_id', state.student.id).in('status', ['assigned', 'returned']);
    if (typeof count === 'number') setCount('tasks', count);
  } catch { /* ignore */ }
}

// ---------------- shared fragments ----------------
/** Files (attachments or submitted): images as lightbox thumbs, audio as players, others as links. */
function filesBlock(files, urls, { label = 'Файли' } = {}) {
  if (!files?.length) return '';
  const imgs = files.filter(isImage);
  const audio = files.filter((f) => !isImage(f) && isAudio(f));
  const docs = files.filter((f) => !isImage(f) && !isAudio(f));
  return html`<div class="stack stack--sm s-files" aria-label="${label}">
    ${imgs.length ? html`<ul class="thumbs s-thumbs">${imgs.map((f, i) => html`<li class="thumb">
      ${urls[f.path] ? html`<button class="s-thumb-btn" type="button" data-lightbox data-src="${urls[f.path]}" data-name="${f.name || `Фото ${i + 1}`}" aria-label="Відкрити ${f.name || `фото ${i + 1}`}"><img src="${urls[f.path]}" alt="${f.name || `Фото ${i + 1}`}" loading="lazy"></button>`
      : html`<div class="thumb__file">${raw(icon('image'))}Не вдалося відкрити</div>`}</li>`)}</ul>` : ''}
    ${audio.map((f) => html`<div class="s-audio"><p class="text-sm fw-600 s-audio__name">${raw(icon('headphones', 'icon--sm'))}${f.name || 'Аудіо'}</p>
      ${urls[f.path] ? html`<audio controls preload="none" src="${urls[f.path]}"></audio>` : html`<p class="text-sm muted">Не вдалося відкрити аудіо.</p>`}</div>`)}
    ${docs.length ? html`<ul class="list list--card">${docs.map((f) => html`<li>${urls[f.path]
      ? html`<a class="list-row" href="${urls[f.path]}" target="_blank" rel="noopener noreferrer"><span class="list-row__lead">${raw(icon(fileIcon(f)))}</span><span class="list-row__body"><span class="list-row__title">${f.name || 'Файл'}</span><span class="list-row__meta">${sizeLabel(f.size)}${f.size ? ' · ' : ''}Відкрити в новій вкладці</span></span><span class="list-row__trail">${raw(icon('external'))}</span></a>`
      : html`<div class="list-row"><span class="list-row__lead">${raw(icon('file'))}</span><span class="list-row__body"><span class="list-row__title">${f.name || 'Файл'}</span><span class="list-row__meta">Не вдалося відкрити</span></span></div>`}</li>`)}</ul>` : ''}
  </div>`;
}

/** Prompt with ___ replaced by a rendered blank (fill = text shown inside). */
function promptHtml(prompt, fill = '', cls = '') {
  const parts = String(prompt || '').split(BLANK_RE);
  if (parts.length === 1) return html`${prompt}`;
  return raw(parts.map((p, i) => esc(p) + (i < parts.length - 1 ? (i === 0 ? `<span class="quiz__blank ${cls}">${fill ? esc(fill) : '&nbsp;'}</span>` : '<span class="quiz__blank">&nbsp;</span>') : '')).join(''));
}

function answerText(q, v) {
  if (v == null || v === '') return '';
  if (q.qtype === 'single') { const n = Number(v); return Number.isInteger(n) && q.options?.[n] != null ? `${KEYS[n]}. ${q.options[n]}` : String(v); }
  if (Array.isArray(v)) return v.filter(Boolean).join(' / ');
  return String(v);
}
function correctText(q, a) {
  if (a == null) return '';
  if (q.qtype === 'single' && !Array.isArray(a) && Number.isInteger(Number(a)) && q.options?.[Number(a)] != null) return `${KEYS[Number(a)]}. ${q.options[Number(a)]}`;
  if (Array.isArray(a)) return a.filter(Boolean).join(' / ');
  return String(a);
}

function cheer(ratio) {
  if (ratio >= 0.999) return { title: 'Ідеально! Усе правильно', text: 'Ви впоралися на всі 100%. Так тримати!', icon: 'trophy' };
  if (ratio >= 0.75) return { title: 'Чудова робота!', text: 'Майже все правильно — подивіться на помилки нижче.', icon: 'star' };
  if (ratio >= 0.5) return { title: 'Гарний результат', text: 'Половина й більше — непогано. Розберіть помилки, і наступного разу буде ще краще.', icon: 'sparkles' };
  return { title: 'Тест здано!', text: 'Помилки — це нормально, так ми й вчимося. Подивіться правильні відповіді нижче.', icon: 'sparkles' };
}

/** Quiz result review (score + per-question). */
function quizResult(t, sub, questions, { fresh = false } = {}) {
  const res = sub?.quiz_result || {};
  const total = res.total ?? questions.length;
  const correct = res.correct ?? 0;
  const ratio = total ? correct / total : 0;
  const c = cheer(ratio);
  const per = res.per || {};
  const answers = sub?.quiz_answers || {};
  return html`<section class="card s-qres${fresh ? ' s-qres--fresh' : ''}" aria-labelledby="qres-t">
    <div class="s-qres__hero">
      <span class="s-qres__badge">${raw(icon(c.icon))}</span>
      <h2 class="h2" id="qres-t">${c.title}</h2>
      <div class="score">
        ${t.score != null ? html`<span class="score__value">${fmtScore(t.score)}<small> / ${scale()}</small></span>` : ''}
        <span class="fw-600">${correct} з ${total} ${plural(total, 'правильна', 'правильних', 'правильних')}</span>
      </div>
      <div class="progress progress--hl progress--lg s-qres__bar" role="progressbar" aria-valuenow="${Math.round(ratio * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Правильних відповідей" style="--value:${Math.round(ratio * 100)}%"><div class="progress__bar"></div></div>
      <p class="muted text-sm">${c.text}</p>
    </div>
    <ol class="s-qreview">
      ${questions.map((q, i) => {
        const p = per[q.id] || {};
        const mine = answerText(q, answers[q.id]);
        const ok = !!p.ok;
        return html`<li class="s-qreview__item ${ok ? 's-qreview__item--ok' : 's-qreview__item--bad'}">
          <span class="s-qreview__mark">${raw(icon(ok ? 'checkCircle' : 'xCircle'))}<span class="sr-only">${ok ? 'Правильно' : 'Неправильно'}</span></span>
          <div class="s-qreview__body">
            <p class="s-qreview__q"><span class="muted">${i + 1}.</span> ${promptHtml(q.prompt, q.qtype === 'single' && answers[q.id] != null ? q.options?.[Number(answers[q.id])] : answers[q.id], ok ? 's-blank--ok' : 's-blank--bad')}</p>
            <p class="text-sm">Ваша відповідь: <b class="${ok ? 'c-success' : 'c-danger'}">${mine || 'без відповіді'}</b></p>
            ${!ok && p.answer != null ? html`<p class="text-sm">Правильно: <b class="c-success">${correctText(q, p.answer)}</b></p>` : ''}
          </div>
        </li>`;
      })}
    </ol>
  </section>`;
}

/** Read-only view of a submission (non-quiz). */
function workView(t, sub, urls) {
  const kind = t.assignment?.kind;
  const when = html`<p class="text-sm muted s-work__when">${raw(icon('send', 'icon--sm'))}Здано ${fmtDate(sub.submitted_at)} о ${fmtTime(sub.submitted_at)}${sub.attempt_no > 1 ? ` · спроба ${sub.attempt_no}` : ''}</p>`;
  const text = String(sub.text_answer || '').trim();
  return html`<div class="stack stack--sm s-work">
    ${when}
    ${kind === 'text' ? html`<div class="s-work__text pre-wrap">${text || '—'}</div><p class="text-xs muted">${wordCount(text)} ${plural(wordCount(text), 'слово', 'слова', 'слів')}</p>` : ''}
    ${kind === 'file' ? html`${filesBlock(sub.files || [], urls, { label: 'Здані файли' })}${text ? html`<div class="s-work__comment"><p class="text-xs muted">Коментар</p><p class="pre-wrap">${text}</p></div>` : ''}` : ''}
    ${kind === 'link' ? (text ? html`<div class="s-work__text pre-wrap">${text}</div>` : html`<p class="row text-sm">${raw(icon('checkCircle', 'icon--sm'))}Позначено як виконане</p>`) : ''}
  </div>`;
}

// ---------------- page ----------------
export default async function render({ view, params, alive }) {
  setTitle('Завдання');
  const id = params.id;
  const S = { t: null, subs: [], questions: [], urls: {}, teacher: '' };

  view.innerHTML = String(raw(`<div class="s-task">
    <div class="page-header"><div class="page-header__titles"><span class="skeleton skeleton--text" style="width:90px"></span><span class="skeleton skeleton--title" style="width:70%"></span><span class="skeleton skeleton--text" style="width:50%"></span></div></div>
    <div class="stack stack--lg"><span class="skeleton skeleton--block" style="height:140px"></span><span class="skeleton skeleton--block" style="height:220px"></span></div>
    <span class="sr-only" role="status">Завантаження…</span></div>`));

  async function load() {
    const t = await api.getTarget(id);
    if (!t) return null;
    const [subs, questions, teacher] = await Promise.all([
      api.listSubmissions(id),
      t.assignment?.kind === 'quiz' ? api.getQuiz(t.assignment.id) : Promise.resolve([]),
      teacherName(),
    ]);
    const paths = [...(t.assignment?.attachments || []), ...subs.flatMap((s) => s.files || [])].map((f) => f.path).filter(Boolean);
    const urls = {};
    await Promise.all([...new Set(paths)].map(async (p) => { urls[p] = await api.signedUrl(p); }));
    Object.assign(S, { t, subs, questions, urls, teacher });
    return t;
  }

  try {
    const t = await load();
    if (!alive()) return;
    if (!t) {
      setTitle('Завдання не знайдено');
      view.innerHTML = String(emptyState({ icon: 'search', title: 'Завдання не знайдено', text: 'Можливо, вчитель його видалив. Перевірте список завдань.', action: html`<a class="btn btn--primary" href="#/s/tasks">До завдань</a>` }));
      return;
    }
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(errorState(err.message));
    return;
  }

  // Lightbox for images (attachments + submitted photos)
  on(view, '[data-lightbox]', (e, el) => {
    const src = el.dataset.src; const name = el.dataset.name || 'Фото';
    openModal({
      title: name, wide: true,
      body: `<div class="s-lightbox"><img src="${esc(src)}" alt="${esc(name)}"></div>`,
      foot: `<a class="btn btn--secondary" href="${esc(src)}" target="_blank" rel="noopener noreferrer">${icon('external')}Відкрити оригінал</a><button class="btn btn--primary" type="button" data-close>Закрити</button>`,
    });
  });

  draw();

  function draw({ fresh = false } = {}) {
    const { t, subs, questions, urls, teacher } = S;
    const a = t.assignment || {};
    const k = kindOf(t);
    const latest = subs[0] || null;
    const todo = ['assigned', 'returned'].includes(t.status);
    const isQuiz = a.kind === 'quiz';
    const link = safeUrl(a.link_url);
    setTitle(a.title || 'Завдання');

    view.innerHTML = String(html`<div class="s-task">
      <div class="page-header">
        <div class="page-header__titles">
          <a class="back-link" href="#/s/tasks">${raw(icon('chevronLeft'))}Завдання</a>
          <h1 class="h1">${a.title || 'Завдання'}</h1>
          <div class="s-task__meta">
            ${targetStatus(t)}
            <span class="badge">${raw(icon(k.icon))}${k.label}</span>
            <span class="s-task__due${isOverdue(t) ? ' c-danger fw-600' : ''}">${raw(icon('clock', 'icon--sm'))}${dueText(t)}</span>
          </div>
        </div>
      </div>

      <div class="stack stack--lg">
        ${t.status === 'returned' ? html`<section class="s-banner s-banner--returned" aria-labelledby="ret-t">
          <div class="s-banner__head"><span class="s-banner__icon">${raw(icon('refresh'))}</span><div><h2 class="h3" id="ret-t">Повернуто на доопрацювання</h2><p class="text-sm muted">Виправте роботу і здайте ще раз — це нова спроба.</p></div></div>
          ${t.feedback ? html`<div class="s-fb">${teacher ? html`<div class="row s-fb__who">${avatar(teacher, 'xs')}<span class="text-sm fw-600">${teacher}</span></div>` : ''}<p class="pre-wrap s-fb__text">${t.feedback}</p></div>` : ''}
        </section>` : ''}

        ${t.status === 'graded' && !isQuiz ? html`<section class="card s-grade" aria-labelledby="gr-t">
          <div class="s-grade__score"><p class="s-label" id="gr-t">${raw(icon('star', 'icon--sm'))}Оцінка</p>
            <span class="score__value">${fmtScore(t.score)}<small> / ${scale()}</small></span></div>
          ${t.feedback ? html`<div class="s-fb s-fb--plain">${teacher ? html`<div class="row s-fb__who">${avatar(teacher, 'xs')}<span class="text-sm fw-600">${teacher}</span></div>` : ''}<p class="pre-wrap s-fb__text">${t.feedback}</p></div>` : html`<p class="muted text-sm">Вчитель оцінив роботу без коментаря.</p>`}
        </section>` : ''}

        ${t.status === 'submitted' ? html`<div class="alert s-wait">${raw(icon('clock'))}<div><p class="alert__title">Очікує перевірки</p>Роботу здано${latest ? ` ${fmtDate(latest.submitted_at)} о ${fmtTime(latest.submitted_at)}` : ''}. Вчитель перевірить її найближчим часом.</div></div>` : ''}

        <section class="card s-brief" aria-labelledby="brief-t">
          <p class="s-label" id="brief-t">${raw(icon('clipboard', 'icon--sm'))}Завдання від вчителя</p>
          ${a.instructions ? html`<p class="pre-wrap s-brief__text">${a.instructions}</p>` : html`<p class="muted">Вчитель не додав опису — орієнтуйтеся на назву та матеріали.</p>`}
          ${filesBlock(a.attachments || [], urls, { label: 'Матеріали від вчителя' })}
          ${a.kind === 'link' && link ? html`<a class="btn btn--secondary btn--block s-brief__link" href="${link}" target="_blank" rel="noopener noreferrer">${raw(icon('external'))}Відкрити матеріал</a>` : ''}
        </section>

        <section class="s-workarea" aria-labelledby="work-t" id="work">
          ${isQuiz && !todo ? html`${latest?.quiz_result ? quizResult(t, latest, questions, { fresh }) : html`<div class="card"><p class="muted">Результат тесту з’явиться тут.</p></div>`}
              ${t.status === 'graded' && t.feedback && !/^\s*автоперевірка/i.test(t.feedback) ? html`<div class="card s-fb s-fb--card">${teacher ? html`<div class="row s-fb__who">${avatar(teacher, 'xs')}<span class="text-sm fw-600">${teacher}</span></div>` : ''}<p class="pre-wrap s-fb__text">${t.feedback}</p></div>` : ''}
              <h2 class="sr-only" id="work-t">Результат тесту</h2>`
          : !todo ? html`<h2 class="h2" id="work-t">Ваша робота</h2>${latest ? workView(t, latest, urls) : html`<p class="muted">Текст роботи тут не відображається — можливо, її здали поза платформою.</p>`}`
          : html`<h2 class="h2" id="work-t">${isQuiz ? 'Тест' : t.status === 'returned' ? 'Нова спроба' : 'Ваша відповідь'}</h2><div data-editor></div>`}
        </section>

        ${todo && latest && !isQuiz ? html`<details class="s-prev">
          <summary>${raw(icon('chevronDown', 'icon--sm'))}Попередня спроба</summary>
          ${workView(t, latest, urls)}
        </details>` : ''}
      </div>
    </div>`);

    if (todo) {
      const host = view.querySelector('[data-editor]');
      if (isQuiz) mountQuiz(host);
      else if (a.kind === 'file') mountFile(host);
      else if (a.kind === 'link') mountLink(host);
      else mountText(host);
    }
    if (fresh) view.querySelector('.s-qres')?.scrollIntoView({ block: 'start' });
  }

  async function submit(btn, payload) {
    setLoading(btn, true);
    let res;
    try {
      res = await api.submitAssignment(id, payload);
    } catch (err) {
      setLoading(btn, false);
      toastError(err);
      return false;
    }
    clearDraft(id);
    if (!alive()) return true;
    try { await load(); } catch { /* keep old */ }
    if (!alive()) return true;
    const quizMode = !!payload.quiz;
    if (quizMode) toast('Тест здано', { text: res?.result ? `Правильних відповідей: ${res.result.correct} з ${res.result.total}` : '' });
    else toast('Роботу здано', { text: 'Вчитель отримає її на перевірку.' });
    draw({ fresh: quizMode });
    window.scrollTo({ top: 0 });
    refreshTaskCount();
    return true;
  }

  // ---------------- text ----------------
  function mountText(host) {
    const d = loadDraft(id);
    const prev = S.t.status === 'returned' ? (S.subs[0]?.text_answer || '') : '';
    const init = d.text ?? prev;
    host.innerHTML = String(html`<form class="stack" data-form novalidate>
      <div class="field">
        <label class="label" for="answer">Текст відповіді</label>
        <textarea class="textarea s-answer" id="answer" name="text" rows="12" placeholder="Пишіть тут. Чернетка зберігається автоматично, тож можна повернутися пізніше." aria-describedby="answer-foot">${init}</textarea>
        <div class="s-answer__foot" id="answer-foot"><span class="num" data-words aria-live="polite"></span><span class="muted" data-saved></span></div>
      </div>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${raw(icon('send'))}<span>Здати роботу</span></button>
    </form>`);
    const form = host.querySelector('form'); const ta = form.querySelector('textarea');
    const words = form.querySelector('[data-words]'); const saved = form.querySelector('[data-saved]');
    const count = () => { const n = wordCount(ta.value); words.textContent = `${n} ${plural(n, 'слово', 'слова', 'слів')}`; };
    count();
    if (d.text) saved.textContent = 'Чернетку відновлено';
    const persist = debounce(() => { if (saveDraft(id, { text: ta.value })) saved.textContent = `Чернетку збережено о ${fmtTime(new Date())}`; }, 600);
    ta.addEventListener('input', () => { count(); saved.textContent = 'Зберігаємо…'; persist(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      const field = ta.closest('.field');
      field.classList.remove('field--error'); field.querySelector('.error-text')?.remove(); ta.removeAttribute('aria-invalid');
      if (!text) {
        field.classList.add('field--error'); ta.setAttribute('aria-invalid', 'true');
        field.insertAdjacentHTML('beforeend', `<p class="error-text" id="answer-err">${icon('alert')}Напишіть відповідь перед здачею</p>`);
        ta.focus(); return;
      }
      const n = wordCount(text);
      const ok = await confirmDialog({ title: 'Здати роботу?', text: `У відповіді ${n} ${plural(n, 'слово', 'слова', 'слів')}. Після здачі змінити її не вийде, доки вчитель не поверне роботу.`, confirmLabel: 'Здати роботу' });
      if (ok) await submit(form.querySelector('[type="submit"]'), { text });
    });
  }

  // ---------------- link ----------------
  function mountLink(host) {
    const d = loadDraft(id);
    const link = safeUrl(S.t.assignment?.link_url);
    host.innerHTML = String(html`<form class="stack" data-form novalidate>
      ${link ? html`<p class="text-sm muted">Відкрийте матеріал вище, опрацюйте його, а потім позначте завдання виконаним.</p>` : ''}
      <div class="field">
        <label class="label" for="notes">Що ви зробили / нотатки <span class="label__opt">(необов’язково)</span></label>
        <textarea class="textarea" id="notes" name="text" rows="5" placeholder="Наприклад: переглянула відео, виписала 10 нових слів">${d.text || ''}</textarea>
      </div>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${raw(icon('checkCircle'))}<span>Позначити виконаним</span></button>
    </form>`);
    const form = host.querySelector('form'); const ta = form.querySelector('textarea');
    ta.addEventListener('input', debounce(() => saveDraft(id, { text: ta.value }), 500));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      const ok = await confirmDialog({ title: 'Позначити виконаним?', text: text ? 'Вчитель побачить вашу позначку й нотатки.' : 'Вчитель побачить, що матеріал опрацьовано.', confirmLabel: 'Позначити виконаним' });
      if (ok) await submit(form.querySelector('[type="submit"]'), { text });
    });
  }

  // ---------------- file ----------------
  function mountFile(host) {
    const d = loadDraft(id);
    /** items: { key, name, type, size, preview, status: 'uploading'|'done'|'error', progress, meta } */
    const items = (d.files || []).map((m) => ({ key: m.path, name: m.name, type: m.type, size: m.size, preview: S.urls[m.path] || '', status: 'done', progress: 100, meta: m }));
    host.innerHTML = String(html`<form class="stack" data-form novalidate>
      <div class="field s-drop-field">
        <label class="btn btn--soft btn--lg btn--block s-camera">${raw(icon('camera'))}Сфотографувати роботу
          <input class="sr-only" type="file" accept="image/*" capture="environment" data-file-input aria-label="Зробити фото камерою">
        </label>
        <label class="dropzone s-dropzone" data-dz>
          <input type="file" multiple accept="image/*,.pdf,.doc,.docx,audio/*" data-file-input aria-describedby="dz-hint">
          <span class="dropzone__icon">${raw(icon('upload'))}</span>
          <span class="dropzone__title"><span class="s-dz-touch">Обрати фото з галереї або файл</span><span class="s-dz-mouse">Перетягніть файли сюди або натисніть, щоб обрати</span></span>
          <span class="dropzone__hint" id="dz-hint">Фото, PDF, Word або аудіо · до 10 МБ кожен</span>
        </label>
        <ul class="thumbs s-up-thumbs" data-thumbs aria-label="Додані файли"></ul>
        <p class="text-sm muted" data-upstate aria-live="polite"></p>
      </div>
      <div class="field">
        <label class="label" for="comment">Коментар для вчителя <span class="label__opt">(необов’язково)</span></label>
        <textarea class="textarea" id="comment" name="text" rows="3" placeholder="Наприклад: вправу 4 зробила на окремому аркуші">${d.comment || ''}</textarea>
      </div>
      <button class="btn btn--primary btn--lg btn--block" type="submit">${raw(icon('send'))}<span>Здати роботу</span></button>
    </form>`);
    const form = host.querySelector('form');
    try { if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) form.classList.add('s-touch'); } catch { /* ignore */ }
    const dz = form.querySelector('[data-dz]');
    const thumbs = form.querySelector('[data-thumbs]');
    const upstate = form.querySelector('[data-upstate]');
    const comment = form.querySelector('#comment');

    const persist = () => saveDraft(id, { files: items.filter((x) => x.status === 'done').map((x) => x.meta), comment: comment.value });
    comment.addEventListener('input', debounce(persist, 500));

    function paint() {
      thumbs.innerHTML = String(html`${items.map((x, i) => html`<li class="thumb${x.status === 'uploading' ? ' thumb--uploading' : ''}${x.status === 'error' ? ' s-thumb--error' : ''}">
        ${x.preview && isImage(x) ? html`<img src="${x.preview}" alt="${x.name}">` : html`<div class="thumb__file">${raw(icon(fileIcon(x)))}<span>${x.name}</span></div>`}
        ${x.status === 'uploading' ? html`<div class="thumb__progress"><div class="progress progress--sm" role="progressbar" aria-label="Завантаження ${x.name}" aria-valuenow="${x.progress}" aria-valuemin="0" aria-valuemax="100" style="--value:${x.progress}%"><div class="progress__bar"></div></div></div>` : ''}
        ${x.status === 'error' ? html`<div class="s-thumb__err">${raw(icon('alert', 'icon--sm'))}Помилка</div>` : ''}
        ${x.status !== 'uploading' ? html`<button class="thumb__remove" type="button" data-remove="${i}" aria-label="Видалити ${x.name}">${raw(icon('x'))}</button>` : ''}
      </li>`)}`);
      const up = items.filter((x) => x.status === 'uploading').length;
      const done = items.filter((x) => x.status === 'done').length;
      upstate.textContent = up ? `Завантажуємо ${up} ${plural(up, 'файл', 'файли', 'файлів')}…` : done ? `Готово до здачі: ${done} ${plural(done, 'файл', 'файли', 'файлів')}` : '';
      dz.querySelector('.dropzone__icon').innerHTML = icon(done ? 'plus' : 'upload');
    }

    async function addFiles(list) {
      dz.classList.remove('dropzone--error'); form.querySelector('.s-drop-field .error-text')?.remove();
      for (const file of Array.from(list)) {
        const x = { key: Math.random().toString(36).slice(2), name: file.name, type: file.type, size: file.size, preview: isImage(file) ? URL.createObjectURL(file) : '', status: 'uploading', progress: 8 };
        items.push(x);
        paint();
        const tick = setInterval(() => { if (x.progress < 88) { x.progress += Math.max(2, (90 - x.progress) / 6); const bar = thumbs.children[items.indexOf(x)]?.querySelector('.progress'); bar?.style.setProperty('--value', `${x.progress}%`); bar?.setAttribute('aria-valuenow', Math.round(x.progress)); } }, 180);
        (async () => {
          try {
            const small = await api.compressImage(file);
            x.meta = await api.uploadFile(small, 's', state.student.id, state.space.id);
            x.status = 'done'; x.progress = 100; x.size = x.meta.size;
            persist();
          } catch (err) {
            x.status = 'error';
            toastError(err);
          } finally {
            clearInterval(tick);
            if (form.isConnected) paint();
          }
        })();
      }
    }

    form.querySelectorAll('[data-file-input]').forEach((inp) => inp.addEventListener('change', () => { if (inp.files?.length) addFiles(inp.files); inp.value = ''; }));
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.add('dropzone--over')));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('dropzone--over')));
    thumbs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      const [x] = items.splice(Number(b.dataset.remove), 1);
      if (x?.preview?.startsWith('blob:')) URL.revokeObjectURL(x.preview);
      persist(); paint();
    });
    paint();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (items.some((x) => x.status === 'uploading')) { toast('Зачекайте, файли ще завантажуються', { type: 'info' }); return; }
      const files = items.filter((x) => x.status === 'done').map((x) => x.meta);
      if (!files.length) {
        dz.classList.add('dropzone--error');
        if (!form.querySelector('.s-drop-field .error-text')) upstate.insertAdjacentHTML('beforebegin', `<p class="error-text">${icon('alert')}Додайте хоча б одне фото або файл</p>`);
        dz.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const text = comment.value.trim();
      const ok = await confirmDialog({ title: 'Здати роботу?', text: `${files.length} ${plural(files.length, 'файл', 'файли', 'файлів')}${text ? ' і коментар' : ''}. Після здачі змінити роботу не вийде, доки вчитель не поверне її.`, confirmLabel: 'Здати роботу' });
      if (ok) await submit(form.querySelector('[type="submit"]'), { text, files });
    });
  }

  // ---------------- quiz ----------------
  function mountQuiz(host) {
    const qs = S.questions;
    if (!qs.length) {
      host.innerHTML = String(emptyState({ icon: 'help', title: 'У тесті поки немає питань', text: 'Напишіть вчителю — можливо, тест ще готується.' }));
      return;
    }
    const d = loadDraft(id);
    const Q = { i: Math.min(Number(d.qi) || 0, qs.length - 1), answers: { ...(d.answers || {}) }, review: false };
    const answered = (q) => { const v = Q.answers[q.id]; return v != null && String(v).trim() !== ''; };
    const nAnswered = () => qs.filter(answered).length;
    const persist = () => saveDraft(id, { answers: Q.answers, qi: Q.i });

    function steps() {
      return html`<div class="steps s-quiz__steps" aria-hidden="true">${qs.map((q, i) => html`<span class="steps__item${i === Q.i && !Q.review ? ' steps__item--current' : answered(q) ? ' steps__item--done' : ''}"></span>`)}</div>`;
    }

    function questionView() {
      const q = qs[Q.i];
      const last = Q.i === qs.length - 1;
      let body;
      if (q.qtype === 'gap') {
        const parts = String(q.prompt || '').split(BLANK_RE);
        const val = Q.answers[q.id] ?? '';
        const input = `<input class="s-gap" id="gap-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-label="Пропущене слово" value="${esc(val)}" size="${Math.max(6, String(val).length + 1)}">`;
        const prompt = parts.length > 1
          ? parts.map((p, i) => esc(p) + (i === 0 ? input : i < parts.length - 1 ? '<span class="quiz__blank">&nbsp;</span>' : '')).join('')
          : `${esc(q.prompt)}<br>${input}`;
        body = html`<p class="quiz__question s-quiz__q" id="qq">${raw(prompt)}</p>
          <p class="text-sm muted s-quiz__hint">${raw(icon('edit', 'icon--sm'))}Впишіть пропущене слово просто в речення</p>`;
      } else {
        const sel = Q.answers[q.id];
        body = html`<p class="quiz__question s-quiz__q" id="qq">${promptHtml(q.prompt, sel != null ? q.options?.[sel] : '')}</p>
          <ul class="quiz__options" role="radiogroup" aria-labelledby="qq">
            ${(q.options || []).map((o, i) => html`<li><button class="quiz-option" type="button" role="radio" aria-checked="${String(sel === i)}" tabindex="${(sel == null ? i === 0 : sel === i) ? '0' : '-1'}" data-opt="${i}"><span class="quiz-option__key" aria-hidden="true">${KEYS[i]}</span><span class="quiz-option__text">${o}</span></button></li>`)}
          </ul>`;
      }
      return html`<div class="quiz s-quiz" data-quiz>
        <div class="s-quiz__top"><span class="quiz__counter" aria-live="polite">Питання ${Q.i + 1} з ${qs.length}</span><span class="text-sm muted">${q.qtype === 'gap' ? 'Впишіть слово' : 'Оберіть варіант'}</span></div>
        ${steps()}
        <div class="s-quiz__card" data-qcard>${body}</div>
        <div class="s-quiz__nav">
          <button class="btn btn--secondary" type="button" data-prev ${Q.i === 0 ? raw('disabled') : ''}>${raw(icon('arrowLeft'))}Назад</button>
          <button class="btn btn--primary" type="button" data-next>${last ? 'До перевірки' : 'Далі'}${raw(icon(last ? 'checkCircle' : 'arrowRight'))}</button>
        </div>
        ${qs.length > 1 ? html`<p class="text-xs muted s-quiz__kbd hide-mobile">Підказка: клавіші A–${KEYS[Math.min(7, Math.max(...qs.map((x) => (x.options || []).length), 1) - 1)]} обирають варіант, Enter — далі.</p>` : ''}
      </div>`;
    }

    function reviewView() {
      const n = nAnswered();
      const pct = Math.round((n / qs.length) * 100);
      return html`<div class="quiz s-quiz" data-quiz>
        ${steps()}
        <div class="s-quiz__review-head">
          <p class="h2">Ви відповіли на ${n} з ${qs.length}</p>
          <p class="text-sm muted">${n === qs.length ? 'Перевірте відповіді й здавайте. У тесту одна спроба.' : 'Деякі питання без відповіді — натисніть на питання, щоб повернутися до нього.'}</p>
          <div class="progress${n === qs.length ? ' progress--hl' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Відповіді" style="--value:${pct}%"><div class="progress__bar"></div></div>
        </div>
        <ol class="s-qlist">
          ${qs.map((q, i) => html`<li><button class="s-qlist__item${answered(q) ? '' : ' s-qlist__item--empty'}" type="button" data-goto="${i}">
            <span class="s-qlist__n">${i + 1}</span>
            <span class="s-qlist__body"><span class="s-qlist__q">${promptHtml(q.prompt, '')}</span>
              <span class="s-qlist__a">${answered(q) ? answerText(q, Q.answers[q.id]) : html`<span class="badge badge--warning">${raw(icon('alert'))}Без відповіді</span>`}</span></span>
            ${raw(icon('edit', 'icon--sm'))}<span class="sr-only">Змінити відповідь</span>
          </button></li>`)}
        </ol>
        <div class="stack stack--sm">
          <button class="btn btn--primary btn--lg btn--block" type="button" data-submit-quiz>${raw(icon('send'))}<span>Здати тест</span></button>
          <button class="btn btn--ghost btn--block" type="button" data-goto="${qs.length - 1}">${raw(icon('arrowLeft'))}Повернутися до питань</button>
        </div>
      </div>`;
    }

    function paint(focus = true) {
      host.innerHTML = String(Q.review ? reviewView() : questionView());
      if (!focus) return;
      if (Q.review) {
        const h = host.querySelector('.s-quiz__review-head .h2');
        h?.setAttribute('tabindex', '-1'); h?.focus({ preventScroll: true });
      } else {
        const q = qs[Q.i];
        if (q.qtype === 'gap') host.querySelector('#gap-input')?.focus({ preventScroll: true });
        else host.querySelector('.quiz-option[tabindex="0"]')?.focus({ preventScroll: true });
      }
      const top = host.closest('.s-workarea')?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight * 0.6) host.closest('.s-workarea')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function choose(i) {
      const q = qs[Q.i];
      Q.answers[q.id] = i; persist();
      host.querySelectorAll('.quiz-option').forEach((b) => {
        const on = Number(b.dataset.opt) === i;
        b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
      });
      const blank = host.querySelector('#qq .quiz__blank');
      if (blank) { blank.textContent = q.options?.[i] ?? ''; blank.classList.remove('s-pop'); void blank.offsetWidth; blank.classList.add('s-pop'); }
      host.querySelector('.steps').outerHTML = String(steps());
    }
    function go(i) { Q.i = Math.max(0, Math.min(qs.length - 1, i)); Q.review = false; persist(); paint(); }
    function next() { if (Q.i < qs.length - 1) go(Q.i + 1); else { Q.review = true; paint(); } }

    host.addEventListener('click', async (e) => {
      const opt = e.target.closest('[data-opt]');
      if (opt) { choose(Number(opt.dataset.opt)); return; }
      if (e.target.closest('[data-prev]')) { go(Q.i - 1); return; }
      if (e.target.closest('[data-next]')) { next(); return; }
      const g = e.target.closest('[data-goto]');
      if (g) { go(Number(g.dataset.goto)); return; }
      const sb2 = e.target.closest('[data-submit-quiz]');
      if (sb2) {
        const n = nAnswered();
        const ok = await confirmDialog({
          title: 'Здати тест?',
          text: n === qs.length ? `Ви відповіли на всі ${qs.length} ${plural(qs.length, 'питання', 'питання', 'питань')}. У тесту одна спроба — після здачі змінити відповіді не вийде.` : `Ви відповіли на ${n} з ${qs.length}. Питання без відповіді зарахуються як неправильні. У тесту одна спроба.`,
          confirmLabel: 'Здати тест',
        });
        if (!ok) return;
        const quiz = {};
        qs.forEach((q) => { if (answered(q)) quiz[q.id] = q.qtype === 'single' ? Number(Q.answers[q.id]) : String(Q.answers[q.id]).trim(); });
        await submit(sb2, { quiz });
      }
    });
    host.addEventListener('input', (e) => {
      if (e.target.id !== 'gap-input') return;
      const q = qs[Q.i];
      Q.answers[q.id] = e.target.value;
      e.target.size = Math.max(6, e.target.value.length + 1);
      persist();
      const stepsEl = host.querySelector('.steps'); if (stepsEl) stepsEl.outerHTML = String(steps());
    });
    host.addEventListener('keydown', (e) => {
      if (Q.review || e.altKey || e.ctrlKey || e.metaKey) return;
      const q = qs[Q.i];
      if (e.target.id === 'gap-input') { if (e.key === 'Enter') { e.preventDefault(); next(); } return; }
      if (q.qtype !== 'single') return;
      const n = (q.options || []).length;
      const cur = Q.answers[q.id];
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key) && e.target.closest('.quiz__options')) {
        e.preventDefault();
        const dir = ['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1;
        const from = cur == null ? (dir > 0 ? -1 : 0) : Number(cur);
        const i = (from + dir + n) % n;
        choose(i); host.querySelector(`[data-opt="${i}"]`)?.focus();
        return;
      }
      const k = e.key.length === 1 ? e.key.toUpperCase() : '';
      const idx = KEYS.indexOf(k) > -1 ? KEYS.indexOf(k) : (/^[1-8]$/.test(e.key) ? Number(e.key) - 1 : -1);
      if (idx > -1 && idx < n) { e.preventDefault(); choose(idx); host.querySelector(`[data-opt="${idx}"]`)?.focus(); return; }
      if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); next(); }
    });
    paint(false);
  }
}

