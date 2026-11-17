// Student schedule (#/s/schedule): upcoming lessons by day + past lessons with summaries.
import * as api from '../api.js';
import { state } from '../state.js';
import { setTitle } from '../shell.js';
import { html, raw, fmtTime, fmtFullDate, fmtDateShort, dayKey, addDays, todayKey, fromZoned, safeUrl, plural } from '../utils.js';
import { icon, lessonStatus, pageHeader, emptyState, errorState } from '../ui.js';
import { cap, dayDiff, teacherName } from './s-tasks.js';
import { lessonEnd } from './s-home.js';

function dayHeading(key) {
  const d = fromZoned(key, '12:00');
  const diff = dayDiff(d);
  const main = diff === 0 ? 'Сьогодні' : diff === 1 ? 'Завтра' : cap(new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'long' }).format(d));
  const sub = diff <= 1 ? fmtFullDate(d) : fmtDateShort(d);
  return html`<p class="day-list__heading">${main} <small>${sub}</small></p>`;
}

function skeleton() {
  return raw(`<div class="page-header"><div class="page-header__titles"><span class="skeleton skeleton--title" style="width:160px"></span></div></div>
  <div class="day-list" aria-hidden="true">${[0, 1].map(() => `<div class="day-list__group"><span class="skeleton skeleton--text" style="width:140px"></span><span class="skeleton skeleton--block" style="height:72px"></span></div>`).join('')}</div>
  <span class="sr-only" role="status">Завантаження…</span>`);
}

export default async function render({ view, alive }) {
  setTitle('Розклад');
  view.innerHTML = String(skeleton());
  const sid = state.student.id;
  const now = new Date();
  let upcoming; let history; let teacher;
  try {
    [upcoming, history, teacher] = await Promise.all([
      api.listLessons(new Date(now.getTime() - 6 * 3600000).toISOString(), fromZoned(addDays(todayKey(), 120)).toISOString(), { studentId: sid }),
      api.listStudentLessons(sid, { limit: 60 }),
      teacherName(),
    ]);
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(errorState(err.message));
    return;
  }
  if (!alive()) return;

  // Upcoming: not yet finished (scheduled) + cancelled ones still in the future (so the student sees the change)
  const up = upcoming.filter((l) => lessonEnd(l) > now && (l.status === 'scheduled' || l.status === 'cancelled'));
  const past = history.filter((l) => !up.some((u) => u.id === l.id) && (new Date(l.starts_at) < now || l.status !== 'scheduled'));
  const groups = new Map();
  up.forEach((l) => { const k = dayKey(l.starts_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
  const fallbackUrl = safeUrl(state.student?.meeting_url);
  const nUp = up.filter((l) => l.status === 'scheduled').length;

  view.innerHTML = String(html`
    ${pageHeader({ title: 'Розклад', meta: nUp ? `${nUp} ${plural(nUp, 'урок', 'уроки', 'уроків')} попереду${teacher ? ` · вчитель ${teacher}` : ''}` : (teacher ? `Вчитель ${teacher}` : '') })}
    <div class="s-sched">
      <section class="section" aria-labelledby="up-h">
        <h2 class="h2" id="up-h">Найближчі уроки</h2>
        ${groups.size ? html`<div class="day-list">${[...groups.entries()].map(([k, list]) => html`<div class="day-list__group">
          ${dayHeading(k)}
          ${list.map((l) => {
            const live = new Date(l.starts_at) <= now && lessonEnd(l) > now && l.status === 'scheduled';
            const today = dayDiff(l.starts_at) === 0 && l.status === 'scheduled';
            const url = safeUrl(l.meeting_url) || fallbackUrl;
            return html`<div class="lesson s-lesson${live ? ' lesson--now' : ''}${l.status === 'cancelled' ? ' s-lesson--cancelled' : ''}">
              <span class="lesson__time">${fmtTime(l.starts_at)}<small>${l.duration_min || 60} хв</small></span>
              <span class="lesson__body">
                <span class="lesson__title">${l.topic || state.student?.next_topic || 'Урок англійської'}</span>
                <span class="lesson__meta">${live ? html`<span class="badge badge--hl">${raw(icon('dot', 'icon--sm'))}Іде зараз</span>` : lessonStatus(l.status)}${l.status === 'scheduled' ? html`<span>до ${fmtTime(lessonEnd(l))}</span>` : ''}</span>
              </span>
              ${today && url ? html`<a class="btn btn--primary btn--sm s-lesson__join" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Приєднатися до уроку о ${fmtTime(l.starts_at)}">${raw(icon('video'))}<span class="s-join-label">Приєднатися</span></a>` : html`<span></span>`}
            </div>`;
          })}
        </div>`)}</div>`
        : emptyState({ icon: 'calendar', title: 'Нових уроків поки немає', text: 'Коли вчитель додасть урок у розклад, він одразу з’явиться тут.' })}
      </section>

      <section class="section" aria-labelledby="past-h">
        <h2 class="h2" id="past-h">Минулі уроки</h2>
        ${past.length ? html`<ul class="list list--card s-past">${past.map((l) => {
          const hasMore = !!(l.student_summary || '').trim();
          const head = html`<span class="s-past__date"><b>${fmtDateShort(l.starts_at)}</b><small>${fmtTime(l.starts_at)}</small></span>
            <span class="list-row__body"><span class="list-row__title">${l.topic || 'Урок без теми'}</span><span class="list-row__meta">${lessonStatus(l.status)}${hasMore ? html`<span>${raw(icon('book'))}Є підсумок</span>` : ''}</span></span>`;
          return html`<li>${hasMore ? html`<details class="s-past__item"><summary class="list-row">${head}<span class="list-row__trail s-past__chev">${raw(icon('chevronDown'))}</span></summary>
              <div class="s-past__sum"><p class="s-label">${raw(icon('message', 'icon--sm'))}Підсумок уроку</p><p class="pre-wrap">${l.student_summary}</p></div></details>`
            : html`<div class="list-row s-past__item">${head}</div>`}</li>`;
        })}</ul>`
        : emptyState({ icon: 'book', title: 'Тут буде історія уроків', text: 'Після кожного уроку ви побачите тему й короткий підсумок від вчителя.', plain: true })}
      </section>
    </div>`);
}
