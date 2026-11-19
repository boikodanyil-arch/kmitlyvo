// Student: list of own tasks (#/s/tasks?tab=todo|done|graded).
// Also exports small shared helpers used by the other student pages.
import * as api from '../api.js';
import { sb, must } from '../supabase.js';
import { state } from '../state.js';
import { setTitle, setCount } from '../shell.js';
import { html, raw, plural, relDay, fmtTime, fmtDateShort, fmtFullDate, dayKey, isOverdue } from '../utils.js';
import { icon, targetStatus, pageHeader, emptyState, errorState } from '../ui.js';

// ---------------- shared helpers (student area) ----------------
export const KIND = {
  text: { icon: 'edit', label: 'Письмова робота' },
  file: { icon: 'camera', label: 'Фото або файл' },
  link: { icon: 'link', label: 'Матеріал за посиланням' },
  quiz: { icon: 'target', label: 'Тест' },
  textbook: { icon: 'book', label: 'Сторінки підручника' },
};
export const kindOf = (t) => KIND[t.assignment?.kind] || KIND.text;
export const scale = () => Number(state.space?.grade_scale) || 12;
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '';
export const fmtScore = (n) => (n == null ? '—' : String(Math.round(Number(n) * 10) / 10).replace('.', ','));
export const isTodo = (t) => ['assigned', 'returned'].includes(t.status);
export const isAutoFeedback = (f) => /^\s*автоперевірка/i.test(String(f || ''));
export const dueTime = (t) => (t.due_at ? new Date(t.due_at).getTime() : Infinity);

/** Days between today and d (Warsaw calendar days). */
export function dayDiff(d) { return Math.round((Date.parse(dayKey(d)) - Date.parse(dayKey(new Date()))) / 86400000); }

/** «Сьогодні», «Завтра» or «Понеділок, 24 листопада». */
export function whenLabel(d) {
  const diff = dayDiff(d);
  if (diff === 0) return 'Сьогодні';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчора';
  return cap(fmtFullDate(d));
}

/** Friendly deadline: «Здати завтра о 21:00», «Термін минув 2 дні тому», «Без дедлайну». */
export function dueText(t) {
  if (!t.due_at) return 'Без дедлайну';
  // A deadline at 00:00 means «until the end of the previous day».
  const midnight = fmtTime(t.due_at) === '00:00';
  const ref = midnight ? new Date(new Date(t.due_at).getTime() - 60000) : new Date(t.due_at);
  const diff = dayDiff(ref);
  const at = midnight ? 'до кінця дня' : `о ${fmtTime(t.due_at)}`;
  if (isOverdue(t)) return diff === 0 ? `Термін минув ${midnight ? 'вчора' : `о ${fmtTime(t.due_at)}`}` : `Термін минув ${relDay(ref)}`;
  if (!isTodo(t)) return `Дедлайн ${fmtDateShort(ref)}`;
  if (diff >= 0 && diff <= 6) return `Здати ${relDay(ref)} ${at}`;
  return `Здати до ${fmtDateShort(ref)}${midnight ? '' : `, ${fmtTime(t.due_at)}`}`;
}

export function snippet(s, n = 110) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/** Score pill: «10 / 12» */
export function scorePill(score) {
  return html`<span class="s-score" aria-label="Оцінка ${fmtScore(score)} з ${scale()}"><b>${fmtScore(score)}</b><small>/${scale()}</small></span>`;
}

/** Teacher's name (profiles is readable for the student's own teacher). */
let teacherCache = null;
export async function teacherName() {
  const id = state.student?.teacher_id;
  if (!id) return '';
  if (teacherCache?.id === id) return teacherCache.name;
  try {
    const row = must(await sb.from('profiles').select('full_name').eq('id', id).maybeSingle());
    teacherCache = { id, name: row?.full_name || '' };
    return teacherCache.name;
  } catch { return ''; }
}

/** Submission timestamps per target (first attempt) — for «здано вчасно». */
export async function firstSubmissions() {
  try {
    const rows = must(await sb.from('submissions').select('target_id, attempt_no, submitted_at').eq('student_id', state.student.id).order('attempt_no'));
    const map = new Map();
    rows.forEach((r) => { if (!map.has(r.target_id)) map.set(r.target_id, r.submitted_at); });
    return map;
  } catch { return new Map(); }
}

/** { onTime, total }: total = handed-in + overdue tasks; onTime = handed in before the deadline. */
export function onTimeStats(targets, firstSub) {
  let onTime = 0; let total = 0;
  targets.forEach((t) => {
    if (['submitted', 'graded'].includes(t.status) || (t.status === 'returned' && firstSub.has(t.id))) {
      total += 1;
      const at = firstSub.get(t.id);
      if (!t.due_at || !at || new Date(at) <= new Date(t.due_at)) onTime += 1;
    } else if (isOverdue(t)) total += 1;
  });
  return { onTime, total };
}

/** Sort: to-do by deadline (overdue first naturally), done by newest. */
export function sortTodo(list) { return [...list].sort((a, b) => dueTime(a) - dueTime(b)); }

/** One task row (list--card item). */
export function taskRow(t, { showFeedback = true } = {}) {
  const k = kindOf(t);
  const overdue = isOverdue(t);
  const returned = t.status === 'returned';
  return html`<li><a class="list-row s-task-row${overdue ? ' s-task-row--overdue' : ''}${returned ? ' s-task-row--returned' : ''}" href="#/s/tasks/${t.id}">
    <span class="list-row__lead s-kind s-kind--${t.assignment?.kind || 'text'}" title="${k.label}">${raw(icon(k.icon))}</span>
    <span class="list-row__body">
      <span class="list-row__title">${t.assignment?.title || 'Завдання'}</span>
      <span class="list-row__meta">
        ${targetStatus(t)}
        <span class="${overdue ? 'c-danger fw-600' : ''}">${raw(icon('clock'))}${dueText(t)}</span>
      </span>
      ${returned && showFeedback && t.feedback ? html`<span class="s-task-row__note">${raw(icon('message', 'icon--sm'))}<span><b>Повернуто на доопрацювання.</b> ${snippet(t.feedback, 90)}</span></span>` : ''}
    </span>
    <span class="list-row__trail">${t.status === 'graded' && t.score != null ? scorePill(t.score) : ''}${raw(icon('chevronRight'))}</span>
  </a></li>`;
}

export function listSkeleton(n = 3) {
  const rows = Array.from({ length: n }, () => '<li class="list-row"><span class="skeleton" style="width:40px;height:40px;border-radius:10px"></span><span class="list-row__body"><span class="skeleton skeleton--text" style="width:60%"></span><span class="skeleton skeleton--text" style="width:40%"></span></span></li>').join('');
  return raw(`<ul class="list list--card" aria-hidden="true">${rows}</ul>`);
}

// ---------------- page ----------------
const TABS = [
  { key: 'todo', label: 'Треба зробити', filter: isTodo },
  { key: 'done', label: 'Здано', filter: (t) => t.status === 'submitted' },
  { key: 'graded', label: 'Оцінено', filter: (t) => t.status === 'graded' },
];
const EMPTY = {
  todo: { icon: 'trophy', title: 'Усе зроблено! Можна відпочити', text: 'Нові завдання з’являться тут, щойно вчитель їх задасть.' },
  done: { icon: 'send', title: 'Тут будуть роботи на перевірці', text: 'Здайте завдання, і воно чекатиме тут, поки вчитель перевіряє.' },
  graded: { icon: 'star', title: 'Оцінок поки немає', text: 'Щойно вчитель перевірить роботу, оцінка й коментар з’являться тут.' },
};

export default async function render({ view, query, alive }) {
  setTitle('Завдання');
  let tab = TABS.some((t) => t.key === query.tab) ? query.tab : 'todo';

  view.innerHTML = String(html`
    ${pageHeader({ title: 'Завдання', meta: 'Домашні від вашого вчителя' })}
    <div class="tabs s-tabs" role="tablist" aria-label="Завдання">
      ${TABS.map((t) => html`<button class="tab" type="button" role="tab" id="tab-${t.key}" aria-controls="tasks-panel" aria-selected="${String(t.key === tab)}" data-tab="${t.key}">${t.label}<span class="tab__count" data-tcount="${t.key}" hidden></span></button>`)}
    </div>
    <div id="tasks-panel" role="tabpanel" aria-labelledby="tab-${tab}" class="s-tasks-panel">${listSkeleton(4)}<span class="sr-only" role="status">Завантаження…</span></div>`);

  let targets;
  try { targets = await api.listTargets(); } catch (err) {
    if (!alive()) return;
    view.querySelector('#tasks-panel').innerHTML = String(errorState(err.message));
    return;
  }
  if (!alive()) return;

  setCount('tasks', targets.filter(isTodo).length);
  TABS.forEach((t) => {
    const n = targets.filter(t.filter).length;
    const el = view.querySelector(`[data-tcount="${t.key}"]`);
    el.textContent = n; el.hidden = !n;
  });

  const panel = view.querySelector('#tasks-panel');
  const draw = () => {
    const def = TABS.find((t) => t.key === tab);
    let list = targets.filter(def.filter);
    list = tab === 'todo' ? sortTodo(list) : [...list].sort((a, b) => new Date(b.graded_at || b.due_at || b.created_at) - new Date(a.graded_at || a.due_at || a.created_at));
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
    if (!list.length) {
      const e = EMPTY[tab];
      const action = tab === 'todo' ? html`<a class="btn btn--secondary" href="#/s/progress">${raw(icon('trophy'))}Подивитися прогрес</a>` : html`<button class="btn btn--secondary" type="button" data-tab="todo">До завдань</button>`;
      panel.innerHTML = String(html`<div class="s-empty-joy">${emptyState({ ...e, action })}</div>`);
      return;
    }
    const overdue = tab === 'todo' ? list.filter(isOverdue).length : 0;
    panel.innerHTML = String(html`
      ${overdue ? html`<div class="alert alert--danger">${raw(icon('alert'))}<div><p class="alert__title">${overdue} ${plural(overdue, 'завдання прострочене', 'завдання прострочені', 'завдань прострочено')}</p>${overdue === 1 ? 'Здайте його' : 'Здайте їх'} якомога швидше — краще пізно, ніж ніколи.</div></div>` : ''}
      <ul class="list list--card">${list.map((t) => taskRow(t))}</ul>`);
  };
  draw();

  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b || !view.contains(b)) return;
    tab = b.dataset.tab;
    view.querySelectorAll('.tab[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === tab)));
    history.replaceState(null, '', `#/s/tasks?tab=${tab}`);
    draw();
  });
  // Arrow-key navigation between tabs
  view.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const btns = [...view.querySelectorAll('.tab[data-tab]')];
    const i = btns.findIndex((x) => x.dataset.tab === tab);
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
    next.focus(); next.click();
  });
}
