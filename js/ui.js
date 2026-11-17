// Shared UI helpers. Markup follows design-guide.md exactly.
import { icon } from '../assets/icons.js';
import { esc, html, raw, initials, isOverdue, LEVELS } from './utils.js';

export { icon };

// ---------------- brand ----------------
export const brandMark = () => raw('<svg class="brand__mark" viewBox="0 0 40 40" aria-hidden="true"><rect class="bm-tile" width="40" height="40" rx="11"/><path class="bm-stroke" d="M14 11v18M14 21.5 22.5 29M14 20l7.2-6.6" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle class="bm-dot" cx="25.6" cy="11.4" r="3.6"/></svg>');
export function brand({ large = false, tag = true, beta = true, href = '#/' } = {}) {
  return html`<a class="brand${large ? ' brand--lg' : ''}" href="${href}">${brandMark()}<span class="brand__text"><span class="brand__name">Кмітливо</span>${tag ? html`<span class="brand__tag">Простір для вчителів і учнів</span>` : ''}</span>${beta ? html`<span class="brand__beta">бета</span>` : ''}</a>`;
}

// ---------------- badges ----------------
export function levelBadge(level) {
  const l = String(level || 'A1').toUpperCase();
  const cls = l === 'A0' ? 'a1' : l.toLowerCase();
  return html`<span class="level level--${cls}" title="Рівень ${l}">${l}</span>`;
}
export const TARGET_STATUS = { assigned: 'Призначено', submitted: 'Здано', returned: 'Повернуто', graded: 'Оцінено', overdue: 'Прострочено' };
export const LESSON_STATUS = { scheduled: 'Заплановано', done: 'Проведено', cancelled: 'Скасовано', no_show: 'Неявка' };
/** Status badge for an assignment target (computes overdue). */
export function targetStatus(t) {
  const s = isOverdue(t) ? 'overdue' : t.status;
  return html`<span class="status status--${s}">${TARGET_STATUS[s]}</span>`;
}
export function lessonStatus(status) {
  return html`<span class="status status--${status}">${LESSON_STATUS[status] || status}</span>`;
}
export function badge(text, variant = '') { return html`<span class="badge${variant ? ' badge--' + variant : ''}">${text}</span>`; }

// ---------------- avatar ----------------
export function hue(name = '') { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 6) + 1; }
export function avatar(name, size = '') {
  return html`<span class="avatar avatar--${hue(name)}${size ? ' avatar--' + size : ''}" aria-hidden="true">${initials(name)}</span>`;
}

// ---------------- page pieces ----------------
/** opts: { title, meta, back: {href,label}, actions: html } */
export function pageHeader({ title, meta = '', back = null, actions = '' }) {
  return html`<div class="page-header">
    <div class="page-header__titles">
      ${back ? html`<a class="back-link" href="${back.href}">${raw(icon('chevronLeft'))}${back.label}</a>` : ''}
      <h1 class="h1">${title}</h1>
      ${meta ? html`<p class="page-header__meta">${meta}</p>` : ''}
    </div>
    ${actions ? html`<div class="page-header__actions">${actions}</div>` : ''}
  </div>`;
}
/** opts: { icon, title, text, action: html, plain } */
export function emptyState({ icon: ic = 'sparkles', title, text = '', action = '', plain = false }) {
  return html`<div class="empty${plain ? ' empty--plain' : ''}">
    <div class="empty__art">${raw(icon(ic))}</div>
    <p class="empty__title">${title}</p>
    ${text ? html`<p class="empty__text">${text}</p>` : ''}
    ${action || ''}
  </div>`;
}
export function skeletonRows(n = 4) {
  const rows = Array.from({ length: n }, () => '<li class="list-row"><span class="skeleton skeleton--circle" style="width:40px;height:40px"></span><span class="list-row__body"><span class="skeleton skeleton--text" style="width:55%"></span><span class="skeleton skeleton--text" style="width:35%"></span></span></li>').join('');
  return raw(`<ul class="list list--card" aria-hidden="true">${rows}</ul><span class="sr-only" role="status">Завантаження…</span>`);
}
export function pageSkeleton() {
  return raw(`<div class="page-header"><div class="page-header__titles"><span class="skeleton skeleton--title" style="width:240px"></span></div></div>${skeletonRows(5)}`);
}
export function errorState(message, retryHref = null) {
  return emptyState({ icon: 'alert', title: 'Не вдалося завантажити', text: message || 'Перевірте інтернет і спробуйте ще раз.', action: html`<a class="btn btn--secondary" href="${retryHref || location.hash || '#/'}" data-reload>${raw(icon('refresh'))}Спробувати ще раз</a>` });
}
export function levelOptions(selected = 'A1') {
  return raw(LEVELS.map((l) => `<option value="${l}"${l === selected ? ' selected' : ''}>${l}</option>`).join(''));
}

// ---------------- toasts ----------------
function region() {
  let r = document.querySelector('.toast-region');
  if (!r) { r = document.createElement('div'); r.className = 'toast-region'; r.setAttribute('aria-live', 'polite'); document.body.appendChild(r); }
  return r;
}
/** toast('Збережено') | toast('Помилка', { type:'error', text:'...' , action:{label, onClick}, timeout }) */
export function toast(title, { type = 'success', text = '', action = null, timeout = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = type === 'error' ? 'xCircle' : type === 'info' ? 'info' : 'checkCircle';
  el.innerHTML = `${icon(ic, 'toast__icon')}<div class="toast__body"><p class="toast__title">${esc(title)}</p>${text ? `<p>${esc(text)}</p>` : ''}</div>${action ? `<button class="toast__action" type="button">${esc(action.label)}</button>` : `<button class="btn btn--ghost btn--icon btn--sm toast__close" type="button" aria-label="Закрити">${icon('x', 'icon--sm')}</button>`}`;
  const close = () => { el.classList.add('toast--leaving'); setTimeout(() => el.remove(), 230); };
  el.querySelector('.toast__close')?.addEventListener('click', close);
  if (action) el.querySelector('.toast__action').addEventListener('click', () => { action.onClick?.(); close(); });
  region().appendChild(el);
  if (timeout) setTimeout(close, timeout);
  return close;
}
export const toastError = (err) => toast(err?.message || String(err), { type: 'error', timeout: 6000 });

// ---------------- modal ----------------
/**
 * openModal({ title, body: html|string, foot: html|string, wide, onOpen(dialog), onClose() })
 * Returns { dialog, close }. Buttons with [data-close] close the modal.
 */
export function openModal({ title, body = '', foot = '', wide = false, onOpen = null, onClose = null }) {
  const dialog = document.createElement('dialog');
  const id = 'm' + Math.random().toString(36).slice(2, 8);
  dialog.className = `modal${wide ? ' modal--wide' : ''}`;
  dialog.setAttribute('aria-labelledby', `${id}-t`);
  dialog.innerHTML = `<div class="sheet-handle" aria-hidden="true"></div>
    <div class="modal__head"><h2 class="modal__title" id="${id}-t">${esc(title)}</h2>
      <button class="btn btn--ghost btn--icon modal__close" type="button" aria-label="Закрити" data-close>${icon('x')}</button></div>
    <div class="modal__body">${String(body)}</div>
    ${foot ? `<div class="modal__foot">${String(foot)}</div>` : ''}`;
  document.body.appendChild(dialog);
  const close = () => { if (dialog.open) dialog.close(); };
  // Закриваємо вікно при зміні сторінки (кнопка «Назад», перехід за посиланням)
  const onHash = () => close();
  window.addEventListener('hashchange', onHash);
  dialog.addEventListener('close', () => { window.removeEventListener('hashchange', onHash); onClose?.(); dialog.remove(); });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
    if (e.target.closest('[data-close]')) close();
  });
  dialog.showModal();
  onOpen?.(dialog);
  return { dialog, close };
}
/** confirmDialog({ title, text, confirmLabel, danger }) → Promise<boolean> */
export function confirmDialog({ title, text = '', confirmLabel = 'Підтвердити', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const { dialog } = openModal({
      title,
      body: text ? `<p>${esc(text)}</p>` : '',
      foot: `<button class="btn btn--secondary" type="button" data-close>Скасувати</button><button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-ok>${esc(confirmLabel)}</button>`,
      onClose: () => resolve(result),
    });
    dialog.querySelector('[data-ok]').addEventListener('click', () => { result = true; dialog.close(); });
  });
}

// ---------------- forms ----------------
export function setLoading(btn, on, label = null) {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.innerHTML;
    btn.classList.add('btn--loading'); btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    if (label) btn.innerHTML = `<span>${esc(label)}</span>`;
  } else {
    btn.classList.remove('btn--loading'); btn.removeAttribute('aria-busy'); btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}
export function formValues(form) {
  const out = {};
  new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v.trim() : v; });
  return out;
}
/** Show an error under a field: fieldError(form, 'email', 'Текст') ; fieldError(form, 'email', null) clears */
export function fieldError(form, name, message) {
  const input = form.querySelector(`[name="${name}"]`);
  if (!input) return;
  const field = input.closest('.field');
  field?.classList.toggle('field--error', !!message);
  if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  let err = field?.querySelector('.error-text');
  if (message) {
    if (!err) { err = document.createElement('p'); err.className = 'error-text'; err.id = `${input.id || name}-err`; field?.appendChild(err); }
    err.innerHTML = `${icon('alert')}${esc(message)}`;
    input.setAttribute('aria-describedby', err.id);
  } else err?.remove();
}
export function clearErrors(form) { form.querySelectorAll('.field--error').forEach((f) => { f.classList.remove('field--error'); f.querySelector('.error-text')?.remove(); f.querySelector('[aria-invalid]')?.removeAttribute('aria-invalid'); }); }

/** Wire a form submit handler with loading state and error toast. handler(values, form) may throw. */
export function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]') || e.submitter;
    clearErrors(form);
    setLoading(btn, true);
    try { await handler(formValues(form), form); } catch (err) { toastError(err); } finally { if (btn.isConnected) setLoading(btn, false); }
  });
}

export async function copyText(text, label = 'Скопійовано') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { toast('Не вдалося скопіювати', { type: 'error', text }); }
}

/** Delegated click handler on a root: on(root, '[data-action=x]', fn) */
export function on(root, selector, handler, type = 'click') {
  root.addEventListener(type, (e) => { const el = e.target.closest(selector); if (el && root.contains(el)) handler(e, el); });
}
