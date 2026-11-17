// Розклад: desktop week/day grid, mobile day strip + list. State lives in the hash query (date, view, student, teacher).
import { state, isAdmin, isSchool } from '../state.js';
import { listLessons, listStudents, listMembers, seedDemo } from '../api.js';
import { setTitle } from '../shell.js';
import { html, raw, esc, addDays, fromZoned, dayKey, weekStart, todayKey, zonedParts, fmtTime, fmtDate, fmtFullDate, fmtWeekday, plural, initials } from '../utils.js';
import { icon, pageHeader, emptyState, errorState, levelBadge, lessonStatus, toast, toastError, setLoading, on } from '../ui.js';
import { openLessonForm } from '../components/lesson-form.js';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const DEFAULT_FROM = 8;
const DEFAULT_TO = 21;
const mq = () => matchMedia('(max-width: 820px)');

const isKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
const noon = (k) => fromZoned(k, '12:00');
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtNum = (n) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
/** "Марія Коваль" → "Марія К." */
export function shortName(full = '') {
  const p = full.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[1][0]}.` : (p[0] || 'Учень');
}
const endOf = (l) => Date.parse(l.starts_at) + (l.duration_min || 60) * 60000;
/** Wall-clock hour (decimal) of a timestamp in Warsaw time */
const hourOf = (t) => { const p = zonedParts(t); return p.h + p.min / 60; };

function rangeLabel(ws) {
  const we = addDays(ws, 6);
  const [y1, m1, d1] = ws.split('-').map(Number);
  const [y2, m2, d2] = we.split('-').map(Number);
  const thisYear = Number(todayKey().slice(0, 4));
  if (y1 !== y2) return `${d1} ${MONTHS_GEN[m1 - 1]} ${y1} – ${d2} ${MONTHS_GEN[m2 - 1]} ${y2}`;
  const yr = y1 !== thisYear ? ` ${y1}` : '';
  if (m1 !== m2) return `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]}${yr}`;
  return `${d1}–${d2} ${MONTHS_GEN[m1 - 1]}${yr}`;
}

/** Assign side-by-side lanes to overlapping events of one day. Mutates items: {lane, lanes}. */
function layoutLanes(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = []; let clusterEnd = -Infinity;
  const flush = () => {
    const lanesEnd = [];
    cluster.forEach((it) => {
      let i = lanesEnd.findIndex((end) => end <= it.s);
      if (i === -1) { i = lanesEnd.length; lanesEnd.push(0); }
      lanesEnd[i] = it.e; it.lane = i;
    });
    cluster.forEach((it) => { it.lanes = lanesEnd.length; });
    cluster = [];
  };
  items.forEach((it) => {
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -Infinity; }
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e);
  });
  flush();
  return items;
}

export default async function render({ view, query, alive }) {
  setTitle('Розклад');
  const me = state.user.id;
  const teacherFilterOn = isSchool() && isAdmin();
  const st = {
    date: isKey(query.date) ? query.date : todayKey(),
    view: query.view === 'day' ? 'day' : 'week',
    student: query.student || '',
    teacher: teacherFilterOn ? (query.teacher || '') : '',
  };
  let students = [];
  let members = [];
  let lessons = [];
  let loadedWeek = null;
  let loadTicket = 0;
  let nowTimer = null;
  let filtersReady = Promise.resolve();

  // NB: `view` (#page) persists between routes, so all listeners go on this inner root (destroyed on navigation).
  view.innerHTML = '<div class="cal-root"></div>';
  const root = view.firstElementChild;
  root.innerHTML = String(html`
    ${pageHeader({ title: 'Розклад', meta: raw('<span class="cal-meta" aria-live="polite"><span class="skeleton skeleton--text" style="width:180px;display:inline-block"></span></span>'), actions: html`<button class="btn btn--primary" type="button" data-action="new">${raw(icon('plus'))}Новий урок</button>` })}
    <div class="cal-toolbar">
      <div class="cal-toolbar__nav">
        <div class="btn-group cal-arrows">
          <button class="btn btn--secondary btn--icon btn--sm" type="button" data-action="prev" aria-label="Попередній тиждень">${raw(icon('chevronLeft'))}</button>
          <button class="btn btn--secondary btn--icon btn--sm" type="button" data-action="next" aria-label="Наступний тиждень">${raw(icon('chevronRight'))}</button>
        </div>
        <button class="btn btn--ghost btn--sm" type="button" data-action="today">Сьогодні</button>
        <h2 class="cal-toolbar__range" aria-live="polite"></h2>
      </div>
      <div class="cal-toolbar__tools">
        <div class="cal-filters">
          ${teacherFilterOn ? html`<label class="sr-only" for="cal-teacher">Вчитель</label><select class="select cal-filter" id="cal-teacher" data-filter="teacher"><option value="">Усі вчителі</option><option value="me">Мої уроки</option></select>` : ''}
          <label class="sr-only" for="cal-student">Учень</label>
          <select class="select cal-filter" id="cal-student" data-filter="student"><option value="">Усі учні</option></select>
        </div>
        <div class="segmented hide-mobile cal-viewswitch" role="radiogroup" aria-label="Вигляд">
          <label><input type="radio" name="cal-view" value="day"${st.view === 'day' ? ' checked' : ''}><span>День</span></label>
          <label><input type="radio" name="cal-view" value="week"${st.view === 'week' ? ' checked' : ''}><span>Тиждень</span></label>
        </div>
      </div>
    </div>
    <div class="cal-body"></div>`);

  const body = view.querySelector('.cal-body');
  const metaEl = view.querySelector('.cal-meta');

  // ---------- URL state ----------
  function writeUrl(push) {
    const q = new URLSearchParams({ date: st.date });
    if (st.view === 'day') q.set('view', 'day');
    if (st.student) q.set('student', st.student);
    if (st.teacher) q.set('teacher', st.teacher);
    const hash = `#/t/calendar?${q}`;
    if (location.hash === hash) return;
    history[push ? 'pushState' : 'replaceState'](null, '', hash);
  }
  function go(patch, { push = true } = {}) {
    Object.assign(st, patch);
    writeUrl(push);
    if (weekStart(st.date) !== loadedWeek) load(); else draw();
  }

  // ---------- toolbar ----------
  const dayStep = () => (st.view === 'day' && !mq().matches ? 1 : 7);
  function drawToolbar() {
    const ws = weekStart(st.date);
    const dayMode = st.view === 'day' && !mq().matches;
    view.querySelector('.cal-toolbar__range').textContent = dayMode ? capital(fmtFullDate(noon(st.date))) : rangeLabel(ws);
    view.querySelector('[data-action="prev"]').setAttribute('aria-label', dayMode ? 'Попередній день' : 'Попередній тиждень');
    view.querySelector('[data-action="next"]').setAttribute('aria-label', dayMode ? 'Наступний день' : 'Наступний тиждень');
    const today = todayKey();
    const onToday = dayMode ? st.date === today : weekStart(today) === ws && (mq().matches ? st.date === today : true);
    view.querySelector('[data-action="today"]').disabled = onToday;
  }
  function fillFilters() {
    const tSel = view.querySelector('#cal-teacher');
    if (tSel) {
      const others = members.filter((m) => m.user_id !== me && m.role !== 'student');
      tSel.innerHTML = '<option value="">Усі вчителі</option><option value="me">Мої уроки</option>'
        + others.map((m) => `<option value="${esc(m.user_id)}">${esc(m.profile?.full_name || 'Вчитель')}</option>`).join('');
      tSel.value = st.teacher;
      if (tSel.value !== st.teacher) { st.teacher = ''; tSel.value = ''; }
      tSel.closest('.cal-filters').classList.toggle('cal-filters--two', true);
    }
    const sSel = view.querySelector('#cal-student');
    const tid = teacherId();
    const list = students.filter((s) => (!tid || s.teacher_id === tid) && (s.status !== 'archived' || s.id === st.student));
    sSel.innerHTML = '<option value="">Усі учні</option>' + list.map((s) => `<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join('');
    sSel.value = st.student;
    if (sSel.value !== st.student) sSel.value = '';
    sSel.disabled = !students.length;
  }
  const teacherId = () => {
    if (teacherFilterOn) return st.teacher === 'me' ? me : (st.teacher || null);
    return isSchool() ? me : null; // school teachers only see their own lessons
  };

  // ---------- data ----------
  async function load() {
    const ticket = ++loadTicket;
    const ws = weekStart(st.date);
    drawToolbar();
    body.innerHTML = String(skeleton());
    try {
      const [rows] = await Promise.all([
        listLessons(fromZoned(ws, '00:00').toISOString(), fromZoned(addDays(ws, 7), '00:00').toISOString(), { studentId: st.student || null, teacherId: teacherId() }),
        filtersReady,
      ]);
      if (!alive() || ticket !== loadTicket) return;
      lessons = rows;
      loadedWeek = ws;
      draw();
    } catch (err) {
      if (!alive() || ticket !== loadTicket) return;
      metaEl.textContent = '';
      body.innerHTML = String(errorState(err.message));
    }
  }

  function skeleton() {
    const desk = `<div class="cal-skel-week hide-mobile" aria-hidden="true">${'<span class="skeleton skeleton--block"></span>'.repeat(7)}</div>`;
    const mob = `<div class="show-mobile" aria-hidden="true"><div class="day-strip">${WD.map(() => '<span class="skeleton skeleton--block" style="height:64px"></span>').join('')}</div>
      <div class="stack" style="margin-top:var(--s-5)">${'<span class="skeleton skeleton--block" style="height:72px"></span>'.repeat(3)}</div></div>`;
    return raw(`${desk}${mob}<span class="sr-only" role="status">Завантаження розкладу…</span>`);
  }

  // ---------- drawing ----------
  function draw() {
    clearInterval(nowTimer);
    drawToolbar();
    const ws = weekStart(st.date);
    const active = lessons.filter((l) => l.status !== 'cancelled');
    const minutes = active.reduce((a, l) => a + (l.duration_min || 0), 0);
    const done = lessons.filter((l) => l.status === 'done').length;
    metaEl.textContent = active.length
      ? `${active.length} ${plural(active.length, 'урок', 'уроки', 'уроків')} · ${fmtNum(minutes / 60)} год${done ? ` · проведено ${done}` : ''}`
      : 'Цього тижня уроків немає';

    // First-run: no students at all → guide instead of an empty grid.
    if (!lessons.length && !students.length && !st.student && !st.teacher) {
      body.innerHTML = String(emptyState({
        icon: 'calendar',
        title: 'Почніть з першого учня',
        text: 'Додайте учня, і зможете планувати уроки та цілі серії на тижні вперед. Або заповніть простір прикладом, щоб побачити, як усе працює.',
        action: html`<div class="cluster" style="justify-content:center"><a class="btn btn--primary" href="#/t/students" data-action="add-student">${raw(icon('plus'))}Додати учня</a><button class="btn btn--secondary" type="button" data-action="demo">${raw(icon('sparkles'))}Заповнити прикладом</button></div>`,
      }));
      return;
    }

    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const byDay = new Map(days.map((d) => [d, []]));
    lessons.forEach((l) => { const k = dayKey(l.starts_at); if (byDay.has(k)) byDay.get(k).push(l); });

    const dayMode = st.view === 'day';
    body.innerHTML = `<div class="hide-mobile cal-desk">
        ${dayMode ? `<div class="cal-desk__strip">${dayStrip(days, byDay)}</div>` : ''}
        ${grid(dayMode ? [st.date] : days, byDay)}
      </div>
      <div class="show-mobile"><div class="cal-mob">
        ${dayStrip(days, byDay)}
        <div class="cal-mob__list">${dayList(st.date, byDay.get(st.date) || [], !lessons.length)}</div>
      </div></div>`;

    // Scroll the grid to the first lesson (or now / 8:00).
    const wk = body.querySelector('.week');
    if (wk) {
      const from = Number(wk.dataset.from);
      const shown = dayMode ? (byDay.get(st.date) || []) : lessons;
      const today = todayKey();
      let target = shown.length ? Math.min(...shown.map((l) => hourOf(l.starts_at))) : DEFAULT_FROM;
      if ((dayMode ? st.date === today : days.includes(today)) && !shown.length) target = Math.max(DEFAULT_FROM, hourOf(Date.now()) - 1);
      const hourPx = wk.querySelector('.week__col').offsetHeight / Number(wk.dataset.hours) || 64;
      wk.scrollTop = Math.max(0, (target - from - 0.5) * hourPx);
      nowTimer = setInterval(() => {
        if (!alive()) { clearInterval(nowTimer); return; }
        const line = body.querySelector('.week__now');
        if (line) line.style.setProperty('--at', hourOf(Date.now()).toFixed(3));
      }, 60000);
    }
  }

  function grid(days, byDay) {
    const today = todayKey();
    const visible = days.flatMap((d) => byDay.get(d) || []);
    let from = DEFAULT_FROM; let to = DEFAULT_TO;
    visible.forEach((l) => {
      const s = hourOf(l.starts_at);
      const e = Math.min(24, s + (l.duration_min || 60) / 60);
      from = Math.min(from, Math.floor(s));
      to = Math.max(to, Math.ceil(e));
    });
    const hours = to - from;
    const nowH = hourOf(Date.now());
    const cols = days.map((d) => {
      const items = layoutLanes((byDay.get(d) || []).map((l) => {
        const s = hourOf(l.starts_at);
        const len = Math.min(24 - s, (l.duration_min || 60) / 60);
        return { l, s, e: s + Math.max(len, 0.5), len };
      }));
      const isToday = d === today;
      const now = isToday && nowH >= from && nowH <= to ? `<span class="week__now" style="--at:${nowH.toFixed(3)}" aria-hidden="true"></span>` : '';
      return `<div class="week__col${isToday ? ' week__col--today' : ''}" data-date="${d}">${now}${items.map(eventHtml).join('')}</div>`;
    }).join('');
    const heads = days.map((d) => {
      const wd = WD[new Date(`${d}T12:00:00Z`).getUTCDay() === 0 ? 6 : new Date(`${d}T12:00:00Z`).getUTCDay() - 1];
      const isToday = d === today;
      return `<button type="button" class="week__day${isToday ? ' week__day--today' : ''}" data-day="${d}"${isToday ? ' aria-current="date"' : ''} aria-label="${esc(capital(fmtFullDate(noon(d))))}: відкрити день">${wd}<span class="week__date">${Number(d.slice(8))}</span></button>`;
    }).join('');
    const times = Array.from({ length: hours }, (_, i) => `<span class="week__time">${String(from + i).padStart(2, '0')}:00</span>`).join('');
    const empty = !visible.length
      ? `<div class="cal-empty-float"><div class="cal-empty-float__card">${icon('calendar')}<span>${days.length === 1 ? 'Цього дня уроків немає' : 'На цьому тижні уроків немає'}</span><button class="btn btn--soft btn--sm" type="button" data-action="new" data-date="${days.length === 1 ? days[0] : ''}">${icon('plus')}Запланувати урок</button></div></div>`
      : '';
    return `<div class="cal-grid-wrap">
      <div class="week${days.length === 1 ? ' cal-week--day' : ''}" style="--from:${from}; --hours:${hours}" data-from="${from}" data-hours="${hours}">
        <div class="week__corner"></div>${heads}
        <div class="week__times" aria-hidden="true">${times}</div>${cols}
      </div>${empty}
      <p class="cal-hint hint">${icon('info', 'icon--sm')}Натисніть на вільний час у сітці, щоб запланувати урок.</p>
    </div>`;
  }

  function eventHtml({ l, s, len, lane, lanes }) {
    const name = l.student?.full_name || 'Учень';
    const t1 = fmtTime(l.starts_at); const t2 = fmtTime(endOf(l));
    const compact = (l.duration_min || 60) <= 30;
    const cls = { done: ' event--done', cancelled: ' event--cancelled', no_show: ' cal-event--noshow' }[l.status] || '';
    const label = { done: 'Проведено', cancelled: 'Скасовано', no_show: 'Неявка' }[l.status];
    const pastOpen = l.status === 'scheduled' && endOf(l) < Date.now();
    const lanesStyle = lanes > 1 ? `; --lane:${lane}; --lanes:${lanes}` : '';
    const timeLine = label && l.status !== 'done' ? `${label} · ${t1}` : (compact ? t1 : `${t1}–${t2}`);
    const mark = l.status === 'done' ? icon('check', 'cal-event__mark') : pastOpen ? '<span class="cal-event__dot" aria-hidden="true"></span>' : '';
    const showTopic = !compact && len >= 1.2 && l.topic && lanes < 3;
    const aria = `${name}, ${t1}–${t2}${label ? `, ${label.toLowerCase()}` : pastOpen ? ', чекає на підсумок' : ''}${l.topic ? `. ${l.topic}` : ''}`;
    return `<a class="event${cls}${compact ? ' event--compact' : ''}${lanes > 1 ? ' cal-event--lane' : ''}${pastOpen ? ' cal-event--open' : ''}" href="#/t/lessons/${esc(l.id)}" style="--at:${s.toFixed(3)}; --len:${Math.max(len, 0.25).toFixed(3)}${lanesStyle}" aria-label="${esc(aria)}" title="${esc(aria)}">
      <span class="event__title">${mark}${esc(lanes > 2 ? initials(name) : shortName(name))}</span>
      <span class="event__time">${esc(timeLine)}</span>
      ${showTopic ? `<span class="cal-event__topic">${esc(l.topic)}</span>` : ''}
    </a>`;
  }

  function dayStrip(days, byDay) {
    const today = todayKey();
    return `<div class="day-strip" role="tablist" aria-label="Дні тижня">${days.map((d, i) => {
      const n = (byDay.get(d) || []).filter((l) => l.status !== 'cancelled').length;
      const sel = d === st.date;
      const dots = '<i></i>'.repeat(Math.min(n, 3));
      return `<button type="button" class="day-strip__day${d === today ? ' day-strip__day--today' : ''}" role="tab" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-day="${d}" aria-label="${esc(capital(fmtFullDate(noon(d))))}${n ? `, ${n} ${plural(n, 'урок', 'уроки', 'уроків')}` : ', без уроків'}">${WD[i]}<span class="day-strip__num">${Number(d.slice(8))}</span><span class="day-strip__dots">${dots}</span></button>`;
    }).join('')}</div>`;
  }

  function dayList(d, list, weekEmpty) {
    const today = todayKey();
    const rel = d === today ? 'Сьогодні' : d === addDays(today, 1) ? 'Завтра' : d === addDays(today, -1) ? 'Вчора' : null;
    const heading = rel
      ? `${rel} <small>${esc(fmtWeekday(noon(d)))}, ${esc(fmtDate(noon(d)))}</small>`
      : `${esc(capital(fmtWeekday(noon(d))))} <small>${esc(fmtDate(noon(d)))}</small>`;
    if (!list.length) {
      return `<div class="day-list"><div class="day-list__group"><p class="day-list__heading">${heading}</p>
        ${String(emptyState({
          icon: 'calendar', plain: true,
          title: weekEmpty ? 'На цьому тижні уроків немає' : 'Цього дня уроків немає',
          text: weekEmpty ? 'Заплануйте урок або цілу серію на кілька тижнів наперед.' : 'Вільний день. Можна запланувати урок.',
          action: html`<button class="btn btn--soft" type="button" data-action="new" data-date="${d}">${raw(icon('plus'))}Запланувати урок</button>`,
        }))}</div></div>`;
    }
    const now = Date.now();
    const rows = list.map((l) => {
      const s = Date.parse(l.starts_at); const e = endOf(l);
      const live = l.status === 'scheduled' && s <= now && now < e;
      const pastOpen = l.status === 'scheduled' && e <= now;
      const badge = live ? '<span class="status status--scheduled">Зараз</span>'
        : pastOpen ? '<span class="badge badge--hl">Без підсумку</span>'
        : l.status === 'scheduled' ? icon('chevronRight', 'muted')
        : String(lessonStatus(l.status));
      return `<a class="lesson${live ? ' lesson--now' : ''}${l.status === 'cancelled' ? ' cal-lesson--cancelled' : ''}" href="#/t/lessons/${esc(l.id)}">
        <span class="lesson__time">${esc(fmtTime(l.starts_at))}<small>${l.duration_min} хв</small></span>
        <span class="lesson__body"><span class="lesson__title">${esc(l.student?.full_name || 'Учень')}</span>
          <span class="lesson__meta">${l.student?.cefr_level ? String(levelBadge(l.student.cefr_level)) : ''}<span class="truncate">${esc(l.topic || 'Без теми')}</span></span></span>
        ${badge}
      </a>`;
    }).join('');
    return `<div class="day-list"><div class="day-list__group"><p class="day-list__heading">${heading}</p>${rows}</div></div>`;
  }

  // ---------- interactions ----------
  const newLesson = (opts = {}) => openLessonForm({
    studentId: st.student || null,
    date: opts.date || (st.date !== todayKey() ? st.date : null),
    time: opts.time || null,
    onSaved: (saved) => {
      const first = Array.isArray(saved) ? saved[0] : saved;
      const k = first ? dayKey(first.starts_at) : st.date;
      loadedWeek = null;
      go({ date: weekStart(k) === weekStart(st.date) && st.view !== 'day' && !mq().matches ? st.date : k });
    },
  });

  on(root, '[data-action="new"]', (e, el) => newLesson({ date: el.dataset.date || null }));
  on(root, '[data-action="prev"]', () => go({ date: addDays(st.date, -dayStep()) }));
  on(root, '[data-action="next"]', () => go({ date: addDays(st.date, dayStep()) }));
  on(root, '[data-action="today"]', () => go({ date: todayKey() }));
  on(root, '.day-strip__day', (e, el) => go({ date: el.dataset.day }, { push: false }));
  on(root, '.week__day', (e, el) => go({ date: el.dataset.day, view: 'day' }));
  on(root, 'input[name="cal-view"]', (e, el) => go({ view: el.value }), 'change');
  on(root, '[data-filter]', (e, el) => {
    st[el.dataset.filter] = el.value;
    if (el.dataset.filter === 'teacher') { st.student = ''; fillFilters(); }
    writeUrl(true);
    load();
  }, 'change');
  on(root, '[data-action="demo"]', async (e, el) => {
    setLoading(el, true, 'Заповнюємо…');
    try {
      await seedDemo();
      if (!alive()) return;
      toast('Приклад готовий', { text: 'Додали учнів, уроки та завдання' });
      students = await listStudents({ includeArchived: true });
      fillFilters();
      loadedWeek = null; load();
    } catch (err) { toastError(err); if (el.isConnected) setLoading(el, false); }
  });
  on(root, '[data-action="add-student"]', async (e) => {
    try {
      const mod = await import('../components/student-form.js');
      e.preventDefault();
      mod.openStudentForm({ onSaved: async () => { students = await listStudents({ includeArchived: true }); if (alive()) { fillFilters(); draw(); } } });
    } catch { /* fall back to the link */ }
  });
  // Arrow keys in the day strip (tabs pattern)
  root.addEventListener('keydown', (e) => {
    const el = e.target.closest('.day-strip__day');
    if (!el || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const next = addDays(el.dataset.day, e.key === 'ArrowRight' ? 1 : -1);
    go({ date: next }, { push: false });
    requestAnimationFrame(() => view.querySelector(`.cal-mob .day-strip__day[data-day="${next}"], .cal-desk .day-strip__day[data-day="${next}"]`)?.focus());
  });

  // Click on an empty slot → new lesson at that time (rounded to 30 min). Hover shows a ghost slot.
  const slotAt = (col, clientY) => {
    const wk = col.closest('.week');
    const from = Number(wk.dataset.from); const hours = Number(wk.dataset.hours);
    const y = clientY - col.getBoundingClientRect().top;
    const h = from + (y / col.offsetHeight) * hours;
    return Math.max(from, Math.min(from + hours - 0.5, Math.floor(h * 2) / 2));
  };
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
  root.addEventListener('click', (e) => {
    const col = e.target.closest('.week__col');
    if (!col || e.target.closest('.event')) return;
    newLesson({ date: col.dataset.date, time: hhmm(slotAt(col, e.clientY)) });
  });
  root.addEventListener('mousemove', (e) => {
    const col = e.target.closest('.week__col');
    const ghost = view.querySelector('.cal-slot');
    if (!col || e.target.closest('.event')) { ghost?.remove(); return; }
    const h = slotAt(col, e.clientY);
    let g = ghost;
    if (!g || g.parentElement !== col) { g?.remove(); g = document.createElement('span'); g.className = 'cal-slot'; g.setAttribute('aria-hidden', 'true'); col.appendChild(g); }
    if (g.dataset.h !== String(h)) { g.dataset.h = String(h); g.style.setProperty('--at', h); g.innerHTML = `${icon('plus', 'icon--sm')}${hhmm(h)}`; }
  });
  root.addEventListener('mouseleave', () => view.querySelector('.cal-slot')?.remove(), true);
  root.addEventListener('mouseout', (e) => { if (e.target.closest?.('.week') && !e.relatedTarget?.closest?.('.week')) view.querySelector('.cal-slot')?.remove(); });

  // Re-draw when crossing the mobile breakpoint (toolbar semantics differ).
  const media = mq();
  const onMedia = () => { if (!alive()) { media.removeEventListener('change', onMedia); return; } if (loadedWeek) draw(); else drawToolbar(); };
  media.addEventListener('change', onMedia);

  // ---------- boot ----------
  writeUrl(false);
  filtersReady = Promise.all([
    listStudents({ includeArchived: true }).catch(() => []),
    teacherFilterOn ? listMembers().catch(() => []) : Promise.resolve([]),
  ]).then(([s, m]) => { if (!alive()) return; students = s; members = m; fillFilters(); });
  await load();
}
