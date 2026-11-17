// Lesson detail: facts, join link, summary for the student, private note (autosave), homework, previous lesson, actions.
import { sb, must } from '../supabase.js';
import { getLesson, getLessonNote, saveLessonNote, updateLesson, deleteLesson, deleteSeriesFrom, balances } from '../api.js';
import { setTitle } from '../shell.js';
import { navigate } from '../router.js';
import { html, raw, esc, dayKey, fmtTime, fmtFullDate, fmtDateShort, fmtDate, fmtWeekday, plural, safeUrl, dueLabel } from '../utils.js';
import { icon, pageHeader, emptyState, errorState, levelBadge, lessonStatus, targetStatus, avatar, toast, toastError, confirmDialog, openModal, setLoading, on } from '../ui.js';
import { openLessonForm } from '../components/lesson-form.js';
import { openLessonClose } from '../components/lesson-close.js';

const KIND = { text: ['file', 'Текст'], file: ['paperclip', 'Файли'], link: ['link', 'Посилання'], quiz: ['check', 'Квіз'] };
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function listLessonHomework(lessonId) {
  return must(await sb.from('assignments')
    .select('id, title, kind, created_at, targets:assignment_targets(id, status, student_id, due_at, score)')
    .eq('lesson_id', lessonId).order('created_at'));
}
async function getPreviousLesson(lesson) {
  return must(await sb.from('lessons').select('id, starts_at, topic, student_summary, status')
    .eq('student_id', lesson.student_id).lt('starts_at', lesson.starts_at).eq('status', 'done')
    .order('starts_at', { ascending: false }).limit(1).maybeSingle());
}
async function countSeriesFrom(lesson) {
  const { count, error } = await sb.from('lessons').select('id', { count: 'exact', head: true })
    .eq('series_id', lesson.series_id).gte('starts_at', lesson.starts_at).eq('status', 'scheduled');
  if (error) return 1;
  return count || 1;
}

export default async function render({ view, params, alive }) {
  setTitle('Урок');
  const id = params.id;
  let lesson = null;

  // NB: `view` (#page) persists between routes; listeners go on this inner root, which navigation destroys.
  view.innerHTML = '<div class="ld-root"></div>';
  const root = view.firstElementChild;
  root.innerHTML = String(raw(`<div class="page-header"><div class="page-header__titles"><span class="skeleton skeleton--text" style="width:90px"></span><span class="skeleton skeleton--title" style="width:260px"></span><span class="skeleton skeleton--text" style="width:200px"></span></div></div>
    <div class="split" aria-hidden="true"><div class="stack"><span class="skeleton skeleton--block" style="height:180px"></span><span class="skeleton skeleton--block" style="height:120px"></span><span class="skeleton skeleton--block" style="height:140px"></span></div>
    <div class="stack"><span class="skeleton skeleton--block" style="height:160px"></span></div></div><span class="sr-only" role="status">Завантаження уроку…</span>`));

  async function load() {
    const l = await getLesson(id);
    if (!l) return { l: null };
    const [note, homework, prev, bal] = await Promise.all([
      getLessonNote(id).catch(() => ''),
      listLessonHomework(id).catch(() => []),
      getPreviousLesson(l).catch(() => null),
      balances([l.student_id]).catch(() => new Map()),
    ]);
    return { l, note, homework, prev, bal: bal.get(l.student_id) || null };
  }

  let data;
  try { data = await load(); } catch (err) {
    if (!alive()) return;
    root.innerHTML = String(errorState(err.message));
    return;
  }
  if (!alive()) return;
  if (!data.l) {
    setTitle('Урок не знайдено');
    root.innerHTML = String(emptyState({ icon: 'calendar', title: 'Урок не знайдено', text: 'Можливо, його видалили або він належить іншому вчителю.', action: html`<a class="btn btn--primary" href="#/t/calendar">До розкладу</a>` }));
    return;
  }

  async function refresh() {
    try { const d = await load(); if (!alive()) return; if (!d.l) { navigate('/t/calendar'); return; } data = d; paint(); } catch (err) { toastError(err); }
  }

  function paint() {
    lesson = data.l;
    const { note, homework, prev, bal } = data;
    const s = lesson.student || {};
    const name = s.full_name || 'Учень';
    const start = Date.parse(lesson.starts_at);
    const end = start + lesson.duration_min * 60000;
    const now = Date.now();
    const sched = lesson.status === 'scheduled';
    const live = sched && start <= now && now < end;
    const pastOpen = sched && end <= now;
    const joinUrl = safeUrl(lesson.meeting_url || s.meeting_url || '');
    const when = `${capital(fmtFullDate(start))} · ${fmtTime(start)}–${fmtTime(end)}`;
    setTitle(`Урок: ${name}`);

    const headActions = html`
      <button class="btn btn--secondary" type="button" data-action="edit">${raw(icon('edit'))}Редагувати</button>
      ${sched
        ? html`<button class="btn btn--primary" type="button" data-action="close">${raw(icon('checkCircle'))}Завершити урок</button>`
        : lesson.status === 'done' ? html`<button class="btn btn--soft" type="button" data-action="close">${raw(icon('edit'))}Змінити підсумок</button>` : ''}`;

    const balTxt = bal
      ? (bal.balance < 0 ? `Борг ${-bal.balance} ${plural(-bal.balance, 'урок', 'уроки', 'уроків')}` : `${bal.balance} ${plural(bal.balance, 'урок', 'уроки', 'уроків')}`)
      : '';

    const banner = live
      ? html`<div class="alert alert--success ld-banner">${raw(icon('clock'))}<div><p class="alert__title">Урок триває зараз</p>До кінця ${Math.round((end - now) / 60000)} хв.</div></div>`
      : pastOpen
        ? html`<div class="alert alert--warning ld-banner">${raw(icon('alert'))}<div><p class="alert__title">Урок уже минув</p>Позначте, як він пройшов: це займе 10 секунд і оновить баланс учня.</div></div>`
        : '';

    root.innerHTML = String(html`
      ${pageHeader({ title: name, meta: when, back: { href: `#/t/calendar?date=${dayKey(start)}`, label: 'Розклад' }, actions: headActions })}
      ${banner}
      <div class="split">
        <div class="stack stack--lg">
          <section class="card ld-main" aria-label="Деталі уроку">
            <div class="ld-who">
              ${avatar(name, 'lg')}
              <div class="ld-who__body">
                <div class="cluster ld-who__meta">${s.cefr_level ? levelBadge(s.cefr_level) : ''}${lessonStatus(lesson.status)}${lesson.series_id ? html`<span class="badge badge--outline">${raw(icon('refresh', 'icon--sm'))}Щотижнева серія</span>` : ''}</div>
                <a class="link-btn ld-who__link" href="#/t/students/${s.id || lesson.student_id}">Профіль учня${raw(icon('chevronRight'))}</a>
              </div>
            </div>
            <dl class="ld-facts">
              <div><dt>${raw(icon('calendar', 'icon--sm'))}Дата</dt><dd>${fmtDate(start)}<small>${fmtWeekday(start)}</small></dd></div>
              <div><dt>${raw(icon('clock', 'icon--sm'))}Час</dt><dd class="num">${fmtTime(start)}–${fmtTime(end)}<small>за Варшавою</small></dd></div>
              <div><dt>${raw(icon('target', 'icon--sm'))}Тривалість</dt><dd>${lesson.duration_min} хв<small>${lesson.duration_min >= 60 ? `${String(lesson.duration_min / 60).replace('.', ',')} год` : ''}</small></dd></div>
              ${balTxt ? html`<div><dt>${raw(icon('wallet', 'icon--sm'))}Баланс</dt><dd class="${bal.balance < 0 ? 'c-danger' : ''}">${balTxt}<small>${bal.balance < 0 ? 'потрібна оплата' : 'оплачено наперед'}</small></dd></div>` : ''}
            </dl>
            <div class="ld-topic">
              <p class="ld-label">Тема</p>
              ${lesson.topic ? html`<p class="ld-topic__text">${lesson.topic}</p>` : html`<p class="muted">Тему не вказано. <button class="link-btn" type="button" data-action="edit">Додати тему</button></p>`}
            </div>
            ${joinUrl && sched ? html`<div class="ld-join">
              <a class="btn ${live ? 'btn--primary' : 'btn--soft'} ld-join__btn" href="${joinUrl}" target="_blank" rel="noopener noreferrer">${raw(icon('video'))}Приєднатися</a>
              <span class="text-sm muted truncate">${new URL(joinUrl).host}</span></div>` : ''}
          </section>

          <section class="card" aria-labelledby="ld-sum-t">
            <div class="card__head"><div><p class="card__title" id="ld-sum-t">Підсумок для учня</p><p class="card__sub">Учень бачить його у своєму розкладі</p></div>
              <span class="badge badge--info">${raw(icon('eye', 'icon--sm'))}Бачить учень</span></div>
            ${lesson.student_summary
              ? html`<p class="pre-wrap ld-summary">${lesson.student_summary}</p>${lesson.status === 'done' ? html`<div><button class="link-btn" type="button" data-action="close">Змінити підсумок${raw(icon('chevronRight'))}</button></div>` : ''}`
              : sched
                ? html`<p class="muted">Підсумок з’явиться після завершення уроку: що зробили, нові слова, на що звернути увагу.</p>`
                : lesson.status === 'done'
                  ? html`<p class="muted">Підсумку ще немає.</p><div><button class="btn btn--soft btn--sm" type="button" data-action="close">${raw(icon('plus'))}Додати підсумок</button></div>`
                  : html`<p class="muted">Для ${lesson.status === 'cancelled' ? 'скасованого уроку' : 'неявки'} підсумок не потрібен.</p>`}
          </section>

          <section class="card" aria-labelledby="ld-note-t">
            <div class="card__head"><div><p class="card__title" id="ld-note-t"><label for="ld-note">Нотатка для себе</label></p><p class="card__sub">Учень її не бачить</p></div>
              <span class="badge badge--outline">${raw(icon('lock', 'icon--sm'))}Бачите лише ви</span></div>
            <textarea class="textarea ld-note" id="ld-note" rows="4" maxlength="4000" placeholder="Що врахувати наступного разу, які помилки повторюються…" aria-describedby="ld-note-status">${note}</textarea>
            <p class="ld-save hint" id="ld-note-status" aria-live="polite">${raw(icon('check', 'icon--sm'))}Зберігається автоматично</p>
          </section>

          <section class="section" aria-labelledby="ld-hw-t">
            <div class="section__head"><h2 class="h3" id="ld-hw-t">Домашнє з цього уроку</h2>
              ${homework.length ? html`<a class="link-btn" href="#/t/assignments/new?student=${lesson.student_id}&lesson=${lesson.id}">${raw(icon('plus'))}Задати ще</a>` : ''}</div>
            ${homework.length
              ? html`<ul class="list list--card">${homework.map((a) => {
                const t = (a.targets || []).find((x) => x.student_id === lesson.student_id) || (a.targets || [])[0];
                const [ic, kl] = KIND[a.kind] || KIND.text;
                return html`<li><a class="list-row" href="#/t/assignments/${a.id}">
                  <span class="list-row__lead">${raw(icon(ic))}</span>
                  <span class="list-row__body"><span class="list-row__title">${a.title}</span>
                    <span class="list-row__meta"><span>${kl}</span>${t ? html`${targetStatus(t)}<span>${dueLabel(t.due_at)}</span>` : html`<span>не призначено</span>`}</span></span>
                  <span class="list-row__trail">${raw(icon('chevronRight'))}</span></a></li>`;
              })}</ul>`
              : emptyState({ icon: 'clipboard', plain: true, title: 'Домашнього ще немає', text: 'Завдання, створені з цього уроку, зʼявляться тут і будуть привʼязані до нього.', action: html`<a class="btn btn--soft" href="#/t/assignments/new?student=${lesson.student_id}&lesson=${lesson.id}">${raw(icon('plus'))}Задати домашнє</a>` })}
          </section>
        </div>

        <aside class="stack stack--lg">
          <section class="card card--quiet" aria-labelledby="ld-prev-t">
            <p class="card__title" id="ld-prev-t">Попередній урок</p>
            ${prev
              ? html`<div class="stack stack--sm">
                  <a class="text-sm muted ld-prev__date" href="#/t/lessons/${prev.id}">${capital(fmtDateShort(prev.starts_at))}, ${fmtTime(prev.starts_at)}${raw(icon('chevronRight', 'icon--sm'))}</a>
                  ${prev.topic ? html`<p class="fw-600">${prev.topic}</p>` : ''}
                  ${prev.student_summary ? html`<p class="pre-wrap text-sm ld-prev__sum">${prev.student_summary}</p>` : html`<p class="text-sm muted">Без підсумку</p>`}
                </div>`
              : html`<p class="text-sm muted">Це перший проведений урок з ${name.split(' ')[0]}. Тут зʼявиться підсумок попереднього заняття, щоб швидко згадати контекст.</p>`}
          </section>

          <section class="card" aria-labelledby="ld-act-t">
            <p class="card__title" id="ld-act-t">Дії з уроком</p>
            <div class="stack stack--sm ld-actions">
              ${sched ? html`
                <button class="btn btn--ghost" type="button" data-action="noshow">${raw(icon('xCircle'))}Позначити неявку</button>
                <button class="btn btn--danger-ghost" type="button" data-action="cancel">${raw(icon('x'))}Скасувати урок</button>`
              : html`<button class="btn btn--ghost" type="button" data-action="reopen">${raw(icon('refresh'))}Повернути в заплановані</button>`}
              <button class="btn btn--danger-ghost" type="button" data-action="delete">${raw(icon('trash'))}Видалити урок</button>
            </div>
            <p class="hint ld-actions__hint">${raw(icon('wallet', 'icon--sm'))}Проведені уроки й неявки списуються з оплаченого балансу, скасовані — ні.</p>
          </section>
        </aside>
      </div>`);

    wireNote();
  }

  // ---------- private note autosave ----------
  function wireNote() {
    const ta = root.querySelector('#ld-note');
    const status = root.querySelector('#ld-note-status');
    let saved = ta.value; let timer = null; let inflight = null;
    const setStatus = (ic, text, cls = '') => { status.className = `ld-save hint ${cls}`; status.innerHTML = `${icon(ic, 'icon--sm')}${esc(text)}`; };
    const save = async () => {
      clearTimeout(timer);
      const val = ta.value.trim();
      if (val === saved.trim()) return;
      if (inflight) await inflight;
      setStatus('refresh', 'Зберігаємо…', 'ld-save--busy');
      inflight = saveLessonNote(id, val);
      try {
        await inflight; saved = val; data.note = val;
        if (status.isConnected) setStatus('check', `Збережено о ${fmtTime(Date.now())}`, 'ld-save--ok');
      } catch {
        if (status.isConnected) setStatus('alert', 'Не вдалося зберегти. Спробуємо ще раз, щойно ви щось змініте.', 'ld-save--err');
      } finally { inflight = null; }
    };
    ta.addEventListener('input', () => { clearTimeout(timer); setStatus('edit', 'Редагується…'); timer = setTimeout(save, 900); });
    ta.addEventListener('blur', save);
    window.addEventListener('hashchange', save, { once: true });
  }

  // ---------- actions ----------
  const afterChange = () => refresh();
  on(root, '[data-action="edit"]', () => openLessonForm({ lesson, onSaved: afterChange }));
  on(root, '[data-action="close"]', () => openLessonClose({ lesson, onSaved: afterChange }));
  on(root, '[data-action="cancel"]', async (e, el) => {
    const ok = await confirmDialog({ title: 'Скасувати урок?', text: `Урок з ${lesson.student?.full_name || 'учнем'} ${fmtDate(lesson.starts_at)} о ${fmtTime(lesson.starts_at)} залишиться в розкладі як скасований. З балансу він не спишеться.`, confirmLabel: 'Скасувати урок', danger: true });
    if (!ok) return;
    await mutate(el, { status: 'cancelled' }, 'Урок скасовано');
  });
  on(root, '[data-action="noshow"]', async (e, el) => {
    const ok = await confirmDialog({ title: 'Позначити неявку?', text: 'Учень не прийшов на урок. Неявка списується з оплаченого балансу, як і проведений урок.', confirmLabel: 'Позначити неявку' });
    if (!ok) return;
    await mutate(el, { status: 'no_show' }, 'Неявку позначено');
  });
  on(root, '[data-action="reopen"]', async (e, el) => mutate(el, { status: 'scheduled' }, 'Урок знову в розкладі'));
  async function mutate(el, patch, msg) {
    setLoading(el, true);
    try { await updateLesson(id, patch); if (!alive()) return; toast(msg); await refresh(); } catch (err) { toastError(err); if (el.isConnected) setLoading(el, false); }
  }

  on(root, '[data-action="delete"]', async (e, el) => {
    const back = `/t/calendar?date=${dayKey(lesson.starts_at)}`;
    const desc = `${lesson.student?.full_name || 'Урок'}, ${fmtDate(lesson.starts_at)} о ${fmtTime(lesson.starts_at)}`;
    let mode = null;
    const seriesCount = lesson.series_id && lesson.status === 'scheduled' ? await countSeriesFrom(lesson) : 1;
    if (seriesCount > 1) {
      mode = await new Promise((resolve) => {
        let choice = null;
        const { dialog } = openModal({
          title: 'Видалити урок із серії?',
          body: `<p>${esc(desc)}. Цей урок — частина щотижневої серії. Проведені уроки та історія залишаться.</p>`,
          foot: `<button class="btn btn--secondary" type="button" data-close>Не видаляти</button>
            <button class="btn btn--danger-ghost" type="button" data-mode="one">Лише цей урок</button>
            <button class="btn btn--danger" type="button" data-mode="series">Цей і всі наступні (${seriesCount})</button>`,
          onClose: () => resolve(choice),
        });
        dialog.addEventListener('click', (ev) => { const b = ev.target.closest('[data-mode]'); if (b) { choice = b.dataset.mode; dialog.close(); } });
      });
      if (!mode) return;
    } else {
      const ok = await confirmDialog({ title: 'Видалити урок?', text: `${desc}. Урок зникне з розкладу${lesson.status === 'done' || lesson.status === 'no_show' ? ' і більше не списуватиметься з балансу' : ''}. Нотатку буде видалено. Якщо урок просто не відбудеться, краще скасуйте його.`, confirmLabel: 'Видалити урок', danger: true });
      if (!ok) return;
      mode = 'one';
    }
    setLoading(el, true);
    try {
      if (mode === 'series') await deleteSeriesFrom(lesson.series_id, lesson.starts_at);
      else await deleteLesson(id);
      toast(mode === 'series' ? `Видалено ${seriesCount} ${plural(seriesCount, 'урок', 'уроки', 'уроків')}` : 'Урок видалено');
      navigate(back);
    } catch (err) { toastError(err); if (el.isConnected) setLoading(el, false); }
  });

  paint();
}
