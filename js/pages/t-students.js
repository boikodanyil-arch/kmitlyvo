// Students list (#/t/students): search, filters, sort.
import { state, isAdmin, isSchool } from '../state.js';
import { html, raw, esc, fmtTime, fmtDateShort, relDay, todayKey, fromZoned, addDays, debounce, LEVELS, plural } from '../utils.js';
import { icon, avatar, levelBadge, pageHeader, emptyState, errorState, skeletonRows, toast, toastError, setLoading, on } from '../ui.js';
import { listStudents, listLessons, balances, seedDemo } from '../api.js';
import { navigate } from '../router.js';
import { setTitle } from '../shell.js';
import { openStudentForm } from '../components/student-form.js';
import { balanceChip, bal } from '../components/payment-form.js';

const STATUS = [['active', 'Активні'], ['paused', 'Пауза'], ['archived', 'Архів'], ['all', 'Усі']];
const SORTS = [['name', 'За іменем'], ['next', 'За наступним уроком'], ['balance', 'За балансом'], ['new', 'Нові спершу']];

function nextLabel(l) {
  if (!l) return null;
  const rd = relDay(l.starts_at);
  const day = ['сьогодні', 'завтра'].includes(rd) ? rd : fmtDateShort(l.starts_at);
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, ${fmtTime(l.starts_at)}`;
}

export default async function render({ view, query, alive }) {
  // Listeners must die with the page: #page is reused across routes, so bind to a fresh root.
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  setTitle('Учні');
  const admin = isSchool() && isAdmin();
  const f = { q: '', status: ['active', 'paused', 'archived', 'all'].includes(query.status) ? query.status : 'active', level: '', sort: 'name', teacher: '' };

  view.innerHTML = String(html`
    ${pageHeader({ title: 'Учні', meta: '', actions: html`<button class="btn btn--primary" type="button" data-action="add">${raw(icon('plus'))}Додати учня</button>` })}
    <div data-body>${skeletonRows(6)}</div>`);
  const bodyEl = view.querySelector('[data-body]');
  const metaHost = view.querySelector('.page-header__titles');

  let data = null;
  const reload = () => load();
  on(view, '[data-action="add"]', () => openStudentForm({ onSaved: reload }));
  on(view, '[data-action="seed"]', async (e, el) => {
    setLoading(el, true);
    try { await seedDemo(); if (!alive()) return; toast('Приклад заповнено'); await load(); } catch (err) { toastError(err); setLoading(el, false); }
  });

  async function load() {
    bodyEl.innerHTML = String(skeletonRows(6));
    try {
      const teacherId = admin ? null : state.user.id;
      const from = new Date().toISOString();
      const to = fromZoned(addDays(todayKey(), 120), '00:00').toISOString();
      const [students, lessons, bmap] = await Promise.all([
        listStudents({ teacherId, includeArchived: true }),
        listLessons(from, to, { teacherId }),
        balances(),
      ]);
      if (!alive()) return;
      const next = new Map();
      lessons.filter((l) => l.status === 'scheduled').forEach((l) => { if (!next.has(l.student_id)) next.set(l.student_id, l); });
      data = { students, next, bmap };
      draw(true);
    } catch (err) {
      if (alive()) bodyEl.innerHTML = String(errorState(err.message));
    }
  }

  function filtered() {
    const q = f.q.trim().toLowerCase();
    let list = data.students.filter((s) =>
      (f.status === 'all' || s.status === f.status)
      && (!f.level || s.cefr_level === f.level)
      && (!f.teacher || s.teacher_id === f.teacher)
      && (!q || s.full_name.toLowerCase().includes(q) || (s.login || '').includes(q) || (s.contact || '').toLowerCase().includes(q)));
    const nextTime = (s) => (data.next.get(s.id) ? new Date(data.next.get(s.id).starts_at).getTime() : Infinity);
    const cmp = {
      name: (a, b) => a.full_name.localeCompare(b.full_name, 'uk'),
      next: (a, b) => nextTime(a) - nextTime(b) || a.full_name.localeCompare(b.full_name, 'uk'),
      balance: (a, b) => bal(data.bmap, a.id).balance - bal(data.bmap, b.id).balance,
      new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    }[f.sort];
    return list.sort(cmp);
  }

  function draw(full = false) {
    const all = data.students;
    // meta line
    const active = all.filter((s) => s.status === 'active').length;
    let meta = metaHost.querySelector('.page-header__meta');
    if (!meta) { meta = document.createElement('p'); meta.className = 'page-header__meta'; metaHost.appendChild(meta); }
    meta.textContent = all.length ? `${active} ${plural(active, 'активний учень', 'активні учні', 'активних учнів')} · усього ${all.length}` : '';

    if (!all.length) {
      bodyEl.innerHTML = String(emptyState({
        icon: 'users', title: 'Тут з’являться ваші учні',
        text: 'Додайте учня — він отримає логін і код, щоб бачити розклад і домашні. Або заповніть простір прикладом, щоб усе роздивитися.',
        action: html`<div class="cluster" style="justify-content:center"><button class="btn btn--primary" type="button" data-action="add">${raw(icon('plus'))}Додати учня</button><button class="btn btn--secondary" type="button" data-action="seed"><span>Заповнити прикладом</span></button></div>`,
      }));
      return;
    }
    if (full) {
      const levels = LEVELS.filter((l) => all.some((s) => s.cefr_level === l));
      const teachers = admin ? [...new Map(all.filter((s) => s.teacher).map((s) => [s.teacher_id, s.teacher.full_name || 'Без імені'])).entries()] : [];
      const count = (st) => (st === 'all' ? all.length : all.filter((s) => s.status === st).length);
      bodyEl.innerHTML = String(html`<div class="stack">
        <div class="toolbar">
          <div class="input-wrap toolbar__search"><label class="sr-only" for="st-q">Пошук учня</label>${raw(icon('search'))}<input class="input" id="st-q" type="search" placeholder="Пошук за ім’ям або логіном" value="${f.q}" autocomplete="off"></div>
          ${admin && teachers.length > 1 ? html`<div class="toolbar__select"><label class="sr-only" for="st-teacher">Вчитель</label><select class="select" id="st-teacher"><option value="">Усі вчителі</option>${raw(teachers.map(([id, n]) => `<option value="${esc(id)}"${f.teacher === id ? ' selected' : ''}>${esc(n)}${id === state.user.id ? ' (я)' : ''}</option>`).join(''))}</select></div>` : ''}
          <div class="toolbar__select"><label class="sr-only" for="st-sort">Сортування</label><select class="select" id="st-sort">${raw(SORTS.map(([v, l]) => `<option value="${v}"${f.sort === v ? ' selected' : ''}>${l}</option>`).join(''))}</select></div>
        </div>
        <div class="chips chips--scroll" role="group" aria-label="Статус">
          ${raw(STATUS.map(([v, l]) => `<button class="chip" type="button" data-status="${v}" aria-pressed="${f.status === v}">${l} <span class="chip__count">${count(v)}</span></button>`).join(''))}
          ${levels.length > 1 ? raw(`<span class="chips__sep" aria-hidden="true"></span>${levels.map((l) => `<button class="chip" type="button" data-level="${l}" aria-pressed="${f.level === l}" aria-label="Рівень ${l}">${l}</button>`).join('')}`) : ''}
        </div>
        <div data-results></div>
      </div>`);
      bindToolbar();
    }
    drawResults();
  }

  function drawResults() {
    const host = bodyEl.querySelector('[data-results]');
    if (!host) return;
    const list = filtered();
    if (!list.length) {
      host.innerHTML = String(emptyState({ icon: 'search', title: 'Нікого не знайдено', text: 'Спробуйте інший запит або скиньте фільтри.', action: html`<button class="btn btn--secondary" type="button" data-action="reset">Скинути фільтри</button>` }));
      return;
    }
    const showT = admin;
    const nameCell = (s) => html`<span class="row"><span>${avatar(s.full_name)}</span><span class="stack stack--xs" style="min-width:0"><a class="st-name" href="#/t/students/${s.id}">${s.full_name}</a><span class="text-xs muted cluster" style="--gap:6px">${s.login}${s.user_id ? '' : html`<span class="badge badge--outline">не активовано</span>`}${s.status !== 'active' ? html`<span class="badge">${s.status === 'paused' ? 'пауза' : 'архів'}</span>` : ''}</span></span></span>`;
    const nextCell = (s) => {
      const l = data.next.get(s.id);
      return l ? html`<span class="nowrap">${nextLabel(l)}</span>` : html`<span class="muted">без уроку</span>`;
    };
    const table = html`<div class="table-wrap table-wrap--stack hide-mobile">
      <table class="table table--stack st-table">
        <thead><tr><th>Учень</th><th>Рівень</th><th>Наступний урок</th><th>Баланс</th>${showT ? html`<th>Вчитель</th>` : ''}<th class="table__actions"><span class="sr-only">Дії</span></th></tr></thead>
        <tbody>${list.map((s) => html`<tr data-href="#/t/students/${s.id}">
          <td class="table__primary">${nameCell(s)}</td>
          <td data-label="Рівень">${levelBadge(s.cefr_level)}</td>
          <td data-label="Наступний урок">${nextCell(s)}</td>
          <td data-label="Баланс">${balanceChip(bal(data.bmap, s.id))}</td>
          ${showT ? html`<td data-label="Вчитель">${s.teacher?.full_name || '—'}</td>` : ''}
          <td class="table__actions"><a class="btn btn--ghost btn--icon btn--sm" href="#/t/students/${s.id}" aria-label="Відкрити профіль: ${s.full_name}" tabindex="-1">${raw(icon('chevronRight'))}</a></td>
        </tr>`)}</tbody>
      </table>
    </div>`;
    const mobile = html`<ul class="list list--card show-mobile">${list.map((s) => {
      const l = data.next.get(s.id);
      return html`<li><a class="list-row" href="#/t/students/${s.id}">
        ${avatar(s.full_name)}
        <span class="list-row__body">
          <span class="list-row__title">${s.full_name}</span>
          <span class="list-row__meta">${levelBadge(s.cefr_level)}<span>${raw(icon('clock'))}${l ? nextLabel(l) : 'без уроку'}</span></span>
          <span class="list-row__meta">${balanceChip(bal(data.bmap, s.id))}${s.user_id ? '' : html`<span class="badge badge--outline">не активовано</span>`}${s.status !== 'active' ? html`<span class="badge">${s.status === 'paused' ? 'пауза' : 'архів'}</span>` : ''}${showT && s.teacher?.full_name ? html`<span>${raw(icon('user'))}${s.teacher.full_name}</span>` : ''}</span>
        </span>
        <span class="list-row__trail">${raw(icon('chevronRight'))}</span>
      </a></li>`;
    })}</ul>`;
    host.innerHTML = String(html`${table}${mobile}<p class="text-sm muted st-count" role="status">Показано ${list.length} з ${data.students.length}</p>`);
  }

  function bindToolbar() {
    const q = bodyEl.querySelector('#st-q');
    q.addEventListener('input', debounce(() => { f.q = q.value; drawResults(); }, 150));
    bodyEl.querySelector('#st-sort').addEventListener('change', (e) => { f.sort = e.target.value; drawResults(); });
    bodyEl.querySelector('#st-teacher')?.addEventListener('change', (e) => { f.teacher = e.target.value; drawResults(); });
  }

  on(view, '[data-status]', (e, el) => {
    f.status = el.dataset.status;
    view.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    drawResults();
  });
  on(view, '[data-level]', (e, el) => {
    f.level = f.level === el.dataset.level ? '' : el.dataset.level;
    view.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === f.level)));
    drawResults();
  });
  on(view, '[data-action="reset"]', () => { Object.assign(f, { q: '', status: 'all', level: '', teacher: '' }); draw(true); });
  on(view, 'tr[data-href]', (e, el) => {
    if (e.target.closest('a, button')) return;
    if (window.getSelection()?.toString()) return;
    navigate(el.dataset.href.slice(1));
  });

  await load();
}
