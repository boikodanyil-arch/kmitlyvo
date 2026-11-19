// #/t/assignments/:id: assignment detail: content preview, recipients, edit, add/remove students.
import * as api from '../api.js';
import { sb, must } from '../supabase.js';
import { state, isSchool } from '../state.js';
import { setTitle } from '../shell.js';
import { navigate } from '../router.js';
import { html, raw, plural, fmtDate, fmtTime, fmtDateShort, dueLabel, isOverdue, safeUrl, todayKey, addDays, fromZoned, dayKey, timeInputValue } from '../utils.js';
import { pageHeader, emptyState, errorState, toast, toastError, on, avatar, levelBadge, targetStatus, openModal, confirmDialog, setLoading, fieldError, clearErrors, formValues } from '../ui.js';
import {
  ic, kindOf, kindTag, scoreText, scale, DONE, filesBlock, hydrateFiles, bindLightbox, quizBlock,
  studentPickerHtml, bindStudentPicker, confirmDeleteAssignment,
} from './t-assignments.js';

async function listAssignmentTargets(assignmentId) {
  return must(await sb.from('assignment_targets')
    .select('*, student:students(id, full_name, cefr_level, teacher_id, status)')
    .eq('assignment_id', assignmentId));
}
const ORDER = { submitted: 0, returned: 1, assigned: 2, graded: 3 };
const sortTargets = (ts) => ts.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (a.student?.full_name || '').localeCompare(b.student?.full_name || '', 'uk'));

export default async function render({ view, params, alive }) {
  setTitle('Завдання');
  const back = { href: '#/t/assignments', label: 'Завдання' };
  view.innerHTML = String(html`${pageHeader({ title: html`<span class="skeleton skeleton--title" style="width:280px;display:inline-block"></span>`, back })}
    <div class="split"><div class="card"><span class="skeleton skeleton--text" style="width:40%"></span><span class="skeleton skeleton--block" style="height:180px;margin-top:16px"></span></div>
    <div class="card"><span class="skeleton skeleton--text" style="width:60%"></span><span class="skeleton skeleton--block" style="height:120px;margin-top:16px"></span></div></div>
    <span class="sr-only" role="status">Завантаження…</span>`);

  let a; let targets; let quiz = [];
  try {
    [a, targets] = await Promise.all([api.getAssignment(params.id), listAssignmentTargets(params.id)]);
    if (a?.kind === 'quiz') quiz = await api.getQuiz(a.id, { withKeys: true });
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(html`${pageHeader({ title: 'Завдання', back })}${errorState(err.message)}`);
    return;
  }
  if (!alive()) return;
  if (!a) {
    setTitle('Завдання не знайдено');
    view.innerHTML = String(html`${pageHeader({ title: 'Завдання не знайдено', back })}${emptyState({ icon: 'search', title: 'Такого завдання немає', text: 'Можливо, його видалили.', action: html`<a class="btn btn--primary" href="#/t/assignments">До завдань</a>` })}`);
    return;
  }
  sortTargets(targets);

  function headerHtml() {
    return pageHeader({
      title: a.title,
      back,
      meta: html`<span class="tk-meta">${kindTag(a.kind)}<span>Створено ${fmtDate(a.created_at)}</span>${a.lesson_id ? html`<a href="#/t/lessons/${a.lesson_id}">${ic('calendar')}До уроку</a>` : ''}${a.is_demo ? html`<span class="badge badge--outline">приклад</span>` : ''}</span>`,
      actions: html`
        <button class="btn btn--secondary" type="button" data-action="edit">${ic('edit')}Редагувати</button>
        <a class="btn btn--secondary" href="#/t/assignments/new?from=${a.id}">${ic('copy')}Дублювати</a>
        <button class="btn btn--danger-ghost btn--icon" type="button" data-action="delete" aria-label="Видалити завдання" title="Видалити завдання">${ic('trash')}</button>`,
    });
  }

  function contentHtml() {
    const link = safeUrl(a.link_url);
    return html`<section class="card tk-content" aria-labelledby="c-h">
      <div class="card__head"><h2 class="h3" id="c-h">Зміст</h2></div>
      <div class="stack">
        ${a.instructions ? html`<p class="pre-wrap tk-prose">${a.instructions}</p>` : html`<p class="muted text-sm">Без інструкції.</p>`}
        ${link ? html`<a class="tk-linkcard" href="${link}" target="_blank" rel="noopener noreferrer">${ic('link')}<span class="truncate">${link.replace(/^https?:\/\//, '')}</span>${ic('external', 'icon--sm')}</a>` : ''}
        ${a.attachments?.length ? html`<div class="stack stack--sm"><p class="label">Матеріали</p>${filesBlock(a.attachments)}</div>` : ''}
        ${a.kind === 'textbook' && a.textbook_id ? html`<a class="tk-linkcard" href="#/t/books/${a.textbook_id}?p=${a.page_from || 1}">${ic('book')}<span class="truncate">Відкрити сторінки в підручнику</span>${ic('chevronRight', 'icon--sm')}</a>` : ''}
        ${a.kind === 'quiz' ? html`<div class="stack stack--sm"><p class="label">${quiz.length} ${plural(quiz.length, 'питання', 'питання', 'питань')} · правильні відповіді позначено</p>${quizBlock(quiz)}</div>` : ''}
      </div>
    </section>`;
  }

  function recipientsHtml() {
    const total = targets.length;
    const done = targets.filter((t) => DONE.includes(t.status)).length;
    const review = targets.filter((t) => t.status === 'submitted').length;
    const graded = targets.filter((t) => t.status === 'graded' && t.score != null);
    const avg = graded.length ? graded.reduce((s, t) => s + Number(t.score), 0) / graded.length : null;
    const overdue = targets.filter(isOverdue).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return html`<section class="stack" aria-labelledby="r-h">
      <div class="section__head"><h2 class="h3" id="r-h">Учні${total ? html` <span class="muted fw-600">· ${total}</span>` : ''}</h2>
        <button class="btn btn--primary btn--sm" type="button" data-action="add">${ic('plus')}Додати учнів</button></div>
      ${total ? html`
        <div class="card tk-progresscard">
          <div class="progress-labeled">
            <div class="progress-labeled__row"><span><strong class="num">${done} з ${total}</strong> ${plural(total, 'здав', 'здали', 'здали')}</span><span class="muted num">${pct}%</span></div>
            <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Прогрес здачі" style="--value:${pct}%"><div class="progress__bar"></div></div>
          </div>
          <div class="tk-stats">
            ${review ? html`<a class="badge badge--hl badge--lg" href="#/t/review">${ic('inbox')}${review} на перевірку</a>` : ''}
            <span class="badge badge--lg badge--success">${ic('check')}${graded.length} оцінено</span>
            ${avg != null ? html`<span class="badge badge--lg badge--outline">Середній бал ${avg.toLocaleString('uk-UA', { maximumFractionDigits: 1 })} / ${scale()}</span>` : ''}
            ${overdue ? html`<span class="badge badge--lg badge--danger">${ic('clock')}${overdue} прострочено</span>` : ''}
          </div>
        </div>
        <div class="table-wrap table-wrap--stack">
          <table class="table table--stack tk-rtable">
            <thead><tr><th>Учень</th><th>Статус</th><th class="num">Оцінка</th><th>Дедлайн</th><th class="table__actions"><span class="sr-only">Дії</span></th></tr></thead>
            <tbody>${targets.map((t) => html`<tr data-tid="${t.id}">
              <td class="table__primary"><a class="tk-who" href="#/t/review/${t.id}">${avatar(t.student?.full_name || '?', 'sm')}<span class="tk-who__name">${t.student?.full_name || 'Учень'}</span>${levelBadge(t.student?.cefr_level)}</a></td>
              <td data-label="Статус">${targetStatus(t)}</td>
              <td data-label="Оцінка" class="num${t.score == null ? ' tk-hide-m' : ''}">${t.score != null ? scoreText(t.score) : html`<span class="muted">—</span>`}</td>
              <td data-label="Дедлайн"><span class="${isOverdue(t) ? 'c-danger' : ''}">${t.due_at ? `${fmtDateShort(t.due_at)}, ${fmtTime(t.due_at)}` : 'без дедлайну'}</span></td>
              <td class="table__actions"><div class="cluster" style="flex-wrap:nowrap;justify-content:flex-end">
                ${t.status === 'submitted' ? html`<a class="btn btn--soft btn--sm" href="#/t/review/${t.id}">Перевірити</a>` : ''}
                <button class="btn btn--ghost btn--icon btn--sm tk-danger-ico" type="button" data-action="remove" aria-label="${`Прибрати ${t.student?.full_name || 'учня'} із завдання`}" title="Прибрати учня">${ic('x')}</button>
              </div></td>
            </tr>`)}</tbody>
          </table>
        </div>`
        : emptyState({ icon: 'users', title: 'Завдання ще нікому не призначене', text: 'Додайте учнів — вони одразу побачать його у своєму кабінеті.', action: '' })}
    </section>`;
  }

  function draw() {
    setTitle(a.title);
    view.classList.add('tk-page');
    view.innerHTML = String(html`${headerHtml()}
      <div class="split tk-detail">
        <div data-recipients>${recipientsHtml()}</div>
        <div data-content>${contentHtml()}</div>
      </div>`);
    hydrateFiles(view);
  }
  const redrawRecipients = () => { const box = view.querySelector('[data-recipients]'); if (box) box.innerHTML = String(recipientsHtml()); };
  draw();
  bindLightbox(view);

  // ---------------- edit ----------------
  on(view, '[data-action="edit"]', () => {
    const { dialog, close } = openModal({
      title: 'Редагувати завдання',
      body: String(html`<form class="form" id="ed-form" novalidate>
        <div class="field"><label class="label" for="ed-title">Назва</label><input class="input" id="ed-title" name="title" maxlength="200" required value="${a.title}"></div>
        <div class="field"><label class="label" for="ed-instr">Інструкція</label><textarea class="textarea" id="ed-instr" name="instructions" rows="6" maxlength="5000">${a.instructions || ''}</textarea></div>
        ${a.kind === 'link' ? html`<div class="field"><label class="label" for="ed-link">Посилання</label><input class="input" id="ed-link" name="link_url" type="url" inputmode="url" value="${a.link_url || ''}" placeholder="https://"></div>` : ''}
        ${a.kind === 'quiz' ? html`<p class="hint">${ic('info', 'icon--sm')} Щоб змінити питання квізу, створіть копію завдання — так результати учнів, які вже пройшли тест, не зіб’ються.</p>` : ''}
      </form>`),
      foot: '<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="submit" form="ed-form">Зберегти</button>',
    });
    const form = dialog.querySelector('#ed-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const v = formValues(form);
      let bad = false;
      if (!v.title) { fieldError(form, 'title', 'Дайте завданню назву.'); bad = true; }
      if (a.kind === 'link') {
        if (!v.link_url) { fieldError(form, 'link_url', 'Додайте посилання.'); bad = true; } else if (!/^https?:\/\//i.test(v.link_url) || !safeUrl(v.link_url)) { fieldError(form, 'link_url', 'Посилання має починатися з http:// або https://'); bad = true; }
      }
      if (bad) { form.querySelector('[aria-invalid]')?.focus(); return; }
      const btn = dialog.querySelector('[type="submit"]');
      setLoading(btn, true);
      try {
        const patch = { title: v.title, instructions: v.instructions };
        if (a.kind === 'link') patch.link_url = safeUrl(v.link_url);
        Object.assign(a, await api.updateAssignment(a.id, patch));
        close();
        toast('Завдання збережено');
        if (alive()) draw();
      } catch (err) { toastError(err); setLoading(btn, false); }
    });
  });

  // ---------------- add students ----------------
  on(view, '[data-action="add"]', async (e, trigger) => {
    setLoading(trigger, true);
    let all;
    try { all = await api.listStudents(); } catch (err) { toastError(err); setLoading(trigger, false); return; } finally { if (trigger.isConnected) setLoading(trigger, false); }
    const have = new Set(targets.map((t) => t.student_id));
    const avail = all.filter((s) => s.status === 'active' && !have.has(s.id));
    // default deadline: the most common one among current targets, else +7 days 20:00
    const dues = targets.map((t) => t.due_at).filter(Boolean);
    const common = dues.sort((x, y) => dues.filter((d) => d === y).length - dues.filter((d) => d === x).length)[0];
    const futureCommon = common && new Date(common) > new Date() ? common : null;
    const dDate = futureCommon ? dayKey(futureCommon) : addDays(todayKey(), 7);
    const dTime = futureCommon ? timeInputValue(futureCommon) : '20:00';
    const noDue = targets.length > 0 && !dues.length;
    const selected = new Set();
    const { dialog, close } = openModal({
      title: 'Додати учнів',
      wide: true,
      body: avail.length ? String(html`<form class="form" id="add-form" novalidate>
          ${studentPickerHtml(avail, { idPrefix: 'add', showTeacher: isSchool() })}
          <fieldset class="fieldset"><legend>Дедлайн</legend>
            <div class="form__row" data-add-due ${noDue ? raw('hidden') : ''}>
              <div class="field"><label class="label" for="add-date">Дата</label><input class="input" id="add-date" name="date" type="date" min="${todayKey()}" value="${dDate}"></div>
              <div class="field"><label class="label" for="add-time">Час</label><input class="input" id="add-time" name="time" type="time" value="${dTime}" step="300"></div>
            </div>
            <label class="check"><input type="checkbox" name="nodue" ${noDue ? raw('checked') : ''}><span class="check__body">Без дедлайну</span></label>
          </fieldset>
        </form>`)
        : String(emptyState({ plain: true, icon: 'users', title: all.length ? 'Усі активні учні вже отримали це завдання' : 'У вас ще немає учнів', text: all.length ? '' : 'Додайте учня, і зможете призначити йому завдання.', action: html`<a class="btn btn--secondary" href="#/t/students" data-close>${ic('users')}До учнів</a>` })),
      foot: avail.length ? '<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn btn--primary" type="submit" form="add-form" data-add-submit disabled>Призначити</button>' : '',
    });
    if (!avail.length) return;
    const form = dialog.querySelector('#add-form');
    const submit = dialog.querySelector('[data-add-submit]');
    bindStudentPicker(dialog, selected, () => {
      const n = selected.size;
      submit.disabled = !n;
      submit.textContent = n ? `Призначити ${n} ${plural(n, 'учню', 'учням', 'учням')}` : 'Призначити';
    });
    form.nodue.addEventListener('change', () => { dialog.querySelector('[data-add-due]').hidden = form.nodue.checked; });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      clearErrors(form);
      if (!selected.size) return;
      let due = null;
      if (!form.nodue.checked) {
        if (!form.date.value) { fieldError(form, 'date', 'Оберіть дату.'); return; }
        due = fromZoned(form.date.value, form.time.value || '20:00');
        if (due < new Date()) { fieldError(form, 'date', 'Дедлайн уже минув.'); return; }
        due = due.toISOString();
      }
      setLoading(submit, true);
      try {
        if (a.kind === 'textbook' && a.textbook_id) { const { ensureAttached } = await import('../books-api.js'); for (const sid of selected) await ensureAttached(sid, a.textbook_id); }
        await api.addTargets(a.id, [...selected].map((sid) => ({ student_id: sid, due_at: due })));
        const n = selected.size;
        targets = sortTargets(await listAssignmentTargets(a.id));
        close();
        toast(`Завдання призначено ${n} ${plural(n, 'учню', 'учням', 'учням')}`);
        if (alive()) redrawRecipients();
      } catch (err) { toastError(err); setLoading(submit, false); }
    });
  });

  // ---------------- remove recipient ----------------
  on(view, '[data-action="remove"]', async (e, btn) => {
    const id = btn.closest('[data-tid]').dataset.tid;
    const t = targets.find((x) => x.id === id);
    const name = t?.student?.full_name || 'учня';
    const hasWork = t && t.status !== 'assigned';
    const ok = await confirmDialog({
      title: `Прибрати ${name} із завдання?`,
      text: hasWork ? 'Учень більше не бачитиме завдання, а його відповідь і оцінку буде видалено.' : 'Учень більше не бачитиме це завдання.',
      confirmLabel: 'Прибрати учня',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTarget(id);
      targets = targets.filter((x) => x.id !== id);
      toast(`${name} більше не отримує це завдання`);
      if (alive()) redrawRecipients();
    } catch (err) { toastError(err); }
  });

  // ---------------- delete ----------------
  on(view, '[data-action="delete"]', async () => {
    try {
      if (await confirmDeleteAssignment({ ...a, targets })) navigate('/t/assignments');
    } catch (err) { toastError(err); }
  });
}
