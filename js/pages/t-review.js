// #/t/review?tab=review|returned|overdue|graded: review inbox.
import * as api from '../api.js';
import { sb, must } from '../supabase.js';
import { state, isAdmin, isSchool } from '../state.js';
import { setTitle, setCount } from '../shell.js';
import { html, raw, plural, fmtTime, fmtDateShort, relDay, isOverdue } from '../utils.js';
import { pageHeader, emptyState, skeletonRows, errorState, avatar, levelBadge, targetStatus } from '../ui.js';
import { ic, kindOf, scoreText } from './t-assignments.js';

const WHO_KEY = 'kmitlyvo.reviewWho';
/** 'mine' | 'all': only meaningful for school admins. */
export function reviewScope() {
  if (!(isSchool() && isAdmin())) return 'all';
  try { return sessionStorage.getItem(WHO_KEY) || 'mine'; } catch { return 'mine'; }
}
function setScope(v) { try { sessionStorage.setItem(WHO_KEY, v); } catch { /* ignore */ } }

/** Latest submission time + attempts per target id. */
export async function submissionInfo(ids) {
  const map = new Map();
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 150) {
    const rows = must(await sb.from('submissions').select('target_id, attempt_no, submitted_at').in('target_id', ids.slice(i, i + 150)));
    rows.forEach((r) => {
      const cur = map.get(r.target_id);
      if (!cur || r.attempt_no > cur.attempts) map.set(r.target_id, { at: r.submitted_at, attempts: r.attempt_no });
    });
  }
  return map;
}

/** All targets for the inbox, with ._at (latest submission). scope: 'mine'|'all' */
export async function loadInbox(scope = reviewScope()) {
  const teacherId = scope === 'mine' && isSchool() && isAdmin() ? state.user.id : null;
  const targets = await api.listTargets({ teacherId, limit: 1000 });
  const info = await submissionInfo(targets.filter((t) => t.status !== 'assigned').map((t) => t.id));
  targets.forEach((t) => { const i = info.get(t.id); t._at = i?.at || null; t._attempts = i?.attempts || 0; });
  return targets;
}
/** Review queue: submitted, oldest first. */
export const queueOf = (targets) => targets.filter((t) => t.status === 'submitted')
  .sort((a, b) => String(a._at || a.created_at).localeCompare(String(b._at || b.created_at)));

const TABS = [
  { id: 'review', label: 'На перевірку', icon: 'inbox' },
  { id: 'returned', label: 'Повернуто', icon: 'refresh' },
  { id: 'overdue', label: 'Прострочено', icon: 'clock' },
  { id: 'graded', label: 'Оцінено', icon: 'checkCircle' },
];
function bucket(targets, tab) {
  switch (tab) {
    case 'review': return queueOf(targets);
    case 'returned': return targets.filter((t) => t.status === 'returned' && !isOverdue(t)).sort((a, b) => String(a.due_at || '9').localeCompare(String(b.due_at || '9')));
    case 'overdue': return targets.filter(isOverdue).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
    case 'graded': return targets.filter((t) => t.status === 'graded').sort((a, b) => String(b.graded_at || '').localeCompare(String(a.graded_at || ''))).slice(0, 60);
    default: return [];
  }
}
const when = (d) => `${relDay(d)}, ${fmtTime(d)}`;

function rowHtml(t, tab) {
  const k = kindOf(t.assignment?.kind);
  let timeLine;
  if (tab === 'review') timeLine = html`<span>${ic('clock')}здано ${t._at ? when(t._at) : '—'}</span>${t._attempts > 1 ? html`<span class="badge badge--outline">спроба ${t._attempts}</span>` : ''}${t._at && t.due_at && t._at > t.due_at ? html`<span class="badge badge--warning">із запізненням</span>` : ''}`;
  else if (tab === 'graded') timeLine = html`<span>${ic('check')}оцінено ${t.graded_at ? when(t.graded_at) : '—'}</span>`;
  else if (tab === 'overdue') timeLine = html`<span class="c-danger">${ic('clock')}дедлайн ${fmtDateShort(t.due_at)}, ${fmtTime(t.due_at)} · ${relDay(t.due_at)}</span>`;
  else timeLine = html`<span>${ic('clock')}${t.due_at ? `до ${fmtDateShort(t.due_at)}, ${fmtTime(t.due_at)}` : 'без дедлайну'}</span>`;
  return html`<li><a class="list-row tk-rrow" href="#/t/review/${t.id}">
    ${avatar(t.student?.full_name || '?')}
    <span class="list-row__body">
      <span class="list-row__title tk-rrow__title"><span class="truncate">${t.student?.full_name || 'Учень'}</span>${levelBadge(t.student?.cefr_level)}</span>
      <span class="tk-rrow__task">${ic(k.icon)}<span class="truncate">${t.assignment?.title || 'Завдання'}</span></span>
      <span class="list-row__meta">${timeLine}<span class="show-mobile">${targetStatus(t)}</span></span>
    </span>
    <span class="list-row__trail">
      ${tab === 'graded' && t.score != null ? html`<span class="tk-score num">${scoreText(t.score)}</span>` : ''}
      <span class="hide-mobile">${targetStatus(t)}</span>
      ${ic('chevronRight')}
    </span>
  </a></li>`;
}

const EMPTY = {
  review: { icon: 'trophy', title: 'Усе перевірено', text: 'Нові роботи з’являться тут, щойно учні їх здадуть. Можна видихнути.' },
  returned: { icon: 'refresh', title: 'Немає повернених робіт', text: 'Тут будуть роботи, які ви повернули на доопрацювання.' },
  overdue: { icon: 'clock', title: 'Ніхто не прострочив', text: 'Усі учні вкладаються в дедлайни.' },
  graded: { icon: 'checkCircle', title: 'Тут з’являться оцінені роботи', text: 'Перевірте першу роботу — і вона опиниться тут.' },
};

export default async function render({ view, query, alive }) {
  setTitle('Перевірка');
  const schoolAdmin = isSchool() && isAdmin();
  let tab = TABS.some((t) => t.id === query.tab) ? query.tab : 'review';
  let scope = reviewScope();
  let targets = [];

  const header = (n) => pageHeader({
    title: 'Перевірка',
    meta: n == null ? 'Роботи учнів' : n ? `${n} ${plural(n, 'робота чекає', 'роботи чекають', 'робіт чекають')} на перевірку` : 'Нових робіт немає',
    actions: n ? html`<a class="btn btn--primary" href="#/t/review/${queueOf(targets)[0].id}">${ic('arrowRight')}Почати перевірку</a>` : '',
  });

  async function load() {
    view.innerHTML = String(html`${header(null)}<div class="tabs" aria-hidden="true">${TABS.map((t) => html`<span class="tab">${t.label}</span>`)}</div>${skeletonRows(5)}`);
    try { targets = await loadInbox(scope); } catch (err) {
      if (!alive()) return;
      view.innerHTML = String(html`${header(null)}${errorState(err.message)}`);
      return;
    }
    if (!alive()) return;
    if (schoolAdmin && scope === 'mine' && !targets.length) {
      // admin who doesn't teach → show the whole school
      scope = 'all'; setScope('all');
      try { targets = await loadInbox(scope); } catch { /* keep empty */ }
      if (!alive()) return;
    }
    draw();
  }

  function draw() {
    const queue = queueOf(targets);
    setCount('review', queue.length);
    const counts = Object.fromEntries(TABS.map((t) => [t.id, bucket(targets, t.id).length]));
    view.innerHTML = String(html`${header(queue.length)}
      <div class="tk-review-tools">
        <div class="tabs" role="tablist" aria-label="Роботи">
          ${TABS.map((t) => html`<button class="tab" role="tab" id="tab-${t.id}" type="button" data-tab="${t.id}" aria-selected="${String(t.id === tab)}" aria-controls="review-panel" tabindex="${t.id === tab ? '0' : '-1'}">${t.label}${counts[t.id] && t.id !== 'graded' ? html` <span class="tab__count">${counts[t.id]}</span>` : ''}</button>`)}
        </div>
        ${schoolAdmin ? html`<div class="segmented" role="radiogroup" aria-label="Чиї учні">
          <label><input type="radio" name="who" value="mine" ${scope === 'mine' ? raw('checked') : ''}><span>Мої</span></label>
          <label><input type="radio" name="who" value="all" ${scope === 'all' ? raw('checked') : ''}><span>Уся школа</span></label></div>` : ''}
      </div>
      <div id="review-panel" role="tabpanel" aria-labelledby="tab-${tab}" data-panel></div>`);
    panel();
  }

  function panel() {
    const box = view.querySelector('[data-panel]');
    const rows = bucket(targets, tab);
    if (!rows.length) {
      const e = EMPTY[tab];
      const celebrate = tab === 'review' && targets.some((t) => t.status === 'graded');
      box.innerHTML = String(html`<div class="${celebrate ? 'tk-celebrate' : ''}">${emptyState({ ...e, action: tab === 'review' ? html`<a class="btn btn--secondary" href="#/t/assignments/new">${ic('plus')}Нове завдання</a>` : '' })}</div>`);
      return;
    }
    box.innerHTML = String(html`${tab === 'graded' ? html`<p class="text-sm muted">Останні оцінені роботи. Відкрийте, щоб змінити оцінку.</p>` : ''}
      ${tab === 'overdue' ? html`<p class="text-sm muted">Учні, які не здали вчасно. Відкрийте, щоб переглянути завдання.</p>` : ''}
      <ul class="list list--card">${rows.map((t) => rowHtml(t, tab))}</ul>`);
  }

  const selectTab = (id, focus = false) => {
    tab = id;
    history.replaceState(null, '', `#/t/review${tab === 'review' ? '' : `?tab=${tab}`}`);
    view.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    view.querySelector('[data-panel]')?.setAttribute('aria-labelledby', `tab-${tab}`);
    panel();
  };
  view.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); });
  view.addEventListener('keydown', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const i = TABS.findIndex((t) => t.id === b.dataset.tab);
    selectTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length].id, true);
  });
  view.addEventListener('change', (e) => { if (e.target.name === 'who') { scope = e.target.value; setScope(scope); load(); } });

  await load();
}
