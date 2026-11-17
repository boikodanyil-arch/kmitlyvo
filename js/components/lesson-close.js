// Fast after-lesson flow (~10 seconds): outcome, topic, summary for the student, private note, next topic.
// export function openLessonClose({ lesson, onSaved })
import { getStudent, getLessonNote, updateLesson, saveLessonNote, updateStudent } from '../api.js';
import { esc, fmtFullDate, fmtTime } from '../utils.js';
import { icon, openModal, toast, toastError, setLoading } from '../ui.js';
import { navigate } from '../router.js';

const OUTCOMES = [
  ['done', 'Відбувся'],
  ['no_show', 'Неявка учня'],
  ['cancelled', 'Скасовано'],
];
const TOASTS = { done: 'Урок завершено', no_show: 'Неявку позначено', cancelled: 'Урок скасовано' };
const BALANCE = {
  done: 'Проведений урок списується з оплаченого балансу учня.',
  no_show: 'Неявка теж списується з оплаченого балансу учня.',
  cancelled: 'Скасований урок не списується з балансу.',
};

export function openLessonClose({ lesson, onSaved } = {}) {
  const fid = 'lc' + Math.random().toString(36).slice(2, 7);
  const end = Date.parse(lesson.starts_at) + (lesson.duration_min || 60) * 60000;
  const name = lesson.student?.full_name || '';
  const isClosed = ['done', 'no_show', 'cancelled'].includes(lesson.status);
  const { dialog, close } = openModal({
    title: isClosed ? 'Підсумок уроку' : 'Завершити урок',
    body: `<div class="lc-loading" aria-hidden="true">
        <span class="skeleton skeleton--block" style="height:44px"></span>
        <span class="skeleton skeleton--text" style="width:30%"></span><span class="skeleton skeleton--block" style="height:44px"></span>
        <span class="skeleton skeleton--text" style="width:40%"></span><span class="skeleton skeleton--block" style="height:96px"></span>
      </div><span class="sr-only" role="status">Завантаження…</span>`,
    foot: `<button class="btn btn--secondary" type="button" data-close>Скасувати</button>
      <button class="btn btn--primary" type="submit" form="${fid}" disabled><span>Зберегти підсумок</span></button>`,
  });
  const body = dialog.querySelector('.modal__body');
  const submitBtn = dialog.querySelector('[type="submit"]');

  (async () => {
    let student = lesson.student && 'next_topic' in lesson.student ? lesson.student : null;
    let note = '';
    try {
      [student, note] = await Promise.all([
        student ? Promise.resolve(student) : getStudent(lesson.student_id),
        getLessonNote(lesson.id),
      ]);
    } catch (err) {
      if (!dialog.isConnected) return;
      toastError(err);
      close();
      return;
    }
    if (!dialog.isConnected) return;
    render(student || {}, note || '');
  })();

  function render(student, note) {
    const initial = isClosed ? lesson.status : 'done';
    const nextTopic = student.next_topic && student.next_topic !== lesson.topic ? student.next_topic : '';
    body.innerHTML = `<form class="form lc-form" id="${fid}" novalidate>
      <p class="lc-who">${icon('user', 'icon--sm')}<span><b>${esc(name || student.full_name || 'Учень')}</b> · ${esc(fmtFullDate(lesson.starts_at))}, ${esc(fmtTime(lesson.starts_at))}–${esc(fmtTime(end))}</span></p>
      <div class="segmented segmented--block lc-outcome" role="radiogroup" aria-label="Як пройшов урок">
        ${OUTCOMES.map(([v, l]) => `<label><input type="radio" name="status" value="${v}"${v === initial ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}
      </div>
      <div class="field">
        <label class="label" for="${fid}-topic">Тема</label>
        <input class="input" id="${fid}-topic" name="topic" maxlength="200" value="${esc(lesson.topic || '')}" placeholder="Що проходили">
      </div>
      <div class="field" data-when="held">
        <label class="label lc-label" for="${fid}-sum">Підсумок для учня <span class="badge badge--info lc-vis">${icon('eye', 'icon--sm')}Бачить учень</span></label>
        <textarea class="textarea" id="${fid}-sum" name="student_summary" rows="3" maxlength="4000" placeholder="Що зробили, нові слова, на що звернути увагу">${esc(lesson.student_summary || '')}</textarea>
      </div>
      <div class="field">
        <label class="label lc-label" for="${fid}-note">Нотатка для себе <span class="badge badge--outline lc-vis">${icon('lock', 'icon--sm')}Бачите лише ви</span></label>
        <textarea class="textarea" id="${fid}-note" name="note" rows="2" maxlength="4000" placeholder="Що врахувати наступного разу">${esc(note)}</textarea>
      </div>
      <div class="field" data-when="notcancel">
        <label class="label" for="${fid}-next">Наступна тема <span class="label__opt">(необовʼязково)</span></label>
        <input class="input" id="${fid}-next" name="next_topic" maxlength="200" value="${esc(nextTopic)}" placeholder="Підставиться в наступний урок">
      </div>
      <label class="check" data-when="held"><input type="checkbox" name="homework" value="1"><span class="check__body">Задати домашнє зараз<span class="check__hint">Після збереження відкриємо створення завдання</span></span></label>
      <p class="lc-balance">${icon('wallet', 'icon--sm')}<span></span></p>
    </form>`;
    submitBtn.disabled = false;
    const form = body.querySelector('form');
    const origNote = note;
    const origNext = nextTopic;

    const sync = () => {
      const s = form.querySelector('[name="status"]:checked').value;
      form.querySelectorAll('[data-when="held"]').forEach((el) => { el.hidden = s !== 'done'; });
      form.querySelectorAll('[data-when="notcancel"]').forEach((el) => { el.hidden = s === 'cancelled'; });
      form.querySelector('.lc-balance span').textContent = BALANCE[s];
      submitBtn.querySelector('span').textContent = s === 'done' ? (isClosed ? 'Зберегти підсумок' : 'Завершити урок') : s === 'no_show' ? 'Позначити неявку' : 'Скасувати урок';
      submitBtn.classList.toggle('btn--danger', s === 'cancelled');
      submitBtn.classList.toggle('btn--primary', s !== 'cancelled');
    };
    form.addEventListener('change', (e) => { if (e.target.name === 'status') sync(); });
    sync();

    if (matchMedia('(pointer: fine)').matches) form.querySelector('[name="student_summary"]').focus();
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      const status = v.status;
      const patch = { status, topic: (v.topic || '').trim() };
      if (status === 'done') patch.student_summary = (v.student_summary || '').trim();
      const noteVal = (v.note || '').trim();
      const nextVal = (v.next_topic || '').trim();
      setLoading(submitBtn, true);
      try {
        const jobs = [updateLesson(lesson.id, patch)];
        if (noteVal !== origNote.trim()) jobs.push(saveLessonNote(lesson.id, noteVal));
        if (status !== 'cancelled' && nextVal && nextVal !== origNext && lesson.student_id) jobs.push(updateStudent(lesson.student_id, { next_topic: nextVal }));
        const [saved] = await Promise.all(jobs);
        const goHomework = status === 'done' && v.homework === '1';
        close();
        toast(isClosed && status === lesson.status ? 'Підсумок збережено' : TOASTS[status]);
        onSaved?.(saved);
        if (goHomework) navigate(`/t/assignments/new?student=${encodeURIComponent(lesson.student_id)}&lesson=${encodeURIComponent(lesson.id)}`);
      } catch (err) {
        toastError(err);
        if (submitBtn.isConnected) setLoading(submitBtn, false);
      }
    });
  }

  return { dialog, close };
}
