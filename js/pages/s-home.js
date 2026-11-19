// Student home (#/s): greeting, next lesson, to-do, news from the teacher, last lesson, on-time widget.
import * as api from '../api.js';
import { state } from '../state.js';
import { setTitle, setCount } from '../shell.js';
import { html, raw, fmtTime, fmtFullDate, fmtDateShort, addDays, todayKey, fromZoned, safeUrl, isOverdue, plural } from '../utils.js';
import { icon, avatar, emptyState, errorState } from '../ui.js';
import {
  isTodo, sortTodo, taskRow, listSkeleton, teacherName, firstName, whenLabel, cap, snippet, scorePill,
  firstSubmissions, onTimeStats, kindOf, isAutoFeedback,
} from './s-tasks.js';

export function lessonEnd(l) { return new Date(new Date(l.starts_at).getTime() + (l.duration_min || 60) * 60000); }

/** Focus card for the next (or ongoing) lesson. */
export function nextLessonCard(lesson, teacher) {
  const now = new Date();
  const live = new Date(lesson.starts_at) <= now && lessonEnd(lesson) > now;
  const minsTo = Math.round((new Date(lesson.starts_at) - now) / 60000);
  const soon = !live && minsTo > 0 && minsTo <= 60;
  const url = safeUrl(lesson.meeting_url || state.student?.meeting_url);
  const topic = lesson.topic || state.student?.next_topic || '';
  return html`<section class="card card--focus s-next" aria-labelledby="next-t">
    <div class="s-next__top">
      <p class="s-next__eyebrow" id="next-t">${raw(icon('calendar', 'icon--sm'))}${live ? 'Урок триває' : 'Наступний урок'}</p>
      ${live ? html`<span class="badge badge--hl">${raw(icon('dot', 'icon--sm'))}Зараз</span>` : soon ? html`<span class="badge badge--hl">За ${minsTo} хв</span>` : ''}
    </div>
    <p class="s-next__when"><span>${whenLabel(lesson.starts_at)}</span><span class="s-next__time">${fmtTime(lesson.starts_at)}</span></p>
    <p class="s-next__meta muted">${lesson.duration_min || 60} хв${topic ? html` · <span class="s-next__topic">${topic}</span>` : ''}</p>
    ${teacher ? html`<div class="row s-next__teacher">${avatar(teacher, 'sm')}<span><span class="muted text-sm">Вчитель</span><br><b>${teacher}</b></span></div>` : ''}
    ${url ? html`<a class="btn btn--primary btn--lg btn--block s-next__join" href="${url}" target="_blank" rel="noopener noreferrer">${raw(icon('video'))}Приєднатися до уроку</a>`
    : html`<p class="text-sm muted s-next__nolink">${raw(icon('info', 'icon--sm'))}Посилання на урок надішле вчитель.</p>`}
  </section>`;
}

function skeleton() {
  return raw(`<div class="page-header"><div class="page-header__titles"><span class="skeleton skeleton--title" style="width:220px"></span><span class="skeleton skeleton--text" style="width:160px"></span></div></div>
    <div class="s-home"><span class="skeleton skeleton--block" style="height:200px;border-radius:var(--r-md)"></span>
    <div class="section"><span class="skeleton skeleton--text" style="width:120px"></span>${listSkeleton(3)}</div></div>
    <span class="sr-only" role="status">Завантаження…</span>`);
}

export default async function render({ view, alive }) {
  const name = firstName(state.student?.full_name || state.profile?.full_name);
  setTitle('Головна');
  view.innerHTML = String(skeleton());

  const sid = state.student.id;
  const now = new Date();
  const from = new Date(now.getTime() - 4 * 3600000).toISOString();
  const to = fromZoned(addDays(todayKey(), 90)).toISOString();

  let lessons; let past; let targets; let teacher; let subs; let books = [];
  try {
    [lessons, past, targets, teacher, subs, books] = await Promise.all([
      api.listLessons(from, to, { studentId: sid }),
      api.listStudentLessons(sid, { limit: 20 }),
      api.listTargets(),
      teacherName(),
      firstSubmissions(),
      import('../books-api.js').then((m) => m.myBooks()).catch(() => []),
    ]);
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(errorState(err.message));
    return;
  }
  if (!alive()) return;

  const next = lessons.find((l) => l.status === 'scheduled' && lessonEnd(l) > now);
  const todo = sortTodo(targets.filter(isTodo));
  setCount('tasks', todo.length);
  const overdue = todo.filter(isOverdue).length;
  const recent = targets
    .filter((t) => t.status === 'graded' && t.graded_at && (now - new Date(t.graded_at)) < 21 * 86400000)
    .sort((a, b) => new Date(b.graded_at) - new Date(a.graded_at)).slice(0, 3);
  const last = past.find((l) => l.status === 'done' && new Date(l.starts_at) < now);
  const { onTime, total } = onTimeStats(targets, subs);
  const pct = total ? Math.round((onTime / total) * 100) : 0;

  const subline = todo.length
    ? `${cap(fmtFullDate(now))} · ${todo.length} ${plural(todo.length, 'завдання', 'завдання', 'завдань')} до здачі`
    : `${cap(fmtFullDate(now))} · усі завдання здано`;

  view.innerHTML = String(html`
    <div class="page-header s-hello">
      <div class="page-header__titles">
        <h1 class="h1">Привіт, ${name || 'друже'}!</h1>
        <p class="page-header__meta">${subline}</p>
      </div>
    </div>

    <div class="s-home">
      <div class="s-home__main stack stack--xl">
        ${next ? nextLessonCard(next, teacher) : html`<section class="card card--quiet s-nolesson">
            <span class="s-nolesson__icon">${raw(icon('calendar'))}</span>
            <div><p class="fw-600">Наступний урок ще не заплановано</p><p class="text-sm muted">Щойно вчитель додасть його в розклад, він з’явиться тут.</p></div>
          </section>`}

        ${books.length ? html`<section class="s-bookcard s-home-book" aria-label="Мій підручник">
            <span class="book-row__icon book-row__icon--${books[0].textbook.kind}" aria-hidden="true">${books[0].textbook.kind === 'workbook' ? 'WB' : books[0].textbook.kind === 'student_book' ? 'SB' : '•'}</span>
            <div class="grow"><p class="fw-600">${books.length > 1 ? 'Мої підручники' : books[0].textbook.title}</p><p class="text-sm muted">${books.length > 1 ? books.map((r) => r.textbook.title).join(', ') : 'Відповідайте прямо на сторінках'}</p></div>
            <a class="btn btn--secondary" href="${books.length > 1 ? '#/s/books' : `#/s/books/${books[0].textbook_id}`}">${raw(icon('book'))}<span>Відкрити</span></a>
          </section>` : ''}

        <section class="section" aria-labelledby="todo-h">
          <div class="section__head"><h2 class="h2" id="todo-h">До здачі${todo.length ? html` <span class="s-count">${todo.length}</span>` : ''}</h2>${todo.length ? html`<a class="link-btn" href="#/s/tasks">Усі завдання${raw(icon('chevronRight'))}</a>` : ''}</div>
          ${overdue ? html`<p class="s-overdue-note">${raw(icon('alert', 'icon--sm'))}${overdue} ${plural(overdue, 'завдання прострочене', 'завдання прострочені', 'завдань прострочено')} — почніть з ${overdue === 1 ? 'нього' : 'них'}</p>` : ''}
          ${todo.length ? html`<ul class="list list--card">${todo.slice(0, 5).map((t) => taskRow(t))}</ul>`
          : html`<div class="s-empty-joy">${emptyState({ icon: 'trophy', title: 'Усе зроблено! Можна відпочити', text: 'Нових завдань немає. Коли вчитель щось задасть, ви побачите це тут.' })}</div>`}
        </section>

        ${recent.length ? html`<section class="section" aria-labelledby="new-h">
          <div class="section__head"><h2 class="h2" id="new-h">Нове від вчителя</h2><a class="link-btn" href="#/s/tasks?tab=graded">Усі оцінки${raw(icon('chevronRight'))}</a></div>
          <div class="stack stack--sm">${recent.map((t) => html`<a class="card card--interactive s-news" href="#/s/tasks/${t.id}">
            <div class="s-news__head">
              <span class="s-kind s-kind--${t.assignment?.kind || 'text'}" aria-hidden="true">${raw(icon(kindOf(t).icon))}</span>
              <span class="s-news__title"><b>${t.assignment?.title || 'Завдання'}</b><span class="text-sm muted">Оцінено ${fmtDateShort(t.graded_at)}</span></span>
              ${scorePill(t.score)}
            </div>
            ${t.feedback && !isAutoFeedback(t.feedback) ? html`<p class="s-news__fb">«${snippet(t.feedback, 140)}»</p>` : ''}
          </a>`)}</div>
        </section>` : ''}
      </div>

      <aside class="s-home__side stack stack--xl">
        ${total ? html`<section class="card s-streak" aria-labelledby="streak-h">
          <div class="s-streak__head">
            <span class="s-streak__icon">${raw(icon(pct >= 80 ? 'flame' : 'target'))}</span>
            <div><p class="fw-600" id="streak-h">Здано вчасно ${onTime} з ${total}</p>
            <p class="text-sm muted">${pct >= 90 ? 'Неймовірна дисципліна. Так тримати!' : pct >= 70 ? 'Гарний ритм — ще трішки до ідеалу.' : 'Кожна вчасно здана робота — крок уперед.'}</p></div>
          </div>
          <div class="progress progress--hl" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Здано вчасно" style="--value:${pct}%"><div class="progress__bar"></div></div>
          <a class="link-btn" href="#/s/progress">Мій прогрес${raw(icon('chevronRight'))}</a>
        </section>` : ''}

        ${last ? html`<section class="card s-last" aria-labelledby="last-h">
          <p class="s-label" id="last-h">${raw(icon('book', 'icon--sm'))}Що ми робили минулого разу</p>
          <p class="text-sm muted">${cap(fmtFullDate(last.starts_at))}</p>
          ${last.topic ? html`<p class="h3">${last.topic}</p>` : ''}
          ${last.student_summary ? html`<p class="pre-wrap s-last__sum">${last.student_summary}</p>` : html`<p class="muted text-sm">Вчитель ще не додав підсумок уроку.</p>`}
          <a class="link-btn" href="#/s/schedule">Усі уроки${raw(icon('chevronRight'))}</a>
        </section>` : ''}
      </aside>
    </div>`);
}
