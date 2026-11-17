// #/t/school — school overview for owner/admin: stats, teacher invite, teachers, all students.
import { state } from '../state.js';
import { html, raw, plural, weekStart, todayKey, addDays, fromZoned } from '../utils.js';
import { icon, pageHeader, avatar, levelBadge, emptyState, errorState, toast, toastError, confirmDialog, setLoading, copyText } from '../ui.js';
import { setTitle } from '../shell.js';
import * as api from '../api.js';

const I = (n, c) => raw(icon(n, c));
const SITE = () => location.origin + location.pathname;
const ROLE = { owner: 'Власник', admin: 'Адміністратор', teacher: 'Вчитель' };

function skeleton() {
  const tile = '<div class="stat"><span class="skeleton skeleton--text" style="width:60%"></span><span class="skeleton skeleton--title" style="width:40%"></span></div>';
  return raw(`<div class="grid-4">${tile.repeat(4)}</div>
    <div class="split" style="margin-top:var(--s-5)"><span class="skeleton skeleton--block" style="height:280px"></span><span class="skeleton skeleton--block" style="height:280px"></span></div>
    <span class="sr-only" role="status">Завантаження…</span>`);
}

export default async function render({ view, alive, query }) {
  setTitle('Школа');
  view.innerHTML = String(html`${pageHeader({ title: state.space?.name || 'Школа', meta: 'Огляд школи: вчителі, учні, оплати' })}<div id="sc-body">${skeleton()}</div>`);
  const body = view.querySelector('#sc-body');

  const ws = weekStart(todayKey());
  let members, students, lessons, bal;
  try {
    [members, students, lessons, bal] = await Promise.all([
      api.listMembers(),
      api.listStudents(),
      api.listLessons(fromZoned(ws).toISOString(), fromZoned(addDays(ws, 7)).toISOString()),
      api.balances(),
    ]);
  } catch (err) {
    if (!alive()) return;
    body.innerHTML = String(errorState(err.message));
    return;
  }
  if (!alive()) return;

  const ui = { teacher: query.teacher || 'all', q: '' };
  const isOwner = state.role === 'owner';
  const me = state.user?.id;

  const nameOf = (m) => m.profile?.full_name || 'Без імені';
  const teacherName = (id) => nameOf(members.find((m) => m.user_id === id) || {}) || '—';
  const studentsOf = (id) => students.filter((s) => s.teacher_id === id);
  const active = students.filter((s) => s.status === 'active');
  const weekLessons = lessons.filter((l) => l.status !== 'cancelled');
  const debtors = students.filter((s) => (bal.get(s.id)?.balance ?? 0) < 0);

  function statsHtml() {
    return html`<div class="grid-4 pub-school-stats">
      <div class="stat"><span class="stat__label">${I('users')}Вчителі</span><span class="stat__value">${members.length}</span></div>
      <div class="stat"><span class="stat__label">${I('user')}Активні учні</span><span class="stat__value">${active.length}</span>${students.length > active.length ? html`<span class="text-xs muted">ще ${students.length - active.length} на паузі</span>` : ''}</div>
      <div class="stat"><span class="stat__label">${I('calendar')}Уроків цього тижня</span><span class="stat__value">${weekLessons.length}</span><span class="text-xs muted">${weekLessons.filter((l) => l.status === 'done').length} проведено</span></div>
      <div class="stat${debtors.length ? ' stat--attention' : ''}"><span class="stat__label">${I('wallet')}Борги</span><span class="stat__value">${debtors.length}</span><span class="text-xs ${debtors.length ? '' : 'muted'}">${debtors.length ? `${plural(debtors.length, 'учень', 'учні', 'учнів')} з мінусом` : 'усі оплатили'}</span></div>
    </div>`;
  }

  function inviteHtml() {
    const code = state.space?.teacher_invite_code || '';
    const link = `${SITE()}#/join?code=${code}`;
    return html`<section class="card card--focus pub-invite" aria-labelledby="sc-inv">
      <div class="stack stack--xs">
        <h2 class="h3" id="sc-inv">Запросити вчителя</h2>
        <p class="text-sm muted">Надішліть посилання колезі. Після реєстрації вчитель зʼявиться у списку нижче.</p>
      </div>
      <div class="pub-invite__code">
        <span class="text-xs muted">Код школи</span>
        <span class="pub-invite__value" id="sc-code">${code || '—'}</span>
      </div>
      <div class="pub-invite__link"><span class="truncate" id="sc-link">${link}</span></div>
      <div class="stack stack--sm">
        <button class="btn btn--primary btn--block" type="button" data-action="copy-link">${I('copy')}<span>Копіювати посилання</span></button>
        <div class="pub-invite__more">
          <button class="btn btn--ghost btn--sm" type="button" data-action="share">${I('share', 'icon--sm')}<span>Поділитися</span></button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="regen">${I('refresh', 'icon--sm')}<span>Новий код</span></button>
        </div>
      </div>
    </section>`;
  }

  function teachersHtml() {
    const rows = members.map((m) => {
      const n = studentsOf(m.user_id).length;
      const self = m.user_id === me;
      const canManage = isOwner && m.role !== 'owner' && !self;
      return html`<tr>
        <td class="table__primary"><span class="row">${avatar(nameOf(m), 'sm')}<span class="stack stack--xs"><span class="fw-600">${nameOf(m)}${self ? html` <span class="text-xs muted">(ви)</span>` : ''}</span></span></span></td>
        <td data-label="Роль"><span class="badge${m.role === 'owner' ? ' badge--hl' : m.role === 'admin' ? ' badge--info' : ' badge--outline'}">${ROLE[m.role] || m.role}</span></td>
        <td data-label="Учні" class="num">${n ? html`<button class="link-btn" type="button" data-action="filter" data-id="${m.user_id}">${n} ${plural(n, 'учень', 'учні', 'учнів')}</button>` : html`<span class="muted">немає</span>`}</td>
        <td class="table__actions">${canManage ? html`<div class="btn-group pub-member-actions">
          <button class="btn btn--ghost btn--sm" type="button" data-action="role" data-id="${m.user_id}" data-role="${m.role === 'admin' ? 'teacher' : 'admin'}">${m.role === 'admin' ? 'Зробити вчителем' : 'Зробити адміном'}</button>
          <button class="btn btn--danger-ghost btn--icon btn--sm" type="button" data-action="remove" data-id="${m.user_id}" aria-label="Видалити ${nameOf(m)} зі школи">${I('trash', 'icon--sm')}</button>
        </div>` : ''}</td>
      </tr>`;
    });
    return html`<section class="section" aria-labelledby="sc-teachers">
      <div class="section__head"><h2 class="h2" id="sc-teachers">Вчителі <span class="muted num">${members.length}</span></h2></div>
      ${members.length <= 1 ? html`<div class="alert">${I('info')}<div><p class="alert__title">Поки що ви тут самі</p>Скопіюйте посилання-запрошення вище й надішліть колегам.</div></div>` : ''}
      <div class="table-wrap table-wrap--stack"><table class="table table--stack">
        <thead><tr><th>Вчитель</th><th>Роль</th><th class="num">Учні</th><th class="table__actions"><span class="sr-only">Дії</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${!isOwner ? html`<p class="text-xs muted">Змінювати ролі й видаляти вчителів може лише власник школи.</p>` : ''}
    </section>`;
  }

  function balanceBadge(s) {
    const b = bal.get(s.id);
    if (!b || (!b.paid && !b.used)) return html`<span class="badge badge--outline">Без оплат</span>`;
    if (b.balance < 0) return html`<span class="badge badge--danger">Борг ${-b.balance} ${plural(-b.balance, 'урок', 'уроки', 'уроків')}</span>`;
    if (b.balance === 0) return html`<span class="badge badge--warning">0 уроків</span>`;
    return html`<span class="badge badge--success">+${b.balance} ${plural(b.balance, 'урок', 'уроки', 'уроків')}</span>`;
  }

  function studentsListHtml() {
    const q = ui.q.trim().toLowerCase();
    const list = students.filter((s) => (ui.teacher === 'all' || s.teacher_id === ui.teacher || (ui.teacher === 'debt' && (bal.get(s.id)?.balance ?? 0) < 0)) && (!q || s.full_name.toLowerCase().includes(q)));
    if (!students.length) {
      return emptyState({ icon: 'users', title: 'У школі ще немає учнів', text: 'Вчителі додають учнів у розділі «Учні». Можна також заповнити простір прикладом у налаштуваннях.', action: html`<a class="btn btn--primary" href="#/t/students">${I('plus')}Додати учня</a>` });
    }
    if (!list.length) return emptyState({ icon: 'search', title: 'Нікого не знайдено', text: 'Змініть фільтр або пошук.', plain: true });
    // group by teacher when showing all
    const groups = new Map();
    list.forEach((s) => { const k = ui.teacher === 'all' ? s.teacher_id : '_'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
    return html`${[...groups.entries()].map(([tid, arr]) => html`<div class="stack stack--sm">
      ${ui.teacher === 'all' ? html`<p class="pub-group-title">${avatar(s0name(arr[0]), 'xs')}${s0name(arr[0])}<span class="muted num">${arr.length}</span></p>` : ''}
      <ul class="list list--card">${arr.map((s) => html`<li><a class="list-row" href="#/t/students/${s.id}">
        ${avatar(s.full_name)}
        <span class="list-row__body">
          <span class="list-row__title">${s.full_name}${s.is_demo ? html` <span class="badge badge--outline">демо</span>` : ''}</span>
          <span class="list-row__meta">${levelBadge(s.cefr_level)}${ui.teacher === 'debt' ? html`<span>${s.teacher?.full_name || teacherName(s.teacher_id)}</span>` : ''}${s.status === 'paused' ? html`<span class="badge badge--warning">Пауза</span>` : ''}${!s.user_id ? html`<span class="badge badge--outline">Не активовано</span>` : ''}${balanceBadge(s)}</span>
        </span>
        <span class="list-row__trail">${I('chevronRight')}</span>
      </a></li>`)}</ul>
    </div>`)}`;
    function s0name(s) { return s.teacher?.full_name || teacherName(s.teacher_id); }
  }

  function chipsHtml() {
    const withStudents = members.filter((m) => studentsOf(m.user_id).length);
    return html`<div class="chips chips--scroll" role="group" aria-label="Фільтр за вчителем">
      <button class="chip" type="button" data-action="filter" data-id="all" aria-pressed="${ui.teacher === 'all'}">Усі <span class="chip__count">${students.length}</span></button>
      ${debtors.length ? html`<button class="chip" type="button" data-action="filter" data-id="debt" aria-pressed="${ui.teacher === 'debt'}">Борги <span class="chip__count">${debtors.length}</span></button>` : ''}
      ${withStudents.map((m) => html`<button class="chip" type="button" data-action="filter" data-id="${m.user_id}" aria-pressed="${ui.teacher === m.user_id}">${nameOf(m)} <span class="chip__count">${studentsOf(m.user_id).length}</span></button>`)}
    </div>`;
  }

  function draw() {
    body.innerHTML = String(html`
      ${statsHtml()}
      <div class="split pub-school-split">
        <div class="stack stack--xl">
          ${teachersHtml()}
          <section class="section" aria-labelledby="sc-students" id="sc-students-sec">
            <div class="section__head"><h2 class="h2" id="sc-students">Учні школи</h2><a class="link-btn" href="#/t/students">Усі учні${I('chevronRight')}</a></div>
            ${students.length ? html`<div class="stack stack--sm">
              <div class="input-wrap">${I('search')}<input class="input" type="search" id="sc-q" placeholder="Пошук учня" aria-label="Пошук учня" value="${ui.q}"></div>
              <div id="sc-chips">${chipsHtml()}</div>
            </div>` : ''}
            <div class="stack" id="sc-list">${studentsListHtml()}</div>
          </section>
        </div>
        <div class="stack stack--lg pub-school-side">${inviteHtml()}
          <div class="card card--quiet text-sm"><p class="fw-600">Як це працює</p><ol class="pub-ol">
            <li>Вчитель реєструється за посиланням і одразу бачить свій розклад.</li>
            <li>Кожен вчитель додає своїх учнів і бачить лише їх.</li>
            <li>Ви як адміністратор бачите всіх учнів, уроки та оплати школи.</li>
          </ol></div>
        </div>
      </div>`);
    view.querySelector('#sc-q')?.addEventListener('input', (e) => { ui.q = e.target.value; redrawList(); });
  }
  function redrawList() {
    const l = view.querySelector('#sc-list'); if (l) l.innerHTML = String(studentsListHtml());
    const c = view.querySelector('#sc-chips'); if (c) c.innerHTML = String(chipsHtml());
  }
  draw();

  view.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !view.contains(el)) return;
    const a = el.dataset.action;
    const link = `${SITE()}#/join?code=${state.space?.teacher_invite_code || ''}`;
    if (a === 'copy-link') copyText(link, 'Посилання скопійовано');
    if (a === 'share') {
      const text = `Приєднуйтесь до школи «${state.space?.name || ''}» у Кмітливо: ${link}`;
      if (navigator.share) { try { await navigator.share({ title: 'Запрошення до школи', text, url: link }); } catch { /* cancelled */ } } else copyText(text, 'Запрошення скопійовано');
    }
    if (a === 'regen') {
      const ok = await confirmDialog({ title: 'Створити новий код?', text: 'Старий код і посилання перестануть працювати. Вчителі, які вже приєдналися, залишаться в школі.', confirmLabel: 'Створити новий код' });
      if (!ok) return;
      setLoading(el, true);
      try {
        const res = await api.regenerateTeacherCode();
        const code = typeof res === 'string' ? res : (res?.teacher_invite_code || res?.code || (Array.isArray(res) ? res[0]?.teacher_invite_code : null));
        if (code) {
          state.space.teacher_invite_code = code;
          const m = state.memberships.find((x) => x.space_id === state.space.id);
          if (m?.space) m.space.teacher_invite_code = code;
        }
        if (!alive()) return;
        draw();
        toast('Новий код створено', { text: code ? `Код: ${code}` : '' });
      } catch (err) { toastError(err); if (el.isConnected) setLoading(el, false); }
    }
    if (a === 'filter') {
      ui.teacher = el.dataset.id;
      redrawList();
      if (!el.closest('#sc-chips')) view.querySelector('#sc-students-sec')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (a === 'role') {
      const m = members.find((x) => x.user_id === el.dataset.id); if (!m) return;
      const role = el.dataset.role;
      const ok = await confirmDialog({ title: role === 'admin' ? `Зробити ${nameOf(m)} адміністратором?` : `Зробити ${nameOf(m)} вчителем?`, text: role === 'admin' ? 'Адміністратор бачить усіх учнів, уроки й оплати школи та може запрошувати вчителів.' : 'Вчитель бачитиме лише своїх учнів і свої уроки.', confirmLabel: role === 'admin' ? 'Зробити адміном' : 'Зробити вчителем' });
      if (!ok) return;
      setLoading(el, true);
      try {
        await api.updateMemberRole(m.user_id, role);
        m.role = role; if (!alive()) return; draw();
        toast('Роль змінено');
      } catch (err) { toastError(err); if (el.isConnected) setLoading(el, false); }
    }
    if (a === 'remove') {
      const m = members.find((x) => x.user_id === el.dataset.id); if (!m) return;
      const n = studentsOf(m.user_id).length;
      const ok = await confirmDialog({ title: `Видалити ${nameOf(m)} зі школи?`, text: `Вчитель втратить доступ до школи.${n ? ` Його ${n} ${plural(n, 'учень залишиться', 'учні залишаться', 'учнів залишаться')} у школі — призначте їм іншого вчителя в картці учня.` : ''}`, confirmLabel: 'Видалити вчителя', danger: true });
      if (!ok) return;
      setLoading(el, true);
      try {
        await api.removeMember(m.user_id);
        members = members.filter((x) => x.user_id !== m.user_id);
        if (ui.teacher === m.user_id) ui.teacher = 'all';
        if (!alive()) return; draw();
        toast('Вчителя видалено зі школи');
      } catch (err) { toastError(err); if (el.isConnected) setLoading(el, false); }
    }
  });
}
