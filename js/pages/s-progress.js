// Student progress (#/s/progress): level, stats, graded works, paid lessons balance.
import * as api from '../api.js';
import { state } from '../state.js';
import { setTitle } from '../shell.js';
import { html, raw, fmtDateShort, plural } from '../utils.js';
import { icon, pageHeader, emptyState, errorState } from '../ui.js';
import { scale, fmtScore, firstSubmissions, onTimeStats, kindOf } from './s-tasks.js';

const CEFR = {
  A0: { name: 'Стартовий', text: 'Ви тільки починаєте — знайомимося з англійською крок за кроком, і це найцікавіше.' },
  A1: { name: 'Початковий', text: 'Ви розумієте прості фрази й уже можете розповісти про себе та привітатися з будь-ким.' },
  A2: { name: 'Елементарний', text: 'Ви справляєтеся в типових ситуаціях: магазин, дорога, розмова про родину й хобі.' },
  B1: { name: 'Середній', text: 'Ви впевнено говорите на знайомі теми, розумієте головне й не загубитеся в подорожі.' },
  B2: { name: 'Вище середнього', text: 'Ви вільно спілкуєтеся з носіями мови й розумієте більшість фільмів і статей.' },
  C1: { name: 'Просунутий', text: 'Ви гнучко користуєтеся мовою для навчання й роботи, навіть у складних темах.' },
  C2: { name: 'Вільне володіння', text: 'Ваша англійська — майже як у носія. Це вражає!' },
};
const LADDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function stat(ic, label, value, unit = '', note = '') {
  return html`<div class="stat s-stat"><span class="stat__label">${raw(icon(ic))}${label}</span><span class="stat__value">${value}${unit ? html`<span class="stat__unit">${unit}</span>` : ''}</span>${note ? html`<span class="text-xs muted">${note}</span>` : ''}</div>`;
}

function skeleton() {
  return raw(`<div class="page-header"><div class="page-header__titles"><span class="skeleton skeleton--title" style="width:180px"></span></div></div>
  <div class="stack stack--lg" aria-hidden="true"><span class="skeleton skeleton--block" style="height:150px"></span>
  <div class="grid-2"><span class="skeleton skeleton--block"></span><span class="skeleton skeleton--block"></span><span class="skeleton skeleton--block"></span><span class="skeleton skeleton--block"></span></div></div>
  <span class="sr-only" role="status">Завантаження…</span>`);
}

export default async function render({ view, alive }) {
  setTitle('Прогрес');
  view.innerHTML = String(skeleton());
  const sid = state.student.id;
  let targets; let lessons; let bal; let subs;
  try {
    [targets, lessons, bal, subs] = await Promise.all([
      api.listTargets(),
      api.listStudentLessons(sid, { limit: 500 }),
      api.balances([sid]).catch(() => null),
      firstSubmissions(),
    ]);
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(errorState(err.message));
    return;
  }
  if (!alive()) return;

  const lvl = String(state.student?.cefr_level || 'A1').toUpperCase();
  const info = CEFR[lvl] || CEFR.A1;
  const lvlCls = lvl === 'A0' ? 'a1' : lvl.toLowerCase();
  const step = Math.max(0, LADDER.indexOf(lvl === 'A0' ? 'A1' : lvl));

  const max = scale();
  const graded = targets.filter((t) => t.status === 'graded' && t.score != null)
    .sort((a, b) => new Date(b.graded_at || 0) - new Date(a.graded_at || 0));
  const avg = graded.length ? graded.reduce((s, t) => s + Number(t.score), 0) / graded.length : null;
  const { onTime, total } = onTimeStats(targets, subs);
  const done = lessons.filter((l) => l.status === 'done').length;
  const missed = lessons.filter((l) => l.status === 'no_show').length;
  const attendance = done + missed ? Math.round((done / (done + missed)) * 100) : null;
  const b = bal?.get(sid) || null;

  view.innerHTML = String(html`
    ${pageHeader({ title: 'Мій прогрес', meta: state.student?.goals ? `Мета: ${state.student.goals}` : 'Ваш шлях в англійській' })}
    <div class="s-progress stack stack--xl">
      <section class="card s-level" aria-labelledby="lvl-h">
        <div class="s-level__badge level level--${lvlCls}" aria-hidden="true">${lvl}</div>
        <div class="s-level__body">
          <p class="s-label" id="lvl-h">Ваш рівень · ${info.name}</p>
          <p class="s-level__text">${info.text}</p>
          <ol class="s-ladder" aria-label="Шкала рівнів CEFR">
            ${LADDER.map((l, i) => html`<li class="s-ladder__step${i < step ? ' s-ladder__step--done' : ''}${i === step ? ' s-ladder__step--current' : ''}"${i === step ? raw(' aria-current="step"') : ''}>${l}</li>`)}
          </ol>
        </div>
      </section>

      <section class="grid-2 s-stats" aria-label="Статистика">
        ${stat('star', 'Середня оцінка', avg == null ? '—' : fmtScore(avg), avg == null ? '' : `/ ${max}`, avg == null ? 'Поки немає оцінок' : `за ${graded.length} ${plural(graded.length, 'роботу', 'роботи', 'робіт')}`)}
        ${stat('clock', 'Здано вчасно', total ? Math.round((onTime / total) * 100) : '—', total ? '%' : '', total ? `${onTime} з ${total}` : 'Ще немає зданих робіт')}
        ${stat('checkCircle', 'Відвідуваність', attendance == null ? '—' : attendance, attendance == null ? '' : '%', attendance == null ? 'Після першого уроку' : (missed ? `${missed} ${plural(missed, 'пропуск', 'пропуски', 'пропусків')}` : 'Без пропусків'))}
        ${stat('calendar', 'Уроків пройдено', done, '', done ? 'Кожен — крок уперед' : 'Усе попереду')}
      </section>

      <div class="s-progress__cols">
        <section class="section" aria-labelledby="grades-h">
          <div class="section__head"><h2 class="h2" id="grades-h">Оцінені роботи</h2>${graded.length ? html`<a class="link-btn" href="#/s/tasks?tab=graded">Усі${raw(icon('chevronRight'))}</a>` : ''}</div>
          ${graded.length ? html`<ul class="list list--card s-bars">${graded.slice(0, 12).map((t) => {
            const pct = Math.max(0, Math.min(100, Math.round((Number(t.score) / max) * 100)));
            return html`<li><a class="s-bar" href="#/s/tasks/${t.id}">
              <span class="s-bar__top"><span class="s-bar__title"><span class="s-kind s-kind--${t.assignment?.kind || 'text'} s-kind--sm" aria-hidden="true">${raw(icon(kindOf(t).icon))}</span><span class="truncate">${t.assignment?.title || 'Завдання'}</span></span>
                <span class="s-bar__score num"><b>${fmtScore(t.score)}</b>/${max}</span></span>
              <span class="progress${pct >= 75 ? '' : ' progress--hl'}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${t.assignment?.title || 'Оцінка'}: ${fmtScore(t.score)} з ${max}" style="--value:${pct}%"><span class="progress__bar"></span></span>
              ${t.graded_at ? html`<span class="text-xs muted">${fmtDateShort(t.graded_at)}</span>` : ''}
            </a></li>`;
          })}</ul>`
          : emptyState({ icon: 'star', title: 'Оцінок ще немає', text: 'Здавайте завдання — оцінки й коментарі вчителя з’являться тут.', action: html`<a class="btn btn--secondary" href="#/s/tasks">До завдань</a>` })}
        </section>

        ${b && b.paid > 0 ? html`<section class="card s-balance" aria-labelledby="bal-h">
          <p class="s-label" id="bal-h">${raw(icon('wallet', 'icon--sm'))}Оплачені уроки</p>
          <p class="s-balance__value">${b.balance > 0 ? html`Оплачено уроків: залишилось <b>${b.balance}</b>` : b.balance === 0 ? 'Оплачені уроки використано' : html`Проведено понад оплату: <b>${-b.balance}</b>`}</p>
          <div class="progress" role="progressbar" aria-valuenow="${Math.min(b.used, b.paid)}" aria-valuemin="0" aria-valuemax="${b.paid}" aria-label="Використано оплачених уроків" style="--value:${Math.min(100, Math.round((b.used / b.paid) * 100))}%"><div class="progress__bar"></div></div>
          <p class="text-sm muted">Використано ${Math.min(b.used, b.paid)} з ${b.paid}. ${b.balance <= 1 ? 'Щодо наступної оплати вам підкаже вчитель.' : 'Це лише для довідки.'}</p>
        </section>` : ''}
      </div>
    </div>`);
}
