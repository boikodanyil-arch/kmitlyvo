// Create / edit a lesson. Create supports a weekly series (N weeks, extra weekdays).
// export function openLessonForm({ lesson = null, studentId = null, date = null, time = null, onSaved })
import { sb, must } from '../supabase.js';
import { state, isAdmin, isSchool } from '../state.js';
import { listStudents, createLessons, updateLesson } from '../api.js';
import { html, raw, esc, addDays, fromZoned, dayKey, timeInputValue, todayKey, zonedParts, fmtTime, fmtDate, fmtDateShort, fmtWeekdayShort, plural, uid, safeUrl, debounce } from '../utils.js';
import { icon, openModal, toast, onSubmit, fieldError, emptyState } from '../ui.js';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const WD_ACC = ['понеділок', 'вівторок', 'середу', 'четвер', 'пʼятницю', 'суботу', 'неділю'];
const QUICK = [45, 60, 90];
const MAX_WEEKS = 26;

/** 1=Mon..7=Sun for a 'YYYY-MM-DD' calendar date */
const weekdayOf = (key) => { const d = new Date(`${key}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const pad = (n) => String(n).padStart(2, '0');

/** Next round hour in Warsaw time → { date, time }. Late evening → tomorrow 09:00. */
function nextSlot(dateKey) {
  const now = zonedParts(new Date());
  const today = todayKey();
  if (dateKey && dateKey !== today) return { date: dateKey, time: '10:00' };
  const h = now.h + 1;
  if (h > 21) return { date: dateKey || addDays(today, 1), time: '09:00' };
  return { date: today, time: `${pad(Math.max(h, 8))}:00` };
}

/** Occurrence dates for a weekly series: every selected weekday in [start, start + weeks*7). */
export function seriesDates(start, weeks, weekdays) {
  const set = new Set(weekdays);
  const out = [];
  for (let i = 0; i < weeks * 7; i++) {
    const k = addDays(start, i);
    if (set.has(weekdayOf(k))) out.push(k);
  }
  return out;
}

function studentLabel(s) {
  return s.status === 'paused' ? `${s.full_name} (пауза)` : s.full_name;
}

function studentOptions(students, selectedId) {
  const opt = (s) => `<option value="${esc(s.id)}"${s.id === selectedId ? ' selected' : ''}>${esc(studentLabel(s))}</option>`;
  // School admins see students of all teachers: group them by teacher.
  if (isSchool() && isAdmin()) {
    const groups = new Map();
    students.forEach((s) => {
      const key = s.teacher?.full_name || 'Без вчителя';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    if (groups.size > 1) {
      return [...groups.entries()].map(([t, list]) => `<optgroup label="${esc(t)}">${list.map(opt).join('')}</optgroup>`).join('');
    }
  }
  return students.map(opt).join('');
}

export function openLessonForm({ lesson = null, studentId = null, date = null, time = null, onSaved } = {}) {
  const editing = !!lesson;
  const fid = 'lf' + Math.random().toString(36).slice(2, 7);
  const { dialog, close } = openModal({
    title: editing ? 'Редагувати урок' : 'Новий урок',
    body: `<div class="lf-loading" aria-hidden="true">
        <span class="skeleton skeleton--text" style="width:40%"></span><span class="skeleton skeleton--block" style="height:44px"></span>
        <span class="skeleton skeleton--text" style="width:30%"></span><span class="skeleton skeleton--block" style="height:44px"></span>
        <span class="skeleton skeleton--text" style="width:35%"></span><span class="skeleton skeleton--block" style="height:44px"></span>
      </div><span class="sr-only" role="status">Завантаження…</span>`,
    foot: `<button class="btn btn--secondary" type="button" data-close>Скасувати</button>
      <button class="btn btn--primary" type="submit" form="${fid}" disabled><span>${editing ? 'Зберегти урок' : 'Запланувати урок'}</span></button>`,
  });
  const body = dialog.querySelector('.modal__body');
  const submitBtn = dialog.querySelector('[type="submit"]');

  (async () => {
    let students;
    try {
      students = await listStudents();
    } catch (err) {
      body.innerHTML = String(emptyState({ icon: 'alert', title: 'Не вдалося завантажити учнів', text: err.message, plain: true }));
      return;
    }
    if (!dialog.isConnected) return;
    // Active students; keep the edited lesson's / preselected student even if paused.
    const keep = lesson?.student_id || studentId;
    students = students.filter((s) => s.status === 'active' || s.id === keep);

    if (!students.length) {
      body.innerHTML = String(emptyState({
        icon: 'users', plain: true,
        title: 'Спершу додайте учня',
        text: 'Урок планується для конкретного учня. Додайте першого, і можна буде складати розклад.',
        action: html`<a class="btn btn--primary" href="#/t/students" data-close>${raw(icon('plus'))}Додати учня</a>`,
      }));
      submitBtn.hidden = true;
      return;
    }
    renderForm(students);
  })();

  function renderForm(students) {
    const byId = new Map(students.map((s) => [s.id, s]));
    const selId = lesson?.student_id || (byId.has(studentId) ? studentId : (students.length === 1 ? students[0].id : ''));
    const sel = byId.get(selId);
    const slot = nextSlot(date);
    const vDate = editing ? dayKey(lesson.starts_at) : (date || slot.date);
    const vTime = editing ? timeInputValue(lesson.starts_at) : (time || slot.time);
    const vDur = editing ? lesson.duration_min : (sel?.lesson_minutes || 60);
    const vTopic = editing ? (lesson.topic || '') : (sel?.next_topic || '');
    const vUrl = editing ? (lesson.meeting_url || '') : (sel?.meeting_url || '');

    body.innerHTML = `<form class="form" id="${fid}" novalidate>
      <div class="field">
        <label class="label" for="${fid}-st">Учень</label>
        <select class="select" id="${fid}-st" name="student_id" required>
          ${selId ? '' : '<option value="" selected disabled>Оберіть учня</option>'}
          ${studentOptions(students, selId)}
        </select>
      </div>
      <div class="form__row lf-when">
        <div class="field"><label class="label" for="${fid}-d">Дата</label>
          <input class="input" id="${fid}-d" name="date" type="date" required value="${esc(vDate)}"></div>
        <div class="field"><label class="label" for="${fid}-t">Час</label>
          <input class="input" id="${fid}-t" name="time" type="time" required step="300" value="${esc(vTime)}"></div>
      </div>
      <div class="field">
        <label class="label" for="${fid}-dur">Тривалість</label>
        <div class="lf-duration">
          <div class="input-wrap lf-dur-input"><input class="input num" id="${fid}-dur" name="duration_min" type="number" inputmode="numeric" min="15" max="240" step="5" required value="${esc(vDur)}" aria-describedby="${fid}-dur-u"><span class="lf-unit" id="${fid}-dur-u">хв</span></div>
          <div class="chips" role="group" aria-label="Швидкий вибір тривалості">
            ${QUICK.map((m) => `<button type="button" class="chip" data-dur="${m}" aria-pressed="${Number(vDur) === m}">${m} хв</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="field">
        <label class="label" for="${fid}-topic">Тема <span class="label__opt">(необовʼязково)</span></label>
        <input class="input" id="${fid}-topic" name="topic" maxlength="200" value="${esc(vTopic)}" placeholder="Наприклад: Present Perfect">
      </div>
      <div class="field">
        <label class="label" for="${fid}-url">Посилання на урок <span class="label__opt">(необовʼязково)</span></label>
        <div class="input-wrap">${icon('video')}<input class="input" id="${fid}-url" name="meeting_url" type="url" inputmode="url" maxlength="500" value="${esc(vUrl)}" placeholder="https://meet.google.com/…"></div>
      </div>
      ${editing ? (lesson.series_id ? `<p class="hint lf-note">${icon('info', 'icon--sm')}Зміни стосуються лише цього уроку серії.</p>` : '') : `
      <fieldset class="fieldset lf-repeat">
        <legend>Повторення</legend>
        <div class="segmented segmented--block" role="radiogroup" aria-label="Повторення">
          <label><input type="radio" name="repeat" value="once" checked><span>Один раз</span></label>
          <label><input type="radio" name="repeat" value="weekly"><span>${icon('refresh', 'icon--sm')}Щотижня</span></label>
        </div>
        <div class="lf-weekly" hidden>
          <div class="field">
            <span class="label" id="${fid}-wd-l">Дні тижня</span>
            <div class="lf-weekdays" role="group" aria-labelledby="${fid}-wd-l">
              ${WD.map((w, i) => `<button type="button" class="lf-wd" data-wd="${i + 1}" aria-pressed="false" aria-label="${WD_ACC[i]}">${w}</button>`).join('')}
            </div>
          </div>
          <div class="field lf-weeks">
            <label class="label" for="${fid}-wk">Кількість тижнів</label>
            <div class="lf-stepper">
              <button type="button" class="btn btn--secondary btn--icon" data-step="-1" aria-label="Менше тижнів">${icon('minus')}</button>
              <input class="input num" id="${fid}-wk" name="weeks" type="number" inputmode="numeric" min="1" max="${MAX_WEEKS}" value="8">
              <button type="button" class="btn btn--secondary btn--icon" data-step="1" aria-label="Більше тижнів">${icon('plus')}</button>
            </div>
          </div>
          <p class="lf-summary" aria-live="polite"></p>
        </div>
      </fieldset>`}
      <div class="lf-conflict" aria-live="polite"></div>
    </form>`;
    submitBtn.disabled = false;

    const form = body.querySelector('form');
    const f = (n) => form.elements[n];
    const touched = new Set();
    ['duration_min', 'topic', 'meeting_url'].forEach((n) => f(n).addEventListener('input', () => touched.add(n)));

    // ---- duration chips ----
    const syncChips = () => form.querySelectorAll('[data-dur]').forEach((c) => c.setAttribute('aria-pressed', String(Number(f('duration_min').value) === Number(c.dataset.dur))));
    form.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-dur]');
      if (chip) { f('duration_min').value = chip.dataset.dur; touched.add('duration_min'); syncChips(); checkConflicts(); }
    });
    f('duration_min').addEventListener('input', syncChips);

    // ---- student change → prefill untouched fields ----
    f('student_id').addEventListener('change', () => {
      const s = byId.get(f('student_id').value);
      fieldError(form, 'student_id', null);
      if (!s || editing) { checkConflicts(); return; }
      if (!touched.has('duration_min') && s.lesson_minutes) { f('duration_min').value = s.lesson_minutes; syncChips(); }
      if (!touched.has('topic')) f('topic').value = s.next_topic || '';
      if (!touched.has('meeting_url')) f('meeting_url').value = s.meeting_url || '';
      checkConflicts();
    });

    // ---- weekly repeat ----
    const weekly = form.querySelector('.lf-weekly');
    let extraDays = new Set();
    const baseWd = () => (f('date').value ? weekdayOf(f('date').value) : null);
    const selectedDays = () => { const b = baseWd(); const s = new Set(extraDays); if (b) s.add(b); return [...s].sort(); };
    const isWeekly = () => !editing && form.querySelector('[name="repeat"]:checked')?.value === 'weekly';
    const weeks = () => Math.min(MAX_WEEKS, Math.max(1, parseInt(f('weeks')?.value, 10) || 1));

    function occurrences() {
      const d = f('date').value;
      if (!d) return [];
      return isWeekly() ? seriesDates(d, weeks(), selectedDays()) : [d];
    }
    function syncWeekly() {
      if (editing) return;
      weekly.hidden = !isWeekly();
      const b = baseWd();
      form.querySelectorAll('.lf-wd').forEach((btn) => {
        const wd = Number(btn.dataset.wd);
        const isBase = wd === b;
        btn.setAttribute('aria-pressed', String(isBase || extraDays.has(wd)));
        btn.classList.toggle('lf-wd--base', isBase);
        btn.title = isBase ? 'День першого уроку' : '';
      });
      if (!isWeekly()) return;
      const dates = occurrences();
      const days = selectedDays().map((w) => WD[w - 1].toLowerCase());
      const daysTxt = days.length > 1 ? `${days.slice(0, -1).join(', ')} і ${days[days.length - 1]}` : days[0] || '';
      const t = f('time').value || '';
      form.querySelector('.lf-summary').innerHTML = dates.length
        ? `${icon('calendar', 'icon--sm')}<span><b>${dates.length} ${plural(dates.length, 'урок', 'уроки', 'уроків')}</b>: ${esc(daysTxt)} о ${esc(t)}, з ${esc(fmtDate(fromZoned(dates[0], '12:00')))} до ${esc(fmtDate(fromZoned(dates[dates.length - 1], '12:00')))}</span>`
        : '';
      submitBtn.querySelector('span').textContent = dates.length > 1 ? `Запланувати ${dates.length} ${plural(dates.length, 'урок', 'уроки', 'уроків')}` : 'Запланувати урок';
    }
    if (!editing) {
      form.querySelectorAll('[name="repeat"]').forEach((r) => r.addEventListener('change', () => { syncWeekly(); checkConflicts(); }));
      form.querySelector('.lf-weekdays').addEventListener('click', (e) => {
        const btn = e.target.closest('.lf-wd');
        if (!btn) return;
        const wd = Number(btn.dataset.wd);
        if (wd === baseWd()) return; // the first lesson's weekday is always included
        if (extraDays.has(wd)) extraDays.delete(wd); else extraDays.add(wd);
        syncWeekly(); checkConflicts();
      });
      form.querySelector('.lf-stepper').addEventListener('click', (e) => {
        const b = e.target.closest('[data-step]');
        if (!b) return;
        f('weeks').value = Math.min(MAX_WEEKS, Math.max(1, weeks() + Number(b.dataset.step)));
        syncWeekly(); checkConflicts();
      });
      f('weeks').addEventListener('input', () => { syncWeekly(); checkConflicts(); });
      f('weeks').addEventListener('blur', () => { f('weeks').value = weeks(); syncWeekly(); });
    }
    ['date', 'time'].forEach((n) => f(n).addEventListener('change', () => { fieldError(form, n, null); syncWeekly(); checkConflicts(); }));
    f('duration_min').addEventListener('change', () => checkConflicts());
    syncWeekly();

    // ---- conflict warning (not a block) ----
    const conflictBox = form.querySelector('.lf-conflict');
    let checkTicket = 0;
    const teacherFor = () => byId.get(f('student_id').value)?.teacher_id || lesson?.teacher_id || state.user?.id;
    const checkConflicts = debounce(async () => {
      const ticket = ++checkTicket;
      const dates = occurrences();
      const t = f('time').value;
      const dur = Number(f('duration_min').value) || 0;
      if (!dates.length || !t || !dur) { conflictBox.innerHTML = ''; return; }
      const slots = dates.map((d) => { const s = fromZoned(d, t).getTime(); return { s, e: s + dur * 60000 }; });
      const from = new Date(slots[0].s - 6 * 3600000).toISOString();
      const to = new Date(slots[slots.length - 1].e).toISOString();
      try {
        let q = sb.from('lessons').select('id, starts_at, duration_min, student:students(full_name)')
          .eq('space_id', state.space.id).eq('teacher_id', teacherFor()).neq('status', 'cancelled')
          .gte('starts_at', from).lt('starts_at', to).order('starts_at').limit(500);
        if (editing) q = q.neq('id', lesson.id);
        const rows = must(await q);
        if (ticket !== checkTicket || !form.isConnected) return;
        const hits = rows.filter((r) => {
          const rs = Date.parse(r.starts_at); const re = rs + r.duration_min * 60000;
          return slots.some((x) => x.s < re && rs < x.e);
        });
        if (!hits.length) { conflictBox.innerHTML = ''; return; }
        const items = hits.slice(0, 3).map((r) => `<li>${esc(r.student?.full_name || 'Урок')}, ${esc(fmtWeekdayShort(r.starts_at))} ${esc(fmtDateShort(r.starts_at))}, ${esc(fmtTime(r.starts_at))}–${esc(fmtTime(Date.parse(r.starts_at) + r.duration_min * 60000))}</li>`).join('');
        const more = hits.length > 3 ? `<li>і ще ${hits.length - 3}</li>` : '';
        conflictBox.innerHTML = `<div class="alert alert--warning">${icon('alert')}<div><p class="alert__title">${hits.length === 1 ? 'У цей час уже є урок' : `Перетин із ${hits.length} ${plural(hits.length, 'уроком', 'уроками', 'уроками')}`}</p><ul class="lf-conflict__list">${items}${more}</ul>Зберегти все одно можна.</div></div>`;
      } catch { /* the warning is best-effort */ }
    }, 300);
    checkConflicts();

    // ---- submit ----
    onSubmit(form, async (v) => {
      let bad = false;
      const s = byId.get(v.student_id);
      if (!s) { fieldError(form, 'student_id', 'Оберіть учня'); bad = true; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) { fieldError(form, 'date', 'Вкажіть дату'); bad = true; }
      if (!/^\d{2}:\d{2}$/.test(v.time)) { fieldError(form, 'time', 'Вкажіть час'); bad = true; }
      const dur = parseInt(v.duration_min, 10);
      if (!(dur >= 15 && dur <= 240)) { fieldError(form, 'duration_min', 'Від 15 до 240 хвилин'); bad = true; }
      const url = v.meeting_url ? safeUrl(v.meeting_url) : '';
      if (v.meeting_url && !url) { fieldError(form, 'meeting_url', 'Посилання має починатися з https://'); bad = true; }
      if (bad) { form.querySelector('[aria-invalid]')?.focus(); return; }

      const base = { student_id: s.id, duration_min: dur, topic: v.topic || '', meeting_url: url || '' };
      if (editing) {
        const saved = await updateLesson(lesson.id, { ...base, starts_at: fromZoned(v.date, v.time).toISOString() });
        close();
        toast('Урок збережено');
        onSaved?.(saved);
        return;
      }
      const dates = occurrences();
      const seriesId = dates.length > 1 ? uid() : null;
      const rows = dates.map((d) => ({ ...base, teacher_id: s.teacher_id || state.user.id, series_id: seriesId, starts_at: fromZoned(d, v.time).toISOString() }));
      const saved = await createLessons(rows);
      close();
      toast(rows.length > 1 ? `Заплановано ${rows.length} ${plural(rows.length, 'урок', 'уроки', 'уроків')}` : 'Урок збережено',
        rows.length > 1 ? { text: `${s.full_name}: до ${fmtDate(fromZoned(dates[dates.length - 1], '12:00'))}` } : {});
      onSaved?.(saved);
    });
  }

  return { dialog, close };
}
