// Teacher home (#/t): what needs me today, at a glance.
import { state, isAdmin, isSchool } from '../state.js';
import { html, raw, fmtTime, fmtFullDate, fmtDateShort, relDay, dayKey, todayKey, addDays, fromZoned, zonedParts, plural, safeUrl, isOverdue, dueLabel } from '../utils.js';
import { icon, avatar, levelBadge, lessonStatus, emptyState, errorState, toast, toastError, setLoading, on } from '../ui.js';
import { listStudents, listLessons, listTargets, balances, seedDemo } from '../api.js';
import { setTitle, setCount } from '../shell.js';
import { openStudentForm } from '../components/student-form.js';
import { openPaymentForm, balanceChip, bal, lessonsWord } from '../components/payment-form.js';
import { openLessonForm } from '../components/lesson-form.js';
import { openLessonClose } from '../components/lesson-close.js';

const SCOPE_KEY = 'kmitlyvo.dashScope';

function greeting() {
  const h = zonedParts(new Date()).h;
  if (h >= 5 && h < 12) return 'Добрий ранок';
  if (h >= 12 && h < 18) return 'Добрий день';
  if (h >= 18 && h < 23) return 'Добрий вечір';
  return 'Доброї ночі';
}
/** Conservative Ukrainian vocative for a first name (falls back to the name as is). */
function vocative(name) {
  const n = String(name || '').trim();
  if (!/^[А-ЯҐЄІЇа-яґєії’'-]+$/.test(n)) return n;
  if (/ія$/.test(n)) return n.slice(0, -1) + 'є';
  if (/[^аеиіїоуюяє]а$/.test(n)) return n.slice(0, -1) + 'о';
  if (/ій$/.test(n)) return n.slice(0, -1) + 'ю';
  return n;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const endOf = (l) => new Date(l.starts_at).getTime() + (l.duration_min || 60) * 60000;

function untilLabel(l) {
  const now = Date.now();
  const start = new Date(l.starts_at).getTime();
  if (start <= now && endOf(l) > now) return 'Іде зараз';
  const mins = Math.round((start - now) / 60000);
  if (mins < 60) return `Через ${mins} ${plural(mins, 'хвилину', 'хвилини', 'хвилин')}`;
  if (dayKey(l.starts_at) === todayKey()) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return `Через ${h} год${m ? ` ${m} хв` : ''}`;
  }
  return cap(relDay(l.starts_at));
}

export default async function render({ view, alive }) {
  // Listeners must die with the page: #page is reused across routes, so bind to a fresh root.
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  setTitle('Головна');
  const admin = isSchool() && isAdmin();
  let scope = 'mine';
  try { if (admin && sessionStorage.getItem(SCOPE_KEY) === 'all') scope = 'all'; } catch { /* ignore */ }

  const first = (state.profile?.full_name || '').trim().split(/\s+/)[0];
  const now = new Date();

  view.innerHTML = String(html`
    <div class="page-header">
      <div class="page-header__titles">
        <h1 class="h1">${greeting()}${first ? html`, ${vocative(first)}` : ''}</h1>
        <p class="page-header__meta">${cap(fmtFullDate(now))}</p>
      </div>
      <div class="page-header__actions">
        <button class="btn btn--secondary" type="button" data-action="new-lesson">${raw(icon('plus'))}Урок</button>
        <a class="btn btn--primary" href="#/t/assignments/new">${raw(icon('plus'))}Завдання</a>
      </div>
    </div>
    ${admin ? html`<div class="dash-scope">
      <div class="segmented" role="radiogroup" aria-label="Чиї дані показувати">
        <label><input type="radio" name="scope" value="mine" ${scope === 'mine' ? 'checked' : ''}><span>Мої</span></label>
        <label><input type="radio" name="scope" value="all" ${scope === 'all' ? 'checked' : ''}><span>Уся школа</span></label>
      </div>
    </div>` : ''}
    <div data-body></div>`);
  const bodyEl = view.querySelector('[data-body]');

  const reload = () => load();

  on(view, '[data-action="new-lesson"]', () => openLessonForm({ onSaved: reload }));
  on(view, '[data-action="add-student"]', () => openStudentForm({ onSaved: reload }));
  on(view, '[data-action="plan"]', (e, el) => openLessonForm({ studentId: el.dataset.id, onSaved: reload }));
  on(view, '[data-action="pay"]', (e, el) => openPaymentForm({ studentId: el.dataset.id, onSaved: reload }));
  on(view, '[data-action="close-lesson"]', (e, el) => {
    const lesson = data?.lessons.find((l) => l.id === el.dataset.id);
    if (lesson) openLessonClose({ lesson, onSaved: reload });
  });
  on(view, '[data-action="scroll"]', (e, el) => document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  on(view, '[data-action="seed"]', async (e, el) => {
    setLoading(el, true);
    try { await seedDemo(); if (!alive()) return; toast('Приклад заповнено', { text: 'Демо-учні позначені як приклад — їх можна видалити в налаштуваннях.' }); await load(); } catch (err) { toastError(err); setLoading(el, false); }
  });
  view.addEventListener('change', (e) => {
    if (e.target.name !== 'scope') return;
    scope = e.target.value;
    try { sessionStorage.setItem(SCOPE_KEY, scope); } catch { /* ignore */ }
    load();
  });

  let data = null;
  let ticket = 0;

  async function load() {
    const my = ++ticket;
    bodyEl.innerHTML = String(skeleton());
    const teacherId = admin && scope === 'all' ? null : state.user.id;
    const today = todayKey();
    const from = fromZoned(today, '00:00').toISOString();
    const to = fromZoned(addDays(today, 60), '00:00').toISOString();
    try {
      const [students, lessons, submitted, open, bmap] = await Promise.all([
        listStudents({ teacherId }),
        listLessons(from, to, { teacherId }),
        listTargets({ status: 'submitted', teacherId }),
        listTargets({ status: ['assigned', 'returned'], teacherId }),
        balances(),
      ]);
      if (!alive() || my !== ticket) return;
      data = { students, lessons, submitted, overdue: open.filter(isOverdue), bmap };
      setCount('review', submitted.length);
      bodyEl.innerHTML = String(students.length ? dashboard(data, { admin, scope }) : onboarding({ admin, scope }));
    } catch (err) {
      console.error(err);
      if (alive() && my === ticket) bodyEl.innerHTML = String(errorState(err.message));
    }
  }
  await load();
}

// ---------------------------------------------------------------- views
function skeleton() {
  const tile = '<div class="stat" aria-hidden="true"><span class="skeleton skeleton--text" style="width:60%"></span><span class="skeleton skeleton--title" style="width:40%"></span></div>';
  return raw(`<div class="stack stack--lg">
    <div class="grid-4 dash-stats">${tile.repeat(4)}</div>
    <div class="split"><div class="stack stack--lg"><div class="skeleton skeleton--block" style="height:180px;border-radius:var(--r-md)"></div>
    <ul class="list list--card" aria-hidden="true">${'<li class="list-row"><span class="skeleton skeleton--circle" style="width:40px;height:40px"></span><span class="list-row__body"><span class="skeleton skeleton--text" style="width:50%"></span><span class="skeleton skeleton--text" style="width:30%"></span></span></li>'.repeat(3)}</ul></div>
    <div class="skeleton skeleton--block" style="height:240px;border-radius:var(--r-md)"></div></div>
    <span class="sr-only" role="status">Завантаження…</span></div>`);
}

function onboarding({ admin, scope }) {
  const steps = [
    ['users', 'Додайте учня', 'Імʼя, рівень і ціна уроку — учень отримає логін і код активації.'],
    ['calendar', 'Заплануйте урок', 'Разовий або щотижневий — з посиланням на онлайн-зустріч.'],
    ['clipboard', 'Задайте домашнє', 'Текст, файл, посилання або квіз з автоперевіркою.'],
  ];
  return html`<section class="card card--raised onboard" aria-labelledby="onb-t">
    <div class="onboard__intro">
      <span class="badge badge--hl">${raw(icon('sparkles', 'icon--sm'))}Перші кроки</span>
      <h2 class="h2" id="onb-t">${admin && scope === 'mine' ? 'У вас поки немає власних учнів' : 'Вітаємо в Кмітливо!'}</h2>
      <p class="muted">Три кроки — і розклад, домашні та оплати будуть в одному місці. Або заповніть простір прикладом, щоб подивитися, як усе працює.</p>
    </div>
    <ol class="onboard__steps">
      ${raw(steps.map(([ic, t, d], i) => `<li class="onboard__step"><span class="onboard__num" aria-hidden="true">${i + 1}</span><span class="onboard__icon">${icon(ic)}</span><span class="stack stack--xs"><span class="fw-600">${t}</span><span class="text-sm muted">${d}</span></span></li>`).join(''))}
    </ol>
    <div class="cluster">
      <button class="btn btn--primary btn--lg" type="button" data-action="add-student">${raw(icon('plus'))}Додати учня</button>
      <button class="btn btn--secondary btn--lg" type="button" data-action="seed">${raw(icon('sparkles'))}<span>Заповнити прикладом</span></button>
    </div>
    ${admin && scope === 'mine' ? html`<p class="text-sm muted">Учні інших вчителів — у режимі «Уся школа».</p>` : ''}
  </section>`;
}

function dashboard(d, { admin, scope }) {
  const now = Date.now();
  const today = todayKey();
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const scheduled = d.lessons.filter((l) => l.status === 'scheduled');
  const todays = d.lessons.filter((l) => dayKey(l.starts_at) === today && l.status !== 'cancelled');
  const next = scheduled.find((l) => endOf(l) > now);
  const left = todays.filter((l) => l.status === 'scheduled' && endOf(l) > now).length;

  const payAttention = d.students
    .filter((s) => s.status === 'active')
    .map((s) => ({ s, b: bal(d.bmap, s.id) }))
    .filter(({ b }) => b.balance <= 1)
    .sort((a, b) => a.b.balance - b.b.balance);
  const debts = payAttention.filter(({ b }) => b.balance < 0).length;

  const futureIds = new Set(scheduled.filter((l) => new Date(l.starts_at).getTime() > now).map((l) => l.student_id));
  const noLesson = d.students.filter((s) => s.status === 'active' && !futureIds.has(s.id));
  const showTeacher = admin && scope === 'all';

  const stats = html`<div class="grid-4 dash-stats">
    <a class="stat stat-link" href="#/t/calendar">
      <span class="stat__label">${raw(icon('calendar'))}Уроків сьогодні</span>
      <span class="stat__value">${todays.length}</span>
      <span class="stat__hint">${todays.length ? (left ? `ще ${left} попереду` : 'усі позаду') : 'вільний день'}</span>
    </a>
    <a class="stat stat-link${d.submitted.length ? ' stat--attention' : ''}" href="#/t/review">
      <span class="stat__label">${raw(icon('inbox'))}На перевірку</span>
      <span class="stat__value">${d.submitted.length}</span>
      <span class="stat__hint">${d.submitted.length ? 'чекають на оцінку' : 'усе перевірено'}</span>
    </a>
    <button class="stat stat-link" type="button" data-action="scroll" data-target="dash-overdue">
      <span class="stat__label">${raw(icon('clock'))}Прострочені</span>
      <span class="stat__value">${d.overdue.length}</span>
      <span class="stat__hint">${d.overdue.length ? 'домашніх не здано' : 'усі вчасно'}</span>
    </button>
    <a class="stat stat-link" href="#/t/payments">
      <span class="stat__label">${raw(icon('wallet'))}Борги і залишок ≤1</span>
      <span class="stat__value">${payAttention.length}</span>
      <span class="stat__hint">${debts ? `${debts} з боргом` : payAttention.length ? 'час нагадати' : 'усе оплачено'}</span>
    </a>
  </div>`;

  return html`<div class="stack stack--xl">
    ${stats}
    <div class="split">
      <div class="stack stack--xl">
        ${nextCard(next, byId, showTeacher)}
        ${todaySection(todays, byId, showTeacher)}
        ${reviewSection(d.submitted)}
        ${overdueSection(d.overdue)}
      </div>
      <div class="stack stack--xl">
        ${paySection(payAttention)}
        ${noLessonSection(noLesson)}
      </div>
    </div>
  </div>`;
}

function nextCard(l, byId, showTeacher) {
  if (!l) {
    return html`<section class="card card--focus next-card" aria-labelledby="next-t">
      <p class="next-card__eyebrow">Наступний урок</p>
      <h2 class="h3" id="next-t">Найближчим часом уроків немає</h2>
      <p class="muted">Заплануйте урок — він з’явиться тут з кнопкою «Приєднатися».</p>
      <div class="cluster"><button class="btn btn--primary" type="button" data-action="new-lesson">${raw(icon('plus'))}Запланувати урок</button></div>
    </section>`;
  }
  const st = byId.get(l.student_id) || l.student || {};
  const name = st.full_name || l.student?.full_name || 'Учень';
  const url = safeUrl(l.meeting_url || st.meeting_url || l.student?.meeting_url || '');
  const topic = l.topic || st.next_topic || '';
  const live = untilLabel(l) === 'Іде зараз';
  return html`<section class="card card--focus next-card" aria-labelledby="next-t">
    <div class="next-card__top">
      <p class="next-card__eyebrow">${live ? html`<span class="next-card__live" aria-hidden="true"></span>` : ''}Наступний урок · ${untilLabel(l)}</p>
      <span class="next-card__time num">${fmtTime(l.starts_at)}<small>${dayKey(l.starts_at) === todayKey() ? 'сьогодні' : fmtDateShort(l.starts_at)} · ${l.duration_min || 60} хв</small></span>
    </div>
    <div class="row next-card__who">
      ${avatar(name, 'lg')}
      <div class="grow stack stack--xs" style="min-width:0">
        <h2 class="h3 truncate" id="next-t">${name}</h2>
        <div class="cluster next-card__meta">${levelBadge(st.cefr_level || l.student?.cefr_level)}${topic ? html`<span>${raw(icon('book', 'icon--sm'))}${topic}</span>` : html`<span class="muted">Тему ще не вказано</span>`}${showTeacher && st.teacher?.full_name ? html`<span class="muted">${raw(icon('user', 'icon--sm'))}${st.teacher.full_name}</span>` : ''}</div>
      </div>
    </div>
    <div class="cluster">
      ${url ? html`<a class="btn btn--primary" href="${url}" target="_blank" rel="noopener">${raw(icon('video'))}Приєднатися</a>
        <a class="btn btn--ghost" href="#/t/lessons/${l.id}">Відкрити урок${raw(icon('chevronRight'))}</a>`
      : html`<a class="btn btn--primary" href="#/t/lessons/${l.id}">Відкрити урок${raw(icon('chevronRight'))}</a>`}
    </div>
  </section>`;
}

function section(id, title, link, content, count = null) {
  return html`<section class="section" aria-labelledby="${id}">
    <div class="section__head"><h2 class="h3" id="${id}">${title}${count ? html` <span class="badge badge--outline">${count}</span>` : ''}</h2>${link || ''}</div>
    ${content}
  </section>`;
}

function todaySection(todays, byId, showTeacher) {
  const now = Date.now();
  if (!todays.length) {
    return section('dash-today', 'Сьогодні', html`<a class="link-btn" href="#/t/calendar">Розклад${raw(icon('chevronRight'))}</a>`,
      emptyState({ icon: 'sun', title: 'Сьогодні уроків немає', text: 'Гарний час підготувати матеріали або перевірити домашні.', plain: true, action: html`<button class="btn btn--secondary btn--sm" type="button" data-action="new-lesson">${raw(icon('plus'))}Запланувати урок</button>` }));
  }
  const rows = todays.map((l) => {
    const st = byId.get(l.student_id) || l.student || {};
    const start = new Date(l.starts_at).getTime();
    const live = l.status === 'scheduled' && start <= now && endOf(l) > now;
    const past = l.status === 'scheduled' && endOf(l) <= now;
    const canClose = l.status === 'scheduled' && start <= now;
    const badge = live ? html`<span class="badge badge--hl">${raw(icon('dot', 'icon--sm'))}Іде зараз</span>`
      : past ? html`<span class="badge badge--warning">Не завершено</span>` : lessonStatus(l.status);
    return html`<li class="action-row${live ? ' action-row--now' : ''}">
      <a class="list-row list-row--time grow" href="#/t/lessons/${l.id}">
        <span class="list-row__lead">${fmtTime(l.starts_at)}<small>${l.duration_min || 60} хв</small></span>
        <span class="list-row__body">
          <span class="list-row__title">${st.full_name || 'Учень'}</span>
          <span class="list-row__meta">${levelBadge(st.cefr_level)}${l.topic || st.next_topic ? html`<span class="truncate">${l.topic || st.next_topic}</span>` : ''}${showTeacher && st.teacher?.full_name ? html`<span>${st.teacher.full_name}</span>` : ''}${badge}</span>
        </span>
      </a>
      ${canClose ? html`<div class="action-row__act"><button class="btn btn--soft btn--sm" type="button" data-action="close-lesson" data-id="${l.id}" aria-label="Завершити урок з ${st.full_name || 'учнем'}">${raw(icon('check'))}Завершити</button></div>` : ''}
    </li>`;
  });
  return section('dash-today', 'Сьогодні', html`<a class="link-btn" href="#/t/calendar">Розклад${raw(icon('chevronRight'))}</a>`,
    html`<ul class="list list--card">${rows}</ul>`);
}

function reviewSection(subs) {
  const link = subs.length ? html`<a class="link-btn" href="#/t/review">Перевірити всі${raw(icon('chevronRight'))}</a>` : '';
  if (!subs.length) {
    return section('dash-review', 'Чекає на перевірку', link,
      emptyState({ icon: 'checkCircle', title: 'Усе перевірено', text: 'Нові здані роботи з’являться тут.', plain: true }));
  }
  const rows = subs.slice(0, 5).map((t) => html`<li><a class="list-row" href="#/t/review/${t.id}">
    ${avatar(t.student?.full_name || '?')}
    <span class="list-row__body">
      <span class="list-row__title">${t.assignment?.title || 'Завдання'}</span>
      <span class="list-row__meta"><span>${t.student?.full_name || ''}</span>${levelBadge(t.student?.cefr_level)}<span class="status status--submitted">Здано</span></span>
    </span>
    <span class="list-row__trail"><span class="hide-mobile text-sm fw-600 c-primary">Перевірити</span>${raw(icon('chevronRight'))}</span>
  </a></li>`);
  return section('dash-review', 'Чекає на перевірку', link, html`<ul class="list list--card">${rows}</ul>`, subs.length);
}

function overdueSection(list) {
  if (!list.length) {
    return section('dash-overdue', 'Прострочені домашні', '',
      emptyState({ icon: 'trophy', title: 'Прострочених немає', text: 'Усі учні встигають з домашніми.', plain: true }));
  }
  const sorted = [...list].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const rows = sorted.slice(0, 5).map((t) => html`<li><a class="list-row" href="#/t/students/${t.student_id}?tab=tasks">
    ${avatar(t.student?.full_name || '?')}
    <span class="list-row__body">
      <span class="list-row__title">${t.assignment?.title || 'Завдання'}</span>
      <span class="list-row__meta"><span>${t.student?.full_name || ''}</span><span class="status status--overdue">Прострочено</span><span>${raw(icon('clock'))}${dueLabel(t.due_at)}</span></span>
    </span>
    <span class="list-row__trail">${raw(icon('chevronRight'))}</span>
  </a></li>`);
  const more = list.length > 5 ? html`<p class="text-sm muted">І ще ${list.length - 5} — дивіться в профілях учнів.</p>` : '';
  return section('dash-overdue', 'Прострочені домашні', '', html`<ul class="list list--card">${rows}</ul>${more}`, list.length);
}

function paySection(items) {
  const link = html`<a class="link-btn" href="#/t/payments">Усі оплати${raw(icon('chevronRight'))}</a>`;
  if (!items.length) {
    return section('dash-pay', 'Оплати', link,
      emptyState({ icon: 'wallet', title: 'Боргів немає', text: 'У всіх активних учнів оплачено щонайменше 2 уроки.', plain: true }));
  }
  const rows = items.slice(0, 6).map(({ s, b }) => html`<li class="action-row">
    <a class="list-row grow" href="#/t/students/${s.id}?tab=payments">
      ${avatar(s.full_name, 'sm')}
      <span class="list-row__body"><span class="list-row__title">${s.full_name}</span><span class="list-row__meta">${balanceChip(b)}</span></span>
    </a>
    <div class="action-row__act"><button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="pay" data-id="${s.id}" aria-label="Додати оплату: ${s.full_name}" title="Додати оплату">${raw(icon('plus'))}</button></div>
  </li>`);
  const more = items.length > 6 ? html`<a class="link-btn" href="#/t/payments">Ще ${items.length - 6} ${plural(items.length - 6, 'учень', 'учні', 'учнів')}${raw(icon('chevronRight'))}</a>` : '';
  return section('dash-pay', 'Оплати', link, html`<ul class="list list--card">${rows}</ul>${more}`, items.length);
}

function noLessonSection(list) {
  if (!list.length) return '';
  const rows = list.slice(0, 6).map((s) => html`<li class="action-row">
    <a class="list-row grow" href="#/t/students/${s.id}">
      ${avatar(s.full_name, 'sm')}
      <span class="list-row__body"><span class="list-row__title">${s.full_name}</span><span class="list-row__meta">${levelBadge(s.cefr_level)}<span>без уроку</span></span></span>
    </a>
    <div class="action-row__act"><button class="btn btn--soft btn--sm" type="button" data-action="plan" data-id="${s.id}" aria-label="Запланувати урок: ${s.full_name}">Запланувати</button></div>
  </li>`);
  const more = list.length > 6 ? html`<a class="link-btn" href="#/t/students">Усі учні${raw(icon('chevronRight'))}</a>` : '';
  return section('dash-nolesson', 'Учні без наступного уроку', '', html`<p class="text-sm muted">Активні учні, яким ще нічого не заплановано.</p><ul class="list list--card">${rows}</ul>${more}`, list.length);
}
