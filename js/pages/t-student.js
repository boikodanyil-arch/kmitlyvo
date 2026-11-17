// Student profile hub (#/t/students/:id).
import { state, isAdmin, isSchool } from '../state.js';
import { html, raw, esc, fmtTime, fmtDate, fmtDateShort, fmtDateTime, relDay, dayKey, todayKey, money, plural, safeUrl, debounce, dueLabel, isOverdue } from '../utils.js';
import { icon, avatar, levelBadge, lessonStatus, targetStatus, badge, emptyState, errorState, pageSkeleton, openModal, confirmDialog, toast, toastError, setLoading, copyText, on } from '../ui.js';
import { getStudent, updateStudent, deleteStudent, getStudentNote, saveStudentNote, regenerateActivationCode, listStudentLessons, listTargets, listPayments, deletePayment, balances } from '../api.js';
import { sb, must, callFunction } from '../supabase.js';
import { navigate } from '../router.js';
import { setTitle } from '../shell.js';
import { openStudentForm, inviteBlock, bindInvite } from '../components/student-form.js';
import { openPaymentForm, balanceChip, bal, lessonsWord } from '../components/payment-form.js';
import { openLessonForm } from '../components/lesson-form.js';

const TABS = [['overview', 'Огляд'], ['lessons', 'Уроки'], ['tasks', 'Завдання'], ['payments', 'Оплати'], ['progress', 'Прогрес']];
const STATUS_LABEL = { active: 'Активний', paused: 'Пауза', archived: 'Архів' };
const cur = () => state.space?.currency || '₴';
const scale = () => state.space?.grade_scale || 12;

async function firstSubmissions(studentId) {
  const rows = must(await sb.from('submissions').select('target_id, submitted_at').eq('student_id', studentId).order('submitted_at', { ascending: true }));
  const map = new Map();
  rows.forEach((r) => { if (!map.has(r.target_id)) map.set(r.target_id, r.submitted_at); });
  return map;
}

export default async function render({ view, params, query, alive }) {
  // Listeners must die with the page: #page is reused across routes, so bind to a fresh root.
  { const host = view; view = document.createElement('div'); view.className = 'page-root'; host.replaceChildren(view); }
  const id = params.id;
  let tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'overview';
  let st, note, lessons, targets, payments, bmap, firstSub;

  view.innerHTML = String(pageSkeleton());
  try {
    st = await getStudent(id);
    if (!alive()) return;
    if (!st) {
      setTitle('Учня не знайдено');
      view.innerHTML = String(emptyState({ icon: 'search', title: 'Учня не знайдено', text: 'Можливо, його видалили або у вас немає доступу.', action: html`<a class="btn btn--primary" href="#/t/students">До списку учнів</a>` }));
      return;
    }
    setTitle(st.full_name);
    [note, lessons, targets, payments, bmap, firstSub] = await Promise.all([
      getStudentNote(id).catch(() => ''),
      listStudentLessons(id, { limit: 300 }),
      listTargets({ studentId: id }),
      listPayments({ studentId: id }),
      balances([id]),
      firstSubmissions(id).catch(() => new Map()),
    ]);
    if (!alive()) return;
  } catch (err) {
    if (alive()) { setTitle('Помилка'); view.innerHTML = String(errorState(err.message)); }
    return;
  }

  const refreshAll = async () => {
    try {
      const fresh = await getStudent(id);
      if (!alive()) return;
      if (!fresh) { navigate('/t/students'); return; }
      st = fresh;
      [lessons, targets, payments, bmap] = await Promise.all([listStudentLessons(id, { limit: 300 }), listTargets({ studentId: id }), listPayments({ studentId: id }), balances([id])]);
      if (!alive()) return;
      setTitle(st.full_name);
      draw();
    } catch (err) { toastError(err); }
  };

  function draw() {
    const scrollY = window.scrollY;
    view.innerHTML = String(html`
      ${header()}
      <div class="profile">
        <aside class="profile__side stack">
          ${accountCard()}
          ${quickFacts()}
        </aside>
        <div class="profile__main stack stack--lg">
          <div class="tabs" role="tablist" aria-label="Розділи профілю">
            ${raw(TABS.map(([k, l]) => `<button class="tab" role="tab" type="button" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-tab="${k}">${l}${tabCount(k)}</button>`).join(''))}
          </div>
          ${raw(TABS.map(([k]) => `<div class="tab-panel" role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" tabindex="0" ${tab === k ? '' : 'hidden'}>${tab === k ? String(panel(k)) : ''}</div>`).join(''))}
        </div>
      </div>
      ${dangerZone()}`);
    bindInvite(view.querySelector('[data-account]') || view, () => st);
    if (tab === 'overview') bindOverview();
    window.scrollTo(0, scrollY);
  }

  function tabCount(k) {
    const n = k === 'tasks' ? targets.filter((t) => t.status === 'submitted').length : 0;
    return n ? `<span class="tab__count">${n}</span>` : '';
  }

  function setTab(k) {
    tab = k;
    history.replaceState(null, '', `#/t/students/${id}${k === 'overview' ? '' : `?tab=${k}`}`);
    view.querySelectorAll('[role="tab"]').forEach((b) => { const on_ = b.dataset.tab === k; b.setAttribute('aria-selected', on_); b.tabIndex = on_ ? 0 : -1; });
    view.querySelectorAll('[role="tabpanel"]').forEach((p) => {
      const on_ = p.id === `panel-${k}`;
      p.hidden = !on_;
      if (on_) p.innerHTML = String(panel(k));
    });
    if (k === 'overview') bindOverview();
  }

  // ------------------------------------------------------------ header
  function header() {
    const meta = html`${levelBadge(st.cefr_level)}
      ${st.status === 'active' ? html`<span class="badge badge--success">${raw(icon('dot', 'icon--sm'))}Активний</span>` : html`<span class="badge${st.status === 'paused' ? ' badge--warning' : ''}">${STATUS_LABEL[st.status]}</span>`}
      ${st.user_id ? '' : html`<span class="badge badge--outline">не активовано</span>`}
      ${isSchool() && st.teacher?.full_name ? html`<span class="text-sm muted">${raw(icon('user', 'icon--sm'))} ${st.teacher.full_name}</span>` : ''}
      ${st.is_demo ? html`<span class="badge badge--info">приклад</span>` : ''}`;
    return html`<div class="page-header profile-head">
      <div class="page-header__titles">
        <a class="back-link" href="#/t/students">${raw(icon('chevronLeft'))}Учні</a>
        <div class="row profile-head__who">
          ${avatar(st.full_name, 'lg')}
          <div class="stack stack--xs" style="min-width:0">
            <h1 class="h1 profile-head__name">${st.full_name}</h1>
            <div class="cluster profile-head__meta">${meta}</div>
          </div>
        </div>
      </div>
      <div class="page-header__actions">
        <button class="btn btn--secondary" type="button" data-action="edit">${raw(icon('edit'))}Редагувати</button>
        <button class="btn btn--secondary" type="button" data-action="lesson">${raw(icon('calendar'))}Урок</button>
        <a class="btn btn--primary" href="#/t/assignments/new?student=${st.id}">${raw(icon('plus'))}Завдання</a>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ side
  function accountCard() {
    if (!st.user_id) {
      return html`<section class="card account-card" data-account aria-labelledby="acc-t">
        <div class="card__head"><div><h2 class="card__title" id="acc-t">Запросіть учня</h2><p class="card__sub">Акаунт ще не активовано</p></div><span class="list-row__lead">${raw(icon('mail'))}</span></div>
        ${st.activation_code ? html`${inviteBlock(st, { compact: true })}
          <div class="card__foot"><span class="text-sm muted">Запрошення потрапило не туди?</span><button class="btn btn--ghost btn--sm" type="button" data-action="regen">${raw(icon('refresh'))}<span>Новий код</span></button></div>`
        : html`<div class="stack stack--sm">
            <p class="muted">${st.is_demo ? 'Це учень із прикладу — запрошувати його не обов’язково. Але можна створити код і спробувати, як працює активація.' : 'Коду активації ще немає. Створіть його й надішліть учню.'}</p>
            <div><button class="btn btn--soft" type="button" data-action="regen" data-fresh>${raw(icon('mail'))}<span>Створити код запрошення</span></button></div>
          </div>`}
      </section>`;
    }
    return html`<section class="card account-card" data-account aria-labelledby="acc-t">
      <div class="card__head"><div><h2 class="card__title" id="acc-t">Акаунт активовано</h2><p class="card__sub">Учень входить за логіном і паролем</p></div><span class="list-row__lead account-card__ok">${raw(icon('checkCircle'))}</span></div>
      <dl class="invite__facts"><div><dt>Логін</dt><dd class="invite__login">${st.login}</dd></div></dl>
      <div class="card__foot"><span class="text-sm muted">Забув пароль?</span><button class="btn btn--secondary btn--sm" type="button" data-action="reset-pass">${raw(icon('lock'))}<span>Скинути пароль</span></button></div>
    </section>`;
  }

  function nextLesson() {
    const now = Date.now();
    return lessons.filter((l) => l.status === 'scheduled' && new Date(l.starts_at).getTime() > now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
  }

  function quickFacts() {
    const n = nextLesson();
    const b = bal(bmap, id);
    const url = safeUrl(st.meeting_url);
    return html`<section class="card facts" aria-label="Коротко">
      <dl class="facts__list">
        <div><dt>${raw(icon('calendar'))}Наступний урок</dt><dd>${n ? html`<a href="#/t/lessons/${n.id}">${relDay(n.starts_at) === 'сьогодні' || relDay(n.starts_at) === 'завтра' ? relDay(n.starts_at) : fmtDateShort(n.starts_at)}, ${fmtTime(n.starts_at)}</a>` : html`<button class="link-btn" type="button" data-action="lesson">Запланувати</button>`}</dd></div>
        <div><dt>${raw(icon('wallet'))}Баланс</dt><dd>${balanceChip(b)}</dd></div>
        <div><dt>${raw(icon('coins'))}Урок</dt><dd>${st.lesson_minutes || 60} хв · ${Number(st.lesson_price) ? money(st.lesson_price, cur()) : 'ціну не вказано'}</dd></div>
        ${url ? html`<div><dt>${raw(icon('video'))}Онлайн-урок</dt><dd><a href="${url}" target="_blank" rel="noopener">Відкрити${raw(icon('external', 'icon--sm'))}</a></dd></div>` : ''}
      </dl>
    </section>`;
  }

  // ------------------------------------------------------------ panels
  function panel(k) {
    if (k === 'overview') return overview();
    if (k === 'lessons') return lessonsPanel();
    if (k === 'tasks') return tasksPanel();
    if (k === 'payments') return paymentsPanel();
    return progressPanel();
  }

  function overview() {
    const url = safeUrl(st.meeting_url);
    const minor = st.is_minor
      ? (st.parent_consent
        ? html`<div class="alert alert--success">${raw(icon('checkCircle'))}<div><p class="alert__title">Неповнолітній учень</p>Згоду батьків на обробку даних отримано.</div></div>`
        : html`<div class="alert alert--warning">${raw(icon('alert'))}<div><p class="alert__title">Немає згоди батьків</p>Учню менше 16 років. Отримайте згоду батьків і позначте її в профілі.<div style="margin-top:var(--s-2)"><button class="btn btn--secondary btn--sm" type="button" data-action="edit">Відкрити профіль</button></div></div></div>`)
      : '';
    return html`<div class="stack stack--lg">
      ${minor}
      <div class="grid-2 overview-grid">
        <section class="card" aria-labelledby="ov-topic">
          <div class="card__head"><h2 class="card__title" id="ov-topic">Наступна тема</h2><button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="edit-topic" aria-label="Змінити наступну тему">${raw(icon('edit'))}</button></div>
          <div data-topic>${topicView()}</div>
        </section>
        <section class="card" aria-labelledby="ov-goals">
          <div class="card__head"><h2 class="card__title" id="ov-goals">Цілі</h2><button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="edit" aria-label="Змінити цілі">${raw(icon('edit'))}</button></div>
          ${st.goals ? html`<p class="pre-wrap">${st.goals}</p>` : html`<p class="muted">Ще не вказано. Цілі допомагають планувати уроки.</p>`}
        </section>
      </div>
      <section class="card" aria-labelledby="ov-contact">
        <h2 class="card__title" id="ov-contact" style="margin-bottom:var(--s-3)">Контакти</h2>
        <dl class="facts__list">
          <div><dt>${raw(icon('phone'))}Контакт</dt><dd>${st.contact ? html`<span class="pre-wrap">${st.contact}</span>` : html`<span class="muted">не вказано</span>`}</dd></div>
          <div><dt>${raw(icon('video'))}Посилання на урок</dt><dd>${url ? html`<span class="row" style="gap:var(--s-1);justify-content:flex-end;min-width:0"><a class="truncate" href="${url}" target="_blank" rel="noopener">${url.replace(/^https?:\/\//, '')}</a><button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="copy-url" aria-label="Копіювати посилання на урок">${raw(icon('copy'))}</button></span>` : html`<button class="link-btn" type="button" data-action="edit">Додати</button>`}</dd></div>
          <div><dt>${raw(icon('user'))}Логін</dt><dd>${st.login}</dd></div>
        </dl>
      </section>
      <section class="card" aria-labelledby="ov-notes">
        <div class="card__head"><div><h2 class="card__title" id="ov-notes">Нотатки</h2><p class="card__sub">${raw(icon('lock', 'icon--sm'))} Бачите лише ви — учень їх не бачить</p></div><span class="save-state text-sm muted" data-save-state aria-live="polite"></span></div>
        <label class="sr-only" for="st-note">Приватні нотатки про учня</label>
        <textarea class="textarea notes-area" id="st-note" rows="6" maxlength="10000" placeholder="Що працює, що ні, слабкі місця, домовленості з батьками…">${note}</textarea>
      </section>
    </div>`;
  }
  function topicView() {
    return st.next_topic ? html`<p class="fw-600 topic-text">${st.next_topic}</p>` : html`<p class="muted">Не вказано. <button class="link-btn" type="button" data-action="edit-topic">Додати тему</button></p>`;
  }

  function bindOverview() {
    const ta = view.querySelector('#st-note');
    const stateEl = view.querySelector('[data-save-state]');
    if (!ta) return;
    let last = note;
    const save = debounce(async () => {
      const body = ta.value;
      if (body === last) return;
      stateEl.textContent = 'Зберігаємо…';
      try {
        await saveStudentNote(id, body);
        last = body; note = body;
        if (stateEl.isConnected) stateEl.innerHTML = `${icon('check', 'icon--sm')} Збережено`;
      } catch (err) { if (stateEl.isConnected) stateEl.textContent = 'Не збережено'; toastError(err); }
    }, 800);
    ta.addEventListener('input', () => { stateEl.textContent = 'Редагування…'; save(); });
    ta.addEventListener('blur', () => save());
  }

  function lessonRow(l) {
    const d = new Date(l.starts_at);
    return html`<li><a class="list-row list-row--time" href="#/t/lessons/${l.id}">
      <span class="list-row__lead">${fmtDateShort(d)}<small>${fmtTime(d)}</small></span>
      <span class="list-row__body">
        <span class="list-row__title">${l.topic || 'Без теми'}</span>
        <span class="list-row__meta">${lessonStatus(l.status)}<span>${l.duration_min || 60} хв</span>${l.student_summary ? html`<span class="truncate lesson-summary">${l.student_summary}</span>` : ''}</span>
      </span>
      <span class="list-row__trail">${raw(icon('chevronRight'))}</span>
    </a></li>`;
  }

  function lessonsPanel() {
    const now = Date.now();
    const upcoming = lessons.filter((l) => l.status === 'scheduled' && new Date(l.starts_at).getTime() > now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const past = lessons.filter((l) => !upcoming.includes(l));
    const action = html`<button class="btn btn--secondary btn--sm" type="button" data-action="lesson">${raw(icon('plus'))}Запланувати урок</button>`;
    if (!lessons.length) return emptyState({ icon: 'calendar', title: 'Уроків ще не було', text: 'Заплануйте перший урок — разовий або щотижневий.', action });
    return html`<div class="stack stack--lg">
      <section class="section" aria-labelledby="ls-up">
        <div class="section__head"><h2 class="h3" id="ls-up">Заплановані</h2>${action}</div>
        ${upcoming.length ? html`<ul class="list list--card">${upcoming.slice(0, 20).map(lessonRow)}</ul>` : html`<p class="muted">Наступного уроку немає.</p>`}
      </section>
      <section class="section" aria-labelledby="ls-past">
        <div class="section__head"><h2 class="h3" id="ls-past">Історія <span class="badge badge--outline">${past.length}</span></h2></div>
        ${past.length ? html`<ul class="list list--card">${past.map(lessonRow)}</ul>` : html`<p class="muted">Проведених уроків ще немає.</p>`}
      </section>
    </div>`;
  }

  function tasksPanel() {
    const action = html`<a class="btn btn--secondary btn--sm" href="#/t/assignments/new?student=${st.id}">${raw(icon('plus'))}Задати завдання</a>`;
    if (!targets.length) return emptyState({ icon: 'clipboard', title: 'Завдань ще немає', text: 'Задайте домашнє — учень побачить його у своєму кабінеті.', action });
    const order = { submitted: 0, assigned: 1, returned: 1, graded: 2 };
    const sorted = [...targets].sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.assignment?.created_at || 0) - new Date(a.assignment?.created_at || 0)));
    return html`<section class="section" aria-labelledby="tk-h">
      <div class="section__head"><h2 class="h3" id="tk-h">Завдання <span class="badge badge--outline">${targets.length}</span></h2>${action}</div>
      <ul class="list list--card">${sorted.map((t) => html`<li><a class="list-row" href="#/t/review/${t.id}">
        <span class="list-row__lead">${raw(icon(t.assignment?.kind === 'quiz' ? 'target' : t.assignment?.kind === 'file' ? 'paperclip' : t.assignment?.kind === 'link' ? 'link' : 'file'))}</span>
        <span class="list-row__body">
          <span class="list-row__title">${t.assignment?.title || 'Завдання'}</span>
          <span class="list-row__meta">${targetStatus(t)}<span>${raw(icon('clock'))}${dueLabel(t.due_at)}</span></span>
        </span>
        <span class="list-row__trail">${t.score != null ? html`<span class="score-pill num">${t.score}<small>/${scale()}</small></span>` : ''}${t.status === 'submitted' ? html`<span class="hide-mobile text-sm fw-600 c-primary">Перевірити</span>` : ''}${raw(icon('chevronRight'))}</span>
      </a></li>`)}</ul>
    </section>`;
  }

  function paymentsPanel() {
    const b = bal(bmap, id);
    const action = html`<button class="btn btn--secondary btn--sm" type="button" data-action="pay">${raw(icon('plus'))}Додати оплату</button>`;
    return html`<div class="stack stack--lg">
      <div class="grid-3 pay-stats">
        <div class="stat"><span class="stat__label">${raw(icon('wallet'))}Оплачено</span><span class="stat__value">${b.paid}<span class="stat__unit">${lessonsWord(b.paid)}</span></span><span class="stat__hint">${money(b.amount, cur())}</span></div>
        <div class="stat"><span class="stat__label">${raw(icon('checkCircle'))}Проведено</span><span class="stat__value">${b.used}<span class="stat__unit">${lessonsWord(b.used)}</span></span><span class="stat__hint">разом з неявками</span></div>
        <div class="stat${b.balance <= 1 && (b.paid || b.used) ? ' stat--attention' : ''}"><span class="stat__label">${raw(icon('coins'))}Залишок</span><span class="stat__value${b.balance < 0 ? ' c-danger' : ''}">${b.balance}<span class="stat__unit">${lessonsWord(b.balance)}</span></span><span class="stat__hint">${b.balance < 0 ? `борг ${money(-b.balance * Number(st.lesson_price || 0), cur())}` : b.balance <= 1 ? 'час нагадати про оплату' : 'усе гаразд'}</span></div>
      </div>
      <section class="section" aria-labelledby="pm-h">
        <div class="section__head"><h2 class="h3" id="pm-h">Оплати</h2>${action}</div>
        ${payments.length ? html`<ul class="list list--card">${payments.map((p) => html`<li class="action-row">
          <div class="list-row grow">
            <span class="list-row__lead">${raw(icon('coins'))}</span>
            <span class="list-row__body">
              <span class="list-row__title">${p.lessons_count} ${lessonsWord(p.lessons_count)} · ${money(p.amount, cur())}</span>
              <span class="list-row__meta"><span>${fmtDate(p.paid_on + 'T12:00:00')}</span>${p.note ? html`<span class="truncate">${p.note}</span>` : ''}</span>
            </span>
          </div>
          <div class="action-row__act"><button class="btn btn--ghost btn--icon btn--sm" type="button" data-action="del-pay" data-id="${p.id}" aria-label="Видалити оплату від ${fmtDate(p.paid_on + 'T12:00:00')}">${raw(icon('trash'))}</button></div>
        </li>`)}</ul>` : emptyState({ icon: 'wallet', title: 'Оплат ще немає', text: 'Додайте першу оплату — баланс уроків порахується автоматично.', plain: true })}
      </section>
    </div>`;
  }

  function progressPanel() {
    const graded = targets.filter((t) => t.status === 'graded' && t.score != null);
    const avg = graded.length ? graded.reduce((s, t) => s + Number(t.score), 0) / graded.length : null;
    const withDue = targets.filter((t) => t.due_at && (firstSub.has(t.id) || new Date(t.due_at) < new Date()));
    const onTime = withDue.filter((t) => firstSub.has(t.id) && new Date(firstSub.get(t.id)) <= new Date(t.due_at)).length;
    const onTimePct = withDue.length ? Math.round((onTime / withDue.length) * 100) : null;
    const done = lessons.filter((l) => l.status === 'done').length;
    const noShow = lessons.filter((l) => l.status === 'no_show').length;
    const att = done + noShow ? Math.round((done / (done + noShow)) * 100) : null;
    const pct = (v) => (v == null ? '—' : `${v}%`);
    const bar = (v, label, hl = false) => (v == null ? '' : html`<div class="progress${hl ? ' progress--hl' : ''}" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}" style="--value:${v}%"><div class="progress__bar"></div></div>`);
    if (!targets.length && !(done + noShow)) {
      return emptyState({ icon: 'chart', title: 'Прогрес з’явиться згодом', text: 'Після перших уроків і оцінених завдань тут буде середній бал, відвідуваність і дисципліна.', plain: false });
    }
    const avgPct = avg == null ? null : Math.round((avg / scale()) * 100);
    return html`<div class="stack stack--lg">
      <div class="grid-2 progress-grid">
        <div class="stat"><span class="stat__label">${raw(icon('star'))}Середній бал</span><span class="stat__value">${avg == null ? '—' : avg.toLocaleString('uk-UA', { maximumFractionDigits: 1 })}<span class="stat__unit">з ${scale()}</span></span>${bar(avgPct, 'Середній бал', true)}<span class="stat__hint">${graded.length ? `${graded.length} ${plural(graded.length, 'оцінка', 'оцінки', 'оцінок')}` : 'ще немає оцінок'}</span></div>
        <div class="stat"><span class="stat__label">${raw(icon('clock'))}Здано вчасно</span><span class="stat__value">${pct(onTimePct)}</span>${bar(onTimePct, 'Здано вчасно')}<span class="stat__hint">${withDue.length ? `${onTime} з ${withDue.length} з дедлайном` : 'немає завдань з дедлайном'}</span></div>
        <div class="stat"><span class="stat__label">${raw(icon('checkCircle'))}Відвідуваність</span><span class="stat__value">${pct(att)}</span>${bar(att, 'Відвідуваність')}<span class="stat__hint">${done + noShow ? `${done} ${plural(done, 'урок', 'уроки', 'уроків')} проведено, ${noShow} ${plural(noShow, 'неявка', 'неявки', 'неявок')}` : 'уроків ще не було'}</span></div>
        <div class="stat"><span class="stat__label">${raw(icon('trophy'))}Рівень</span><span class="stat__value">${st.cefr_level}</span><span class="stat__hint">${targets.length} ${plural(targets.length, 'завдання', 'завдання', 'завдань')} · ${targets.filter((t) => isOverdue(t)).length} прострочено</span></div>
      </div>
      ${graded.length ? html`<section class="section" aria-labelledby="pg-h"><h2 class="h3" id="pg-h">Останні оцінки</h2>
        <div class="card"><ol class="score-bars" aria-label="Останні оцінки, від старіших до новіших">
          ${[...graded].sort((a, b) => new Date(a.graded_at || 0) - new Date(b.graded_at || 0)).slice(-12).map((t) => html`<li title="${t.assignment?.title || ''}: ${t.score}/${scale()}"><span class="score-bars__bar" style="--h:${Math.max(6, Math.round((Number(t.score) / scale()) * 100))}%"></span><span class="score-bars__v num">${t.score}</span></li>`)}
        </ol></div></section>` : ''}
    </div>`;
  }

  function dangerZone() {
    const archived = st.status === 'archived';
    return html`<section class="danger-zone" aria-labelledby="dz-h">
      <h2 class="h4" id="dz-h">Небезпечна зона</h2>
      <div class="danger-zone__row">
        <div class="grow"><p class="fw-600">${archived ? 'Повернути з архіву' : 'Архівувати учня'}</p><p class="text-sm muted">${archived ? 'Учень знову зʼявиться в списках і на головній.' : 'Учень зникне зі списків і головної, але вся історія збережеться. Вхід для учня залишиться.'}</p></div>
        <button class="btn btn--secondary" type="button" data-action="archive"><span>${archived ? 'Повернути' : 'Архівувати'}</span></button>
      </div>
      <div class="danger-zone__row">
        <div class="grow"><p class="fw-600">Видалити учня</p><p class="text-sm muted">Назавжди видалить уроки, завдання, роботи, оплати й нотатки. Учень втратить доступ.</p></div>
        <button class="btn btn--danger-ghost" type="button" data-action="delete">${raw(icon('trash'))}<span>Видалити</span></button>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------ events
  on(view, '[data-tab]', (e, el) => setTab(el.dataset.tab));
  view.addEventListener('keydown', (e) => {
    const t = e.target.closest('[role="tab"]');
    if (!t || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const keys = TABS.map(([k]) => k);
    let i = keys.indexOf(t.dataset.tab);
    i = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    setTab(keys[i]);
    view.querySelector(`#tab-${keys[i]}`)?.focus();
    e.preventDefault();
  });
  on(view, '[data-action="edit"]', () => openStudentForm({ student: st, onSaved: () => refreshAll() }));
  on(view, '[data-action="lesson"]', () => openLessonForm({ studentId: id, onSaved: () => refreshAll() }));
  on(view, '[data-action="pay"]', () => openPaymentForm({ studentId: id, onSaved: () => refreshAll() }));
  on(view, '[data-action="copy-url"]', () => copyText(st.meeting_url, 'Посилання скопійовано'));
  on(view, '[data-action="del-pay"]', async (e, el) => {
    const p = payments.find((x) => x.id === el.dataset.id);
    if (!p) return;
    const ok = await confirmDialog({ title: 'Видалити оплату?', text: `${p.lessons_count} ${lessonsWord(p.lessons_count)} · ${money(p.amount, cur())} від ${fmtDate(p.paid_on + 'T12:00:00')}. Баланс учня зменшиться.`, confirmLabel: 'Видалити оплату', danger: true });
    if (!ok) return;
    try { await deletePayment(p.id); toast('Оплату видалено'); await refreshAll(); } catch (err) { toastError(err); }
  });
  on(view, '[data-action="edit-topic"]', () => {
    const host = view.querySelector('[data-topic]');
    if (!host || host.querySelector('form')) return;
    host.innerHTML = String(html`<form class="topic-form" data-topic-form>
      <label class="sr-only" for="topic-in">Наступна тема</label>
      <input class="input" id="topic-in" name="topic" maxlength="200" value="${st.next_topic || ''}" placeholder="Наприклад: Conditionals type 2">
      <div class="cluster cluster--end"><button class="btn btn--ghost btn--sm" type="button" data-action="topic-cancel">Скасувати</button><button class="btn btn--soft btn--sm" type="submit"><span>Зберегти</span></button></div>
    </form>`);
    const input = host.querySelector('input');
    input.focus(); input.select();
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); host.innerHTML = String(topicView()); } });
    host.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = host.querySelector('[type="submit"]');
      setLoading(btn, true);
      try {
        const row = await updateStudent(id, { next_topic: input.value.trim() });
        st = { ...st, next_topic: row.next_topic };
        host.innerHTML = String(topicView());
        toast('Тему збережено');
      } catch (err) { toastError(err); setLoading(btn, false); }
    });
  });
  on(view, '[data-action="topic-cancel"]', () => { const host = view.querySelector('[data-topic]'); if (host) host.innerHTML = String(topicView()); });

  on(view, '[data-action="regen"]', async (e, el) => {
    if (st.activation_code) {
      const ok = await confirmDialog({ title: 'Створити новий код?', text: 'Старий код і посилання перестануть працювати. Надішліть учню нове запрошення.', confirmLabel: 'Створити новий код' });
      if (!ok) return;
    }
    setLoading(el, true);
    try {
      const code = await regenerateActivationCode(id);
      st = { ...st, activation_code: code };
      toast('Новий код створено');
      draw();
    } catch (err) { toastError(err); setLoading(el, false); }
  });

  on(view, '[data-action="reset-pass"]', async (e, el) => {
    const ok = await confirmDialog({ title: 'Скинути пароль?', text: `Ми створимо тимчасовий пароль для ${st.full_name}. Старий пароль перестане працювати — передайте учню новий.`, confirmLabel: 'Скинути пароль' });
    if (!ok) return;
    setLoading(el, true);
    try {
      const res = await callFunction('auth-signup', { action: 'reset_student_password', student_id: id });
      setLoading(el, false);
      showTempPassword(res.login || st.login, res.password);
    } catch (err) { toastError(err); setLoading(el, false); }
  });

  on(view, '[data-action="archive"]', async (e, el) => {
    const archived = st.status === 'archived';
    if (!archived) {
      const ok = await confirmDialog({ title: `Архівувати ${st.full_name}?`, text: 'Учень зникне зі списків, головної та вибору в завданнях. Уроки, оцінки й оплати збережуться — повернути можна будь-коли.', confirmLabel: 'Архівувати' });
      if (!ok) return;
    }
    setLoading(el, true);
    try {
      const row = await updateStudent(id, { status: archived ? 'active' : 'archived' });
      st = { ...st, ...row };
      toast(archived ? 'Учня повернуто з архіву' : 'Учня архівовано');
      draw();
    } catch (err) { toastError(err); setLoading(el, false); }
  });

  on(view, '[data-action="delete"]', async (e, el) => {
    const n = lessons.length, t = targets.length, p = payments.length;
    const ok = await confirmDialog({
      title: `Видалити ${st.full_name}?`,
      text: `Це назавжди. Буде видалено: ${n} ${plural(n, 'урок', 'уроки', 'уроків')}, ${t} ${plural(t, 'завдання', 'завдання', 'завдань')} з роботами учня, ${p} ${plural(p, 'оплату', 'оплати', 'оплат')} і нотатки.${st.user_id ? ' Учень більше не зможе увійти.' : ''} Якщо хочете лише прибрати учня зі списків — архівуйте.`,
      confirmLabel: 'Видалити назавжди', danger: true,
    });
    if (!ok) return;
    setLoading(el, true);
    try {
      await deleteStudent(id);
      toast('Учня видалено');
      navigate('/t/students');
    } catch (err) { toastError(err); setLoading(el, false); }
  });

  draw();
}

function showTempPassword(login, password) {
  const text = `Логін: ${login}\nТимчасовий пароль: ${password}\nУвійти: ${location.origin + location.pathname}#/login`;
  const { dialog } = openModal({
    title: 'Новий тимчасовий пароль',
    body: String(html`<div class="stack">
      <p>Передайте учню ці дані. Після входу пароль можна змінити в налаштуваннях.</p>
      <dl class="invite__facts"><div><dt>Логін</dt><dd class="invite__login">${login}</dd></div></dl>
      <div class="code-box" aria-label="Тимчасовий пароль">${password}</div>
      <div class="alert alert--warning">${raw(icon('lock'))}<div>Пароль показуємо лише один раз — скопіюйте його зараз.</div></div>
    </div>`),
    foot: '<button class="btn btn--secondary" type="button" data-copy-pass>Копіювати пароль</button><button class="btn btn--primary" type="button" data-copy-all>Копіювати логін і пароль</button>',
  });
  dialog.querySelector('[data-copy-pass]').addEventListener('click', () => copyText(password, 'Пароль скопійовано'));
  dialog.querySelector('[data-copy-all]').addEventListener('click', () => copyText(text, 'Дані для входу скопійовано'));
}
