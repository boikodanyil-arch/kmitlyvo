// #/t/review/:id: grading screen. Built for speed: Ctrl/Cmd+Enter grades and opens the next work.
import * as api from '../api.js';
import { state } from '../state.js';
import { setTitle, setCount } from '../shell.js';
import { navigate } from '../router.js';
import { html, raw, plural, fmtDate, fmtTime, fmtDateShort, relDay, dueLabel, isOverdue, safeUrl } from '../utils.js';
import { pageHeader, emptyState, errorState, toast, toastError, on, avatar, levelBadge, targetStatus, setLoading, fieldError, clearErrors } from '../ui.js';
import { ic, kindOf, kindTag, scale, scoreText, filesBlock, hydrateFiles, bindLightbox, quizBlock } from './t-assignments.js';
import { loadInbox, queueOf, reviewScope } from './t-review.js';

const PHRASES = ['Чудова робота!', 'Молодець, є прогрес.', 'Зверни увагу на часи.', 'Перевір артиклі.', 'Перепиши, будь ласка, з виправленнями.'];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Session counter for the celebratory message
let gradedThisSession = 0;

function scoreChips(max) {
  if (max <= 12) return Array.from({ length: Math.min(max + 1, 7) }, (_, i) => max - i);
  const step = max >= 50 ? 10 : Math.ceil(max / 10);
  return Array.from({ length: 6 }, (_, i) => max - i * step).filter((x) => x >= 0);
}
const wordCount = (s) => (String(s || '').trim().match(/[\p{L}\p{N}'’-]+/gu) || []).length;

function submissionHtml(sub, { target, quiz }) {
  const late = target.due_at && sub.submitted_at > target.due_at;
  const kind = target.assignment?.kind;
  const res = sub.quiz_result;
  return html`
    <div class="tk-subhead">
      <span>${ic('clock')}Здано ${relDay(sub.submitted_at)}, ${fmtTime(sub.submitted_at)}</span>
      ${sub.attempt_no > 1 ? html`<span class="badge badge--outline">Спроба ${sub.attempt_no}</span>` : ''}
      ${late ? html`<span class="badge badge--warning">${ic('clock')}Із запізненням</span>` : ''}
    </div>
    ${kind === 'quiz' && res ? html`<div class="tk-quizscore"><span class="score__value">${res.correct}<small> / ${res.total}</small></span><span class="muted">правильних відповідей</span></div>` : ''}
    ${sub.text_answer ? html`<div class="tk-answer"><p class="pre-wrap">${sub.text_answer}</p><p class="tk-answer__count">${wordCount(sub.text_answer)} ${plural(wordCount(sub.text_answer), 'слово', 'слова', 'слів')}</p></div>` : ''}
    ${sub.files?.length ? filesBlock(sub.files) : ''}
    ${kind === 'quiz' ? (quiz.length ? quizBlock(quiz, res || { per: {} }) : html`<p class="muted">Питання квізу недоступні.</p>`) : ''}
    ${!sub.text_answer && !sub.files?.length && kind !== 'quiz' ? html`<p class="muted">Учень надіслав порожню відповідь.</p>` : ''}`;
}

export default async function render({ view, params, alive }) {
  setTitle('Перевірка');
  view.classList.add('tk-page');
  const back = { href: '#/t/review', label: 'Перевірка' };
  view.innerHTML = String(html`${pageHeader({ title: html`<span class="skeleton skeleton--title" style="width:220px;display:inline-block"></span>`, back })}
    <div class="split"><div class="stack"><div class="card"><span class="skeleton skeleton--text" style="width:50%"></span></div>
      <div class="card"><span class="skeleton skeleton--text" style="width:30%"></span><span class="skeleton skeleton--block" style="height:220px;margin-top:16px"></span></div></div>
    <div class="card"><span class="skeleton skeleton--title" style="width:40%"></span><span class="skeleton skeleton--block" style="height:180px;margin-top:16px"></span></div></div>
    <span class="sr-only" role="status">Завантаження…</span>`);

  // Queue loads in parallel and must not block the work itself.
  const queueP = loadInbox(reviewScope()).then(queueOf).catch(() => []);

  let target; let subs = []; let quiz = [];
  try {
    [target, subs] = await Promise.all([api.getTarget(params.id), api.listSubmissions(params.id)]);
    if (target?.assignment?.kind === 'quiz') quiz = await api.getQuiz(target.assignment_id, { withKeys: true });
  } catch (err) {
    if (!alive()) return;
    view.innerHTML = String(html`${pageHeader({ title: 'Перевірка', back })}${errorState(err.message)}`);
    return;
  }
  if (!alive()) return;
  if (!target) {
    setTitle('Роботу не знайдено');
    view.innerHTML = String(html`${pageHeader({ title: 'Роботу не знайдено', back })}${emptyState({ icon: 'search', title: 'Такої роботи немає', text: 'Можливо, завдання або учня видалили.', action: html`<a class="btn btn--primary" href="#/t/review">До перевірки</a>` })}`);
    return;
  }

  const a = target.assignment || {};
  const st = target.student || {};
  const max = scale();
  const latest = subs[0] || null;
  const older = subs.slice(1);
  setTitle(`${st.full_name || 'Учень'} · перевірка`);

  const wasSubmitted = target.status === 'submitted';
  const isRegrade = target.status === 'graded';
  const initialScore = target.score != null ? Number(target.score) : '';
  const initialFeedback = isRegrade ? (target.feedback || '') : '';
  const prevFeedback = !isRegrade && target.feedback ? target.feedback : '';

  view.innerHTML = String(html`
    ${pageHeader({
      title: st.full_name || 'Учень',
      back,
      meta: html`<span class="tk-meta">${levelBadge(st.cefr_level)}${kindTag(a.kind)}<a href="#/t/assignments/${a.id}">${a.title || 'Завдання'}</a></span>`,
      actions: html`<div class="tk-pos" data-pos hidden>
        <a class="btn btn--ghost btn--icon btn--sm" data-nav-prev aria-label="Попередня робота">${ic('chevronLeft')}</a>
        <span class="tk-pos__label num" data-pos-label aria-live="polite"></span>
        <a class="btn btn--ghost btn--icon btn--sm" data-nav-next aria-label="Наступна робота">${ic('chevronRight')}</a>
      </div>`,
    })}
    <div class="split tk-reviewgrid">
      <div class="stack">
        <details class="card tk-brief" ${!latest ? raw('open') : ''}>
          <summary class="tk-brief__sum">${ic('clipboard')}<span class="grow"><span class="fw-600">Умова завдання</span><span class="text-sm muted tk-brief__due"> · ${dueLabel(target.due_at)}</span></span>${ic('chevronDown', 'tk-brief__chev')}</summary>
          <div class="stack tk-brief__body">
            ${a.instructions ? html`<p class="pre-wrap tk-prose">${a.instructions}</p>` : html`<p class="muted text-sm">Без інструкції.</p>`}
            ${safeUrl(a.link_url) ? html`<a class="tk-linkcard" href="${safeUrl(a.link_url)}" target="_blank" rel="noopener noreferrer">${ic('link')}<span class="truncate">${safeUrl(a.link_url).replace(/^https?:\/\//, '')}</span>${ic('external', 'icon--sm')}</a>` : ''}
            ${a.attachments?.length ? filesBlock(a.attachments) : ''}
          </div>
        </details>

        <section class="card tk-work" aria-labelledby="work-h">
          <div class="card__head"><h2 class="h3" id="work-h">Відповідь учня</h2>${targetStatus(target)}</div>
          ${latest ? submissionHtml(latest, { target, quiz })
            : emptyState({ plain: true, icon: 'clock', title: 'Учень ще не здав роботу', text: target.due_at ? `Дедлайн: ${fmtDate(target.due_at)}, ${fmtTime(target.due_at)}${isOverdue(target) ? ' — вже минув.' : '.'}` : 'Дедлайну немає.' })}
        </section>

        ${older.length ? html`<section class="stack stack--sm" aria-label="Попередні спроби">
          ${older.map((s) => html`<details class="card tk-attempt"><summary class="tk-brief__sum">${ic('refresh')}<span class="grow"><span class="fw-600">Спроба ${s.attempt_no}</span><span class="text-sm muted"> · ${fmtDateShort(s.submitted_at)}, ${fmtTime(s.submitted_at)}</span></span>${ic('chevronDown', 'tk-brief__chev')}</summary>
            <div class="stack tk-brief__body">${submissionHtml(s, { target, quiz })}</div></details>`)}
        </section>` : ''}
      </div>

      <aside class="tk-gradecol">
        <form class="card tk-grade" id="grade-form" novalidate>
          <div class="card__head"><h2 class="h3">Оцінка</h2>${target.status === 'graded' ? html`<span class="tk-score num">${scoreText(target.score)}</span>` : ''}</div>
          ${isRegrade ? html`<div class="alert alert--success">${ic('checkCircle')}<div>Оцінено${target.graded_at ? ` ${fmtDate(target.graded_at)}` : ''}. Можна змінити оцінку чи коментар.</div></div>` : ''}
          ${target.status === 'returned' ? html`<div class="alert">${ic('refresh')}<div>Повернуто на доопрацювання. Чекаємо нову спробу від учня.</div></div>` : ''}
          ${a.kind === 'quiz' && latest?.quiz_result && !isRegrade ? html`<p class="hint">${ic('sparkles', 'icon--sm')} Квіз перевірено автоматично. Бал можна змінити.</p>` : ''}
          ${prevFeedback ? html`<div class="tk-prevfb"><p class="text-xs muted fw-600">Ваш попередній коментар</p><p class="pre-wrap text-sm">${prevFeedback}</p></div>` : ''}
          <div class="field">
            <label class="label" for="g-score">Бал <span class="label__opt">від 0 до ${max}</span></label>
            <div class="tk-scorebox"><input class="input tk-scoreinput num" id="g-score" name="score" type="number" inputmode="decimal" min="0" max="${max}" step="any" value="${initialScore}" autocomplete="off"><span class="tk-scorebox__max">/ ${max}</span></div>
            <div class="tk-scorechips" role="group" aria-label="Швидкий бал" style="--n:${scoreChips(max).length}">${scoreChips(max).map((v) => html`<button class="chip tk-scorechip" type="button" data-score="${v}" aria-pressed="${String(initialScore === v)}">${v}</button>`)}</div>
          </div>
          <div class="field">
            <label class="label" for="g-fb">Коментар для учня <span class="label__opt">(необовʼязково)</span></label>
            <textarea class="textarea" id="g-fb" name="feedback" rows="4" maxlength="4000" placeholder="Що вдалося, над чим попрацювати">${initialFeedback}</textarea>
            <div class="chips tk-chips-tight" role="group" aria-label="Швидкі фрази">${PHRASES.map((p) => html`<button class="chip" type="button" data-phrase="${p}">${ic('plus', 'icon--sm')}${p}</button>`)}</div>
          </div>
          <div class="stack stack--sm">
            <button class="btn btn--primary btn--block btn--lg" type="submit" data-grade><span data-grade-label>${isRegrade ? 'Зберегти оцінку' : 'Оцінити'}</span></button>
            ${latest && target.status !== 'returned' ? html`<button class="btn btn--secondary btn--block" type="button" data-action="return">${ic('refresh')}Повернути на доопрацювання</button>` : ''}
            <p class="text-xs muted text-center hide-mobile"><kbd>${isMac ? '⌘' : 'Ctrl'}</kbd> + <kbd>Enter</kbd> — ${isRegrade ? 'зберегти' : 'оцінити й далі'}</p>
          </div>
        </form>
      </aside>
    </div>`);

  hydrateFiles(view);
  bindLightbox(view);
  const form = view.querySelector('#grade-form');
  const scoreIn = form.score; const fbIn = form.feedback;

  // ---------------- queue / position ----------------
  let queue = [];
  queueP.then((q) => {
    if (!alive()) return;
    queue = q;
    setCount('review', q.length);
    const i = q.findIndex((t) => t.id === target.id);
    const box = view.querySelector('[data-pos]');
    const rest = q.filter((t) => t.id !== target.id);
    if (!isRegrade && rest.length) view.querySelector('[data-grade-label]').textContent = 'Оцінити й далі';
    if (i < 0) {
      if (rest.length) { box.hidden = false; view.querySelector('[data-pos-label]').textContent = `${rest.length} в черзі`; setNav(null, rest[0]); }
      return;
    }
    box.hidden = false;
    view.querySelector('[data-pos-label]').textContent = `${i + 1} з ${q.length}`;
    setNav(q[i - 1], q[i + 1]);
  });
  function setNav(prev, next) {
    const p = view.querySelector('[data-nav-prev]'); const n = view.querySelector('[data-nav-next]');
    const set = (el, t) => { if (t) { el.href = `#/t/review/${t.id}`; el.removeAttribute('aria-disabled'); } else { el.removeAttribute('href'); el.setAttribute('aria-disabled', 'true'); } };
    set(p, prev); set(n, next);
  }

  // ---------------- score + feedback helpers ----------------
  const syncChips = () => {
    const v = scoreIn.value === '' ? null : Number(scoreIn.value);
    form.querySelectorAll('[data-score]').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.score) === v)));
  };
  scoreIn.addEventListener('input', () => { syncChips(); fieldError(form, 'score', null); });
  on(form, '[data-score]', (e, c) => { scoreIn.value = c.dataset.score; syncChips(); fieldError(form, 'score', null); });
  on(form, '[data-phrase]', (e, c) => {
    const cur = fbIn.value.replace(/\s+$/, '');
    const sep = !cur ? '' : /[.!?…]$/.test(cur) ? ' ' : '. ';
    fbIn.value = cur + sep + c.dataset.phrase;
    fieldError(form, 'feedback', null);
    fbIn.focus(); fbIn.setSelectionRange(fbIn.value.length, fbIn.value.length);
  });
  fbIn.addEventListener('input', () => fieldError(form, 'feedback', null));

  async function goNext() {
    const q = (await queueP).filter((t) => t.id !== target.id);
    setCount('review', q.length);
    if (!alive()) return;
    if (q.length) {
      const myIdx = queue.findIndex((t) => t.id === target.id);
      const next = (myIdx > -1 && queue.slice(myIdx + 1).find((t) => t.id !== target.id)) || q[0];
      navigate(`/t/review/${next.id}`);
    } else {
      toast('Усе перевірено!', { text: gradedThisSession > 1 ? `${gradedThisSession} ${plural(gradedThisSession, 'роботу', 'роботи', 'робіт')} оцінено за цей підхід.` : 'Черга порожня.' });
      gradedThisSession = 0;
      navigate('/t/review');
    }
  }

  // ---------------- grade ----------------
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrors(form);
    const raw0 = String(scoreIn.value).replace(',', '.').trim();
    const score = raw0 === '' ? NaN : Number(raw0);
    if (Number.isNaN(score)) { fieldError(form, 'score', 'Поставте бал.'); scoreIn.focus(); return; }
    if (score < 0 || score > max) { fieldError(form, 'score', `Бал має бути від 0 до ${max}.`); scoreIn.focus(); return; }
    const btn = form.querySelector('[data-grade]');
    busy = true; setLoading(btn, true);
    try {
      const updated = await api.reviewTarget(target.id, { action: 'grade', score, feedback: fbIn.value.trim() });
      if (wasSubmitted) gradedThisSession += 1;
      if (isRegrade) {
        toast('Оцінку змінено', { text: `${st.full_name}: ${scoreText(score)}` });
        Object.assign(target, updated);
        if (alive()) { setLoading(btn, false); busy = false; view.querySelector('.tk-grade .card__head .tk-score')?.replaceChildren(scoreText(score)); }
        return;
      }
      toast('Роботу оцінено', { text: `${st.full_name}: ${scoreText(score)}` });
      await goNext();
    } catch (err) {
      toastError(err);
      if (btn.isConnected) setLoading(btn, false);
      busy = false;
    }
  });

  // ---------------- return ----------------
  on(form, '[data-action="return"]', async (e, btn) => {
    if (busy) return;
    clearErrors(form);
    const feedback = fbIn.value.trim();
    if (!feedback) {
      fieldError(form, 'feedback', 'Напишіть, що виправити — учень побачить цей коментар.');
      fbIn.focus();
      return;
    }
    busy = true; setLoading(btn, true);
    try {
      await api.reviewTarget(target.id, { action: 'return', feedback });
      toast('Роботу повернуто на доопрацювання', { text: `${st.full_name} побачить ваш коментар.` });
      if (wasSubmitted) await goNext();
      else if (alive()) navigate(`/t/review/${target.id}`);
    } catch (err) {
      toastError(err);
      if (btn.isConnected) setLoading(btn, false);
      busy = false;
    }
  });

  // ---------------- keyboard ----------------
  const onKey = (e) => {
    if (!alive() || !form.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      form.requestSubmit();
    }
  };
  document.addEventListener('keydown', onKey);

  // Focus the score field on desktop so the teacher can type immediately
  if (latest && window.matchMedia('(min-width: 1025px)').matches) setTimeout(() => { if (alive()) scoreIn.focus({ preventScroll: true }); }, 60);
}
