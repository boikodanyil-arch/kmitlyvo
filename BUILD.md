# Кмітливо — engineering brief (read fully before writing code)

Beta web platform for English tutors and online language schools. UI language: **Ukrainian only**. Audience: teachers (phone + laptop), students (mostly phones), school admins. Quality bar: "cosmic-level" polish — feels like a premium product, fast, calm, obvious, zero dead ends.

## Stack & hard constraints
- **No build step, no npm.** Plain HTML + vanilla JS ES modules + CSS, hosted on GitHub Pages (static). Supabase backend (Postgres + RLS + Storage + one edge function).
- `supabase-js` is loaded from CDN in `js/supabase.js` (already done). Do not add other dependencies.
- Hash routing (`#/t/students/123`). Router in `js/router.js`, routes table in `js/main.js` (already defined — do not change route paths).
- Timezone for all display: **Europe/Warsaw** (use helpers in `js/utils.js`). Store timestamps as ISO/UTC.

## Read these first
1. `design-guide.md` — the design system. Use its classes and markup patterns **exactly**. `showcase.html` shows everything rendered.
2. `js/utils.js` — `html` tagged template (auto-escapes; use `raw()` for trusted HTML like icons), `esc`, date helpers (`fmtTime`, `fmtDate`, `fmtFullDate`, `relDay`, `dayKey`, `fromZoned`, `addDays`, `weekStart`, `todayKey`, `timeInputValue`, `dueLabel`, `isOverdue`), `plural`, `money`, `suggestLogin`, `LEVELS`, `safeUrl`.
3. `js/ui.js` — `icon`, `brand`, `levelBadge`, `targetStatus(t)`, `lessonStatus(s)`, `badge`, `avatar(name,size)`, `pageHeader({title,meta,back,actions})`, `emptyState`, `skeletonRows`, `errorState`, `levelOptions`, `toast`, `toastError`, `openModal({title,body,foot,wide,onOpen,onClose})` (buttons with `data-close` close it; `foot` buttons can use `form="id"` to submit a form in body), `confirmDialog`, `setLoading`, `formValues`, `fieldError`, `clearErrors`, `onSubmit(form, handler)`, `copyText`, `on(root, selector, handler)`.
4. `js/api.js` — ALL data access. Use these functions; if you need a new query, add it **inside your own page/component file** using `sb` + `must` from `js/supabase.js` (do not edit api.js — other engineers work in parallel).
5. `js/state.js` — `state.user`, `state.profile`, `state.space` (`{id,name,kind:'school'|'tutor',teacher_invite_code,grade_scale,currency}`), `state.role` ('owner'|'admin'|'teacher'|'student'), `state.student` (student's own `students` row), helpers `isStaff()`, `isAdmin()`, `isStudent()`, `isSchool()`.
6. `js/shell.js` — `setTitle(t)` (call on every page), `setCount('review'|'tasks', n)` to update nav badges.

## Page contract
Each page is `js/pages/<name>.js`:
```js
export default async function render({ view, params, query, path, alive }) { ... }
```
- `view` is the empty page container (inside the app shell for staff/student/user pages; the whole `#app` for public/guest pages — public pages render their own full layout, e.g. `.auth` or landing).
- Render a skeleton first if loading takes time, then the real content. After every `await`, `if (!alive()) return;` (user navigated away).
- Always call `setTitle('…')`.
- Bind events on elements inside `view` (they're destroyed on navigation). Prefer `on(view, '[data-action="x"]', fn)`.
- Never use `innerHTML` with unescaped user data — use `html` template or `esc()`.
- Errors: wrap mutations with try/catch → `toastError(err)`. Loading states on buttons via `setLoading` / `onSubmit`.
- After mutations, update the UI in place or re-render the page section (do not full-reload).
- Navigation: plain links `href="#/t/students/ID"` or `navigate('/t/...')` from `js/router.js`.

## Data model (Supabase, RLS enforced server-side)
- `spaces` (school or tutor workspace), `space_members(space_id,user_id,role)`; `profiles(id,full_name)`.
- `students(id, space_id, teacher_id, user_id|null, full_name, login, activation_code|null, cefr_level A0..C2, goals, next_topic, status active|paused|archived, lesson_price, lesson_minutes, meeting_url, contact, is_minor, parent_consent, is_demo)`. A student row is created by the teacher; the student activates their account with `activation_code` at `#/activate` and then logs in with **login + password** (login maps to email `login@uchen.kmitlyvo.app` internally — handled by the login page). `user_id` is null until activated. Login cannot change after activation.
- `student_notes(student_id, body)` — private teacher notes (students cannot read).
- `lessons(id, space_id, teacher_id, student_id, series_id, starts_at, duration_min, status scheduled|done|cancelled|no_show, topic, student_summary, meeting_url)`; `lesson_private_notes(lesson_id, body)` (teacher only). `student_summary` is visible to the student.
- `payments(student_id, lessons_count, amount, note, paid_on)`. Balance = paid lessons − lessons with status done/no_show (`api.balances()`).
- `assignments(id, teacher_id, title, instructions, kind text|file|link|quiz, link_url, attachments jsonb[{path,name,type,size}], lesson_id, is_demo)`.
- `quiz_questions(assignment_id, position, qtype single|gap, prompt, options jsonb[])`, `quiz_keys(question_id, answer)` — answer is option index (number) for `single`, array of accepted strings for `gap`. Students can read questions but never keys.
- `assignment_targets(id, assignment_id, student_id, due_at, status assigned|submitted|returned|graded, score, feedback, graded_at)` — one per student per assignment. "Overdue" is computed (`isOverdue`).
- `submissions(target_id, student_id, attempt_no, text_answer, files jsonb, quiz_answers, quiz_result)` — created only via `api.submitAssignment()` (RPC). Quizzes are auto-graded server-side (status → graded, score on `spaces.grade_scale`, default 12). `quiz_result = {total, correct, per:{[questionId]:{ok, answer}}}`.
- Files: private bucket `files`. Paths `a/<space>/<assignmentId>/<file>` (teacher attachments) and `s/<space>/<studentId>/<file>` (student submissions). Use `api.uploadFile`, `api.signedUrl`, `api.compressImage`.
- Grade scale: `state.space.grade_scale` (default 12). Currency: `state.space.currency` (default 'zł').

## Shared components (cross-agent contracts)
Components live in `js/components/`. Each owner implements exactly this signature; other agents may import it.
- `student-form.js` (owner: students agent): `export function openStudentForm({ student = null, onSaved })` — create/edit student modal; after create shows the invite card (login + activation code + link `<site>#/activate?code=CODE` + copy button + share text).
- `payment-form.js` (owner: students agent): `export function openPaymentForm({ studentId = null, onSaved })`.
- `lesson-form.js` (owner: calendar agent): `export function openLessonForm({ lesson = null, studentId = null, date = null /* 'YYYY-MM-DD' */, time = null, onSaved })` — create (single or weekly series N weeks) / edit lesson.
- `lesson-close.js` (owner: calendar agent): `export function openLessonClose({ lesson, onSaved })` — "Завершити урок": status done/no_show, topic, student summary, private note, next topic (updates `students.next_topic`), and a button "Задати домашнє" → `#/t/assignments/new?student=ID&lesson=ID`.
Until another agent's component exists, just import it — all will exist at integration time.

## Site URL for invite links
`const SITE = location.origin + location.pathname;` → invite link `${SITE}#/activate?code=XXXX`, school teacher link `${SITE}#/join?code=XXXX`.

## Copy & UX rules
- Ukrainian, sentence case, friendly but concise. Buttons name actions ("Призначити", "Зберегти урок"); toasts reuse the verb ("Урок збережено").
- One primary button per screen; at most one `card--focus` per page.
- Every list has a designed empty state with a helpful action. Every async view has a skeleton.
- Mobile first (≤ 820px tabbar). Test your layouts mentally at 375px and 1280px. Tables must use the stacking variant.
- Accessibility: labels for inputs, `aria-label` for icon buttons, focus visible, no colour-only status.
- Demo mode: if a teacher has no students, dashboards should offer "Заповнити прикладом" (calls `api.seedDemo()`), so beta testers immediately see a living product.

## Extra CSS
Only if the design system lacks something: put it in your own file `assets/css/<area>.css` (already linked): public.css, students.css, calendar.css, tasks.css, student.css. Use design tokens (`var(--…)`). Never edit `assets/styles.css`.

## Do NOT edit
`assets/styles.css`, `assets/icons.js`, `js/supabase.js`, `js/state.js`, `js/router.js`, `js/main.js`, `js/shell.js`, `js/ui.js`, `js/utils.js`, `js/api.js`, `index.html`. If you believe a change there is required, describe it precisely in your final report instead.

## Self-check before finishing
- `node --check` every JS file you wrote (syntax). Imports must reference existing exports.
- Grep your files for `innerHTML` and confirm user data is escaped.
- Final report: files created, any assumptions, any requested core changes, anything unfinished.
