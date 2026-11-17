// #/t/assignments: assignment library. Also exports small helpers shared by the other task pages
// (t-assignment-new, t-assignment, t-review, t-review-item), because those may only live in page files.
import * as api from '../api.js';
import { sb } from '../supabase.js';
import { BUCKET, MAX_FILE_MB } from '../config.js';
import { state, isAdmin, isSchool } from '../state.js';
import { setTitle, setCount } from '../shell.js';
import { html, raw, esc, fmtDate, fmtDateShort, plural, debounce, LEVELS } from '../utils.js';
import { icon, pageHeader, emptyState, skeletonRows, errorState, toast, toastError, confirmDialog, on, avatar, levelBadge, openModal } from '../ui.js';

// ====================================================================
// Shared helpers
// ====================================================================
export const ic = (name, cls = '') => raw(icon(name, cls));

export const KINDS = {
  text: { label: 'Текст', icon: 'edit', hint: 'Учень пише відповідь просто в застосунку' },
  file: { label: 'Фото/файл', icon: 'camera', hint: 'Фото зошита, аудіо чи документ' },
  link: { label: 'Посилання', icon: 'link', hint: 'Відео, стаття або вправа на іншому сайті' },
  quiz: { label: 'Квіз', icon: 'checkCircle', hint: 'Тест з автоперевіркою і миттєвою оцінкою' },
};
export const kindOf = (k) => KINDS[k] || KINDS.text;
/** Small pill: icon + label */
export function kindTag(kind) {
  const k = kindOf(kind);
  return html`<span class="tk-kind tk-kind--${kind}">${ic(k.icon)}${k.label}</span>`;
}
/** Square tinted icon used as a row lead */
export function kindLead(kind) {
  return html`<span class="list-row__lead tk-lead tk-lead--${kind}" aria-hidden="true">${ic(kindOf(kind).icon)}</span>`;
}

export const scale = () => Number(state.space?.grade_scale) || 12;
export const scoreText = (s) => (s == null ? '—' : `${Number(s)} / ${scale()}`);
export const DONE = ['submitted', 'graded'];

export function fileIcon(type = '', name = '') {
  if (/^image\//.test(type)) return 'image';
  if (/^audio\//.test(type) || /\.(m4a|mp3|wav|ogg|aac)$/i.test(name)) return 'headphones';
  if (/^video\//.test(type)) return 'video';
  return 'file';
}
export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1024 / 1024).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} МБ`;
}
export const isImage = (f) => /^image\//.test(f?.type || '') || /\.(jpe?g|png|webp|gif|heic)$/i.test(f?.name || '');

/**
 * Files block: images as thumbnails (open in lightbox), other files as download rows.
 * Links are signed lazily by hydrateFiles(root).
 */
export function filesBlock(files = [], { emptyText = '' } = {}) {
  if (!files?.length) return emptyText ? html`<p class="muted text-sm">${emptyText}</p>` : '';
  const imgs = files.filter(isImage);
  const docs = files.filter((f) => !isImage(f));
  return html`<div class="tk-files">
    ${imgs.length ? html`<ul class="thumbs tk-thumbs">${imgs.map((f, i) => html`<li class="thumb">
      <button class="tk-thumb-btn" type="button" data-lightbox="${f.path}" data-name="${f.name}" aria-label="${`Відкрити фото ${i + 1}: ${f.name}`}">
        <span class="skeleton skeleton--block tk-thumb-skel"></span><img alt="" data-sign-img="${f.path}" hidden>
      </button></li>`)}</ul>` : ''}
    ${docs.length ? html`<ul class="tk-filelist">${docs.map((f) => html`<li>
      <a class="tk-file" data-sign-href="${f.path}" href="#" target="_blank" rel="noopener" download="${f.name}">
        <span class="tk-file__icon">${ic(fileIcon(f.type, f.name))}</span>
        <span class="tk-file__body"><span class="tk-file__name">${f.name}</span><span class="tk-file__meta">${fmtSize(f.size)}</span></span>
        <span class="tk-file__dl">${ic('download')}<span class="sr-only">Завантажити</span></span>
      </a></li>`)}</ul>` : ''}
  </div>`;
}
const signCache = new Map();
export async function signed(path) {
  if (!path) return '';
  const hit = signCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const url = await api.signedUrl(path, 3600);
  if (url) signCache.set(path, { url, exp: Date.now() + 50 * 60 * 1000 });
  return url;
}
/** Fill signed URLs for [data-sign-href] and [data-sign-img] inside root. */
export async function hydrateFiles(root) {
  const links = [...root.querySelectorAll('[data-sign-href]')];
  const imgs = [...root.querySelectorAll('[data-sign-img]')];
  await Promise.all([
    ...links.map(async (a) => {
      const url = await signed(a.dataset.signHref);
      if (url) a.href = url; else { a.removeAttribute('href'); a.classList.add('tk-file--missing'); a.querySelector('.tk-file__meta').textContent = 'Файл недоступний'; }
    }),
    ...imgs.map(async (img) => {
      const url = await signed(img.dataset.signImg);
      const skel = img.parentElement?.querySelector('.tk-thumb-skel');
      if (url) { img.onload = () => { img.hidden = false; skel?.remove(); }; img.onerror = () => skel?.classList.add('tk-thumb-skel--err'); img.src = url; }
      else skel?.classList.add('tk-thumb-skel--err');
    }),
  ]);
}
/** Delegate thumbnail clicks to a lightbox modal. */
export function bindLightbox(root) {
  on(root, '[data-lightbox]', async (e, btn) => {
    const all = [...root.querySelectorAll('[data-lightbox]')];
    let idx = all.indexOf(btn);
    const { dialog } = openModal({
      title: btn.dataset.name || 'Фото',
      wide: true,
      body: `<div class="tk-lightbox"><div class="tk-lightbox__stage"><span class="spinner" role="status" aria-label="Завантаження"></span><img class="tk-lightbox__img" alt="" hidden></div>
        ${all.length > 1 ? `<div class="tk-lightbox__nav"><button class="btn btn--secondary btn--icon" type="button" data-lb="-1" aria-label="Попереднє фото">${icon('chevronLeft')}</button><span class="text-sm muted num" data-lb-pos></span><button class="btn btn--secondary btn--icon" type="button" data-lb="1" aria-label="Наступне фото">${icon('chevronRight')}</button></div>` : ''}</div>`,
      foot: `<a class="btn btn--secondary" data-lb-open target="_blank" rel="noopener">${icon('external')}Відкрити оригінал</a><button class="btn btn--primary" type="button" data-close>Закрити</button>`,
    });
    const img = dialog.querySelector('.tk-lightbox__img');
    const spin = dialog.querySelector('.spinner');
    const show = async () => {
      const b = all[idx];
      dialog.querySelector('.modal__title').textContent = b.dataset.name || 'Фото';
      const pos = dialog.querySelector('[data-lb-pos]'); if (pos) pos.textContent = `${idx + 1} з ${all.length}`;
      img.hidden = true; spin.hidden = false;
      const url = await signed(b.dataset.lightbox);
      if (!dialog.isConnected) return;
      dialog.querySelector('[data-lb-open]').href = url || '#';
      img.alt = b.dataset.name || 'Фото';
      img.onload = () => { img.hidden = false; spin.hidden = true; };
      img.src = url;
    };
    dialog.addEventListener('click', (ev) => {
      const nav = ev.target.closest('[data-lb]');
      if (nav) { idx = (idx + Number(nav.dataset.lb) + all.length) % all.length; show(); }
    });
    dialog.addEventListener('keydown', (ev) => {
      if (all.length < 2) return;
      if (ev.key === 'ArrowRight') { idx = (idx + 1) % all.length; show(); }
      if (ev.key === 'ArrowLeft') { idx = (idx - 1 + all.length) % all.length; show(); }
    });
    show();
  });
}

/** Render a prompt with ___ blanks highlighted. */
export function promptHtml(prompt = '') {
  const parts = String(prompt).split(/_{2,}/);
  return raw(parts.map((p) => esc(p)).join('<span class="quiz__blank tk-blank" aria-label="пропуск">&nbsp;</span>'));
}
const LETTERS = 'ABCDEF';
export const letter = (i) => LETTERS[i] || String(i + 1);

/**
 * Quiz preview. questions: [{id, qtype, prompt, options, answer}]
 * result (optional): quiz_result {per:{[qid]:{ok, answer}}} → shows the student's answers vs correct.
 */
export function quizBlock(questions = [], result = null) {
  if (!questions.length) return html`<p class="muted text-sm">Питань немає.</p>`;
  return html`<ol class="tk-quiz">${questions.map((q, i) => {
    const r = result?.per?.[q.id];
    const answered = r && r.answer != null && r.answer !== '';
    const st = !result ? '' : r?.ok ? 'ok' : 'bad';
    return html`<li class="tk-q${st ? ' tk-q--' + st : ''}">
      <div class="tk-q__head">
        <span class="tk-q__num">${i + 1}</span>
        <p class="tk-q__prompt">${promptHtml(q.prompt)}</p>
        ${result ? html`<span class="tk-q__mark tk-q__mark--${st}">${ic(r?.ok ? 'checkCircle' : 'xCircle')}<span class="sr-only">${r?.ok ? 'Правильно' : 'Неправильно'}</span></span>` : ''}
      </div>
      ${q.qtype === 'single'
        ? html`<ul class="tk-q__opts">${(q.options || []).map((o, oi) => {
          const correct = Number(q.answer) === oi;
          const picked = result && answered && Number(r.answer) === oi;
          const cls = correct ? ' tk-opt--correct' : picked ? ' tk-opt--wrong' : '';
          return html`<li class="tk-opt${cls}"><span class="tk-opt__key">${letter(oi)}</span><span class="tk-opt__text">${o}</span>
            ${picked ? html`<span class="tk-opt__tag">${result ? 'відповідь учня' : ''}</span>` : ''}
            ${correct ? html`<span class="sr-only">Правильна відповідь</span>${ic('check', 'tk-opt__mark')}` : ''}</li>`;
        })}${result && !answered ? html`<li class="tk-opt tk-opt--none">Учень не відповів</li>` : ''}</ul>`
        : html`<div class="tk-q__gap">
          ${result ? html`<p class="tk-gap tk-gap--${st}"><span class="tk-gap__label">Учень:</span> <strong>${answered ? String(r.answer) : 'немає відповіді'}</strong></p>` : ''}
          ${!result || !r?.ok ? html`<p class="tk-gap tk-gap--key"><span class="tk-gap__label">${(q.answer || []).length > 1 ? 'Приймаються:' : 'Правильно:'}</span> ${(Array.isArray(q.answer) ? q.answer : []).map((a, ai) => html`${ai ? ', ' : ''}<strong>${a}</strong>`)}</p>` : ''}
        </div>`}
    </li>`;
  })}</ol>`;
}

/** Student multi-picker. Returns { el-html, bind(root, onChange) } via helpers below. */
export function studentPickerHtml(students, { idPrefix = 'sp', showTeacher = false } = {}) {
  if (!students.length) return '';
  const levels = LEVELS.filter((l) => students.some((s) => (s.cefr_level || 'A1') === l));
  return html`<div class="tk-picker" data-picker>
    <div class="tk-picker__tools">
      <div class="input-wrap tk-picker__search"><label class="sr-only" for="${idPrefix}-q">Пошук учня</label>${ic('search')}<input class="input" id="${idPrefix}-q" type="search" placeholder="Пошук за імʼям" data-picker-search autocomplete="off"></div>
      <div class="chips chips--scroll tk-picker__chips" role="group" aria-label="Швидкий вибір">
        <button class="chip" type="button" data-picker-all aria-pressed="false">${ic('users')}Усі</button>
        ${levels.length > 1 ? levels.map((l) => html`<button class="chip" type="button" data-picker-level="${l}" aria-pressed="false">${l}</button>`) : ''}
      </div>
    </div>
    <ul class="tk-picker__list" role="group" aria-label="Учні">
      ${students.map((s) => html`<li data-picker-item data-name="${(s.full_name || '').toLowerCase()}" data-level="${s.cefr_level || 'A1'}">
        <label class="tk-pick">
          <input type="checkbox" value="${s.id}" data-picker-check>
          ${avatar(s.full_name, 'sm')}
          <span class="tk-pick__body"><span class="tk-pick__name">${s.full_name}</span>${showTeacher && s.teacher?.full_name ? html`<span class="tk-pick__meta">${s.teacher.full_name}</span>` : ''}</span>
          ${levelBadge(s.cefr_level)}
          <span class="tk-pick__check" aria-hidden="true">${ic('check')}</span>
        </label></li>`)}
    </ul>
    <p class="tk-picker__none muted text-sm" hidden>Нікого не знайдено.</p>
  </div>`;
}
/** Wire picker behaviour. selected: Set of ids (mutated). onChange(selected) */
export function bindStudentPicker(root, selected, onChange = () => {}) {
  const box = root.querySelector('[data-picker]');
  if (!box) return { sync() {} };
  const checks = () => [...box.querySelectorAll('[data-picker-check]')];
  const visible = () => checks().filter((c) => !c.closest('[data-picker-item]').hidden);
  const sync = () => {
    checks().forEach((c) => { c.checked = selected.has(c.value); });
    const vis = visible();
    box.querySelector('[data-picker-all]').setAttribute('aria-pressed', String(vis.length > 0 && vis.every((c) => c.checked)));
    box.querySelectorAll('[data-picker-level]').forEach((b) => {
      const lv = checks().filter((c) => c.closest('[data-picker-item]').dataset.level === b.dataset.pickerLevel);
      b.setAttribute('aria-pressed', String(lv.length > 0 && lv.every((c) => c.checked)));
    });
    onChange(selected);
  };
  box.addEventListener('change', (e) => {
    const c = e.target.closest('[data-picker-check]'); if (!c) return;
    if (c.checked) selected.add(c.value); else selected.delete(c.value);
    sync();
  });
  box.querySelector('[data-picker-search]').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    box.querySelectorAll('[data-picker-item]').forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); if (!li.hidden) shown++; });
    box.querySelector('.tk-picker__none').hidden = shown > 0;
    sync();
  });
  box.querySelector('[data-picker-all]').addEventListener('click', (e) => {
    const vis = visible();
    const allOn = e.currentTarget.getAttribute('aria-pressed') === 'true';
    vis.forEach((c) => (allOn ? selected.delete(c.value) : selected.add(c.value)));
    sync();
  });
  box.querySelectorAll('[data-picker-level]').forEach((b) => b.addEventListener('click', () => {
    const lv = checks().filter((c) => c.closest('[data-picker-item]').dataset.level === b.dataset.pickerLevel);
    const allOn = b.getAttribute('aria-pressed') === 'true';
    lv.forEach((c) => (allOn ? selected.delete(c.value) : selected.add(c.value)));
    sync();
  }));
  sync();
  return { sync };
}

/** Remove an assignment's own attachment files from storage (best effort). */
export async function removeAssignmentFiles(a) {
  const prefix = `a/${state.space?.id}/${a.id}/`;
  const paths = (a.attachments || []).map((f) => f.path).filter((p) => p?.startsWith(prefix));
  if (!paths.length) return;
  try { await sb.storage.from(BUCKET).remove(paths); } catch (e) { console.warn(e); }
}
/** Confirm + delete. Returns true when deleted. */
export async function confirmDeleteAssignment(a) {
  const n = a.targets?.length || 0;
  const ok = await confirmDialog({
    title: `Видалити «${a.title}»?`,
    text: n ? `Завдання зникне в ${n} ${plural(n, 'учня', 'учнів', 'учнів')}, а їхні відповіді й оцінки буде видалено назавжди.` : 'Завдання буде видалено з бібліотеки назавжди.',
    confirmLabel: 'Видалити завдання',
    danger: true,
  });
  if (!ok) return false;
  await api.deleteAssignment(a.id);
  removeAssignmentFiles(a);
  toast('Завдання видалено');
  return true;
}
export const MAX_MB = MAX_FILE_MB;

// ====================================================================
// Page
// ====================================================================
function progressOf(a) {
  const t = a.targets || [];
  const done = t.filter((x) => DONE.includes(x.status)).length;
  const review = t.filter((x) => x.status === 'submitted').length;
  return { total: t.length, done, review, pct: t.length ? Math.round((done / t.length) * 100) : 0 };
}

function cardHtml(a) {
  const p = progressOf(a);
  return html`<li class="tk-acard" data-id="${a.id}">
    <a class="tk-acard__main" href="#/t/assignments/${a.id}">
      ${kindLead(a.kind)}
      <span class="tk-acard__body">
        <span class="tk-acard__title">${a.title}</span>
        <span class="list-row__meta">
          <span>${kindOf(a.kind).label}</span>
          <span>${ic('calendar')}${fmtDateShort(a.created_at)}</span>
          ${a.is_demo ? html`<span class="badge badge--outline">приклад</span>` : ''}
        </span>
      </span>
    </a>
    <div class="tk-acard__progress">
      ${p.total
        ? html`<div class="progress-labeled">
            <div class="progress-labeled__row"><span>${p.done} з ${p.total} ${plural(p.total, 'здав', 'здали', 'здали')}</span>
              ${p.review ? html`<a class="badge badge--hl" href="#/t/review">${p.review} на перевірку</a>` : ''}</div>
            <div class="progress progress--sm" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${`Здали ${p.done} з ${p.total}`}" style="--value:${p.pct}%"><div class="progress__bar"></div></div>
          </div>`
        : html`<span class="text-sm muted">Ще не призначено</span>`}
    </div>
    <div class="tk-acard__actions">
      <a class="btn btn--ghost btn--icon btn--sm" href="#/t/assignments/new?from=${a.id}" aria-label="${`Дублювати «${a.title}»`}" title="Дублювати">${ic('copy')}</a>
      <button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="delete" aria-label="${`Видалити «${a.title}»`}" title="Видалити">${ic('trash')}</button>
    </div>
  </li>`;
}

export default async function render({ view, query, alive }) {
  setTitle('Завдання');
  const f = { kind: query.kind || 'all', q: query.q || '', who: 'mine' };
  const schoolAdmin = isSchool() && isAdmin();
  let items = [];

  const header = (count) => pageHeader({
    title: 'Завдання',
    meta: count ? `${count} ${plural(count, 'завдання', 'завдання', 'завдань')} у бібліотеці` : 'Бібліотека ваших домашніх завдань',
    actions: count ? html`<a class="btn btn--primary" href="#/t/assignments/new">${ic('plus')}Нове завдання</a>` : '',
  });

  view.innerHTML = String(html`${header(0)}<div class="tk-toolbar" aria-hidden="true"><span class="skeleton skeleton--block" style="height:44px;max-width:360px"></span></div>${skeletonRows(4)}`);
  try {
    items = await api.listAssignments();
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(html`${header(0)}${errorState(err.message)}`);
    return;
  }
  if (!alive()) return;
  setCount('review', items.reduce((n, a) => n + (a.targets || []).filter((t) => t.status === 'submitted').length, 0));
  if (schoolAdmin && !items.some((a) => a.teacher_id === state.user.id)) f.who = 'all';

  const scoped = () => (schoolAdmin && f.who === 'mine' ? items.filter((a) => a.teacher_id === state.user.id) : items);
  const filtered = () => {
    const q = f.q.trim().toLowerCase();
    return scoped().filter((a) => (f.kind === 'all' || a.kind === f.kind) && (!q || a.title.toLowerCase().includes(q) || (a.instructions || '').toLowerCase().includes(q)));
  };

  function shell() {
    if (!items.length) {
      view.innerHTML = String(html`${header(0)}${emptyState({
        icon: 'clipboard',
        title: 'Створіть перше завдання',
        text: 'Есе, фото зошита, посилання на відео чи квіз з автоперевіркою. Завдання зберігаються тут, і їх легко дублювати для інших учнів.',
        action: html`<div class="cluster" style="justify-content:center"><a class="btn btn--primary" href="#/t/assignments/new">${ic('plus')}Нове завдання</a><button class="btn btn--ghost" type="button" data-action="demo">${ic('sparkles')}Заповнити прикладом</button></div>`,
      })}`);
      return;
    }
    const sc = scoped();
    const counts = { all: sc.length };
    Object.keys(KINDS).forEach((k) => { counts[k] = sc.filter((a) => a.kind === k).length; });
    view.innerHTML = String(html`${header(items.length)}
      <div class="tk-toolbar">
        <div class="input-wrap tk-toolbar__search"><label class="sr-only" for="as-q">Пошук завдань</label>${ic('search')}
          <input class="input" id="as-q" type="search" placeholder="Пошук за назвою" value="${f.q}" autocomplete="off"></div>
        ${schoolAdmin ? html`<div class="segmented" role="radiogroup" aria-label="Чиї завдання">
          <label><input type="radio" name="who" value="mine" ${f.who === 'mine' ? raw('checked') : ''}><span>Мої</span></label>
          <label><input type="radio" name="who" value="all" ${f.who === 'all' ? raw('checked') : ''}><span>Уся школа</span></label></div>` : ''}
        <div class="chips chips--scroll" role="group" aria-label="Тип завдання">
          <button class="chip" type="button" data-kind="all" aria-pressed="${String(f.kind === 'all')}">Усі <span class="chip__count">${counts.all}</span></button>
          ${Object.entries(KINDS).map(([k, v]) => html`<button class="chip" type="button" data-kind="${k}" aria-pressed="${String(f.kind === k)}">${ic(v.icon)}${v.label} <span class="chip__count">${counts[k]}</span></button>`)}
        </div>
      </div>
      <div data-list></div>`);
    list();
  }

  function list() {
    const box = view.querySelector('[data-list]');
    if (!box) return;
    const rows = filtered();
    if (!rows.length) {
      box.innerHTML = String(emptyState({
        icon: 'search', title: 'Нічого не знайдено', text: 'Спробуйте інший запит або тип завдання.',
        action: html`<button class="btn btn--secondary" type="button" data-action="reset">Скинути фільтри</button>`,
      }));
      return;
    }
    box.innerHTML = String(html`<ul class="tk-alist">${rows.map(cardHtml)}</ul>`);
  }

  shell();

  on(view, '[data-kind]', (e, b) => {
    f.kind = b.dataset.kind;
    view.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    list();
  });
  view.addEventListener('input', debounce((e) => { if (e.target.id === 'as-q') { f.q = e.target.value; list(); } }, 150));
  view.addEventListener('change', (e) => { if (e.target.name === 'who') { f.who = e.target.value; shell(); } });
  on(view, '[data-action="reset"]', () => { f.kind = 'all'; f.q = ''; shell(); });
  on(view, '[data-action="delete"]', async (e, b) => {
    const id = b.closest('[data-id]').dataset.id;
    const a = items.find((x) => x.id === id);
    try {
      if (!(await confirmDeleteAssignment(a))) return;
      items = items.filter((x) => x.id !== id);
      if (alive()) shell();
    } catch (err) { toastError(err); }
  });
  on(view, '[data-action="demo"]', async (e, b) => {
    b.disabled = true;
    try {
      await api.seedDemo();
      toast('Додали приклади', { text: 'Учні, уроки й завдання позначені як «приклад».' });
      items = await api.listAssignments();
      if (alive()) shell();
    } catch (err) { toastError(err); b.disabled = false; }
  });
}
