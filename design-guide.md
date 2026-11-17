# Кмітливо: design guide

How to build pages with `assets/styles.css` and `assets/icons.js`. Open `showcase.html` to see every pattern rendered.

## Concept

The idea is a chalkboard with a highlighter. Deep chalkboard green (`--primary`) carries trust and calm. Highlighter yellow (`--hl`) marks the one thing that matters now: the active nav item, today, the current quiz step, the main action on the "next lesson" card. Everything else stays quiet: sage-white paper and ink.

Rules:
- Use one `card--focus` (dark green "next up" card) per page at most.
- Use `--hl` only as a background, never as a text colour on a light surface. Put `--hl-ink` text on it.
- Status is never shown by colour alone. Each status badge has a text label and a dot of a different shape.
- Each screen has one primary button.
- Interface copy is Ukrainian, in sentence case. Buttons name the action ("Призначити", not "ОК"), and the toast repeats the same verb ("Завдання призначено").

## Setup

```html
<!DOCTYPE html>
<html lang="uk" data-theme="light">  <!-- "dark" for dark theme -->
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/styles.css">
</head>
```

```js
import { icon } from './assets/icons.js';
button.innerHTML = `${icon('plus')}Новий урок`;     // returns <svg class="icon" aria-hidden="true">
icon('x', 'icon--sm');                               // extra classes: icon--sm (18), icon--lg (32)
```

Icon names: home, users, user, calendar, book, clipboard, inbox, wallet, settings, logout, menu, school, chart, grid, plus, minus, search, filter, check, checkCircle, x, xCircle, edit, trash, copy, eye, eyeOff, upload, download, camera, image, link, file, paperclip, send, share, more, refresh, external, chevronLeft, chevronRight, chevronDown, chevronUp, arrowLeft, arrowRight, clock, video, star, sparkles, message, feedback, bell, alert, info, help, lock, mail, phone, globe, mic, headphones, target, trophy, flame, card, coins, sun, moon, dot.

Icons are decorative. An icon-only button must have an `aria-label`.

## Tokens

| Group | Tokens |
|---|---|
| Brand | `--chalk-50 #EAF3EF`, `--chalk-100`, `--chalk-200`, `--chalk-500 #2A7A63`, `--chalk-600`, `--chalk-700 #1A5244`, `--chalk-800`, `--hl #FFD84A`, `--hl-soft #FFF1B5`, `--hl-ink #3F3200` |
| Surfaces | `--paper #F4F6F1` (page), `--surface #FFF` (cards/inputs), `--surface-2` (hover/sunken), `--surface-3` (pressed/skeleton), `--line`, `--line-strong` |
| Text | `--ink #16201C`, `--ink-2 #36433D`, `--muted #5A6761` (≥5.2:1 on every surface), `--on-primary` |
| Roles | `--primary`, `--primary-hover`, `--primary-soft`, `--primary-text`, `--focus #1F5FD1` (dark theme: yellow) |
| Feedback | `--success`/`--success-soft`, `--warning`/`--warning-soft`, `--danger`/`--danger-soft`/`--danger-hover`, `--info`/`--info-soft` |
| CEFR | `--a1-bg/--a1-fg` … `--c2-bg/--c2-fg` (green, teal, blue, indigo, plum, wine) |
| Fonts | `--font-display` (Unbounded: page titles, big numbers, logo), `--font-ui` (Onest: everything else) |
| Type scale | `--fs-xs 12`, `--fs-sm 14`, `--fs-md 16` (body), `--fs-lg 18`, `--fs-xl 20`, `--fs-2xl 24`, `--fs-3xl 30`, `--fs-4xl 38`, `--fs-5xl 48`; `--lh-tight 1.15`, `--lh-snug 1.3`, `--lh-body 1.55` |
| Spacing (8px grid) | `--s-1 4`, `--s-2 8`, `--s-3 12`, `--s-4 16`, `--s-5 24`, `--s-6 32`, `--s-7 40`, `--s-8 48`, `--s-9 64`, `--s-10 80` |
| Radius | `--r-xs 6` (badges), `--r-sm 10` (buttons, inputs), `--r-md 14` (cards, rows), `--r-lg 20` (modals, sheets), `--r-pill` |
| Shadow | `--shadow-1` (subtle), `--shadow-2` (raised/hover), `--shadow-3` (overlays), `--ring` (focus) |
| Z-index | `--z-sticky 20`, `--z-nav 30`, `--z-fab 40`, `--z-overlay 50`, `--z-modal 60`, `--z-toast 70` |
| Motion | `--ease-out`, `--ease-spring`, `--t-fast 120ms`, `--t-med 200ms`, `--t-slow 320ms` (all reduced under `prefers-reduced-motion`) |
| Layout | `--sidebar-w 264px`, `--tabbar-h 64px`, `--topbar-h 56px`, `--content-max 1180px`, `--tap 44px` |

The mobile breakpoint is **820px**. Below it the sidebar becomes a top bar plus a bottom tab bar. Other breakpoints: 1024 (grid-4 → 2 columns, split → 1 column), 720 (tables stack), 640 (forms, modal → sheet).

## Typography

```html
<h1 class="display">…</h1>   <!-- landing hero only -->
<h1 class="h1">…</h1>        <!-- one per page -->
<h2 class="h2">…</h2>  <h3 class="h3">…</h3>  <p class="h4">…</p>
<p class="lead">…</p>  <p class="text-sm muted">…</p>  <span class="num">12 400 ₴</span>
```
Utilities: `.muted`, `.num` (tabular figures), `.prose` (68ch measure), `.truncate`, `.fw-600`, `.c-primary`, `.c-danger`, `.c-success`, `.sr-only`, `.mark` (inline highlighter, use sparingly).

## Layout primitives

- `.container`: centred, max 1180px.
- `.stack`: vertical flex. Modifiers `--xs/--sm/--lg/--xl`, or set `style="--gap:…"`.
- `.cluster`: wrapping row. Modifiers `--between`, `--end`.
- `.row`: non-wrapping row. Pair with `.grow` on the stretching child.
- `.grid`: auto-fill, min width set with `--min` (default 240px). Also `.grid-2`, `.grid-3`, `.grid-4`.
- `.split`: main column 2fr and side column 1fr. It collapses at 1024px.
- `.section` > `.section__head` (h2 + `.link-btn`).
- `.divider`, `.hide-mobile`, `.show-mobile`.

## App shell

```html
<a class="skip-link" href="#main">Перейти до змісту</a>
<div class="app">
  <aside class="sidebar">
    <a class="brand sidebar__brand" href="/">
      <!-- logo mark, see Brand -->
      <span class="brand__text"><span class="brand__name">Кмітливо</span><span class="brand__tag">Простір для вчителів і учнів</span></span>
    </a>
    <nav class="nav" aria-label="Головне меню">
      <a class="nav__item" href="#/" aria-current="page">${icon('home')}<span class="nav__label-text">Головна</span></a>
      <a class="nav__item" href="#/schedule">${icon('calendar')}<span class="nav__label-text">Розклад</span></a>
      <a class="nav__item" href="#/homework">${icon('clipboard')}<span class="nav__label-text">Домашні</span><span class="nav__count">7</span></a>
      <p class="nav__label">Школа</p> <!-- optional group label -->
    </nav>
    <div class="sidebar__footer">
      <a class="nav__item" href="#/settings">${icon('settings')}<span class="nav__label-text">Налаштування</span></a>
      <div class="sidebar__school">
        <span class="avatar avatar--sm avatar--3">ОМ</span>
        <div class="grow"><div class="fw-600 truncate">Олена Мельник</div><div class="text-xs muted">Викладачка</div></div>
        <button class="btn btn--ghost btn--icon btn--sm" aria-label="Вийти">${icon('logout')}</button>
      </div>
    </div>
  </aside>

  <header class="topbar"> <!-- visible ≤ 820px -->
    <a class="brand" href="/"><!-- mark only --></a>
    <span class="avatar avatar--sm avatar--3">ОМ</span>
  </header>

  <main class="main" id="main">
    <div class="page">
      <div class="page-header">
        <div class="page-header__titles">
          <a class="back-link" href="#/students">${icon('chevronLeft')}Учні</a> <!-- optional -->
          <h1 class="h1">Добрий ранок, Олено</h1>
          <p class="page-header__meta">Вівторок, 17 листопада</p>
        </div>
        <div class="page-header__actions">
          <button class="btn btn--secondary">…</button>
          <button class="btn btn--primary">${icon('plus')}Новий урок</button>
        </div>
      </div>
      <!-- content -->
    </div>
  </main>

  <nav class="tabbar" aria-label="Головне меню"> <!-- visible ≤ 820px, max 5 items -->
    <a class="tabbar__item" href="#/" aria-current="page"><span class="tabbar__icon">${icon('home')}</span>Головна</a>
    <a class="tabbar__item" href="#/homework"><span class="tabbar__icon">${icon('clipboard')}<span class="tabbar__dot"></span></span>Домашні</a>
  </nav>

  <button class="feedback-fab" type="button">${icon('feedback')}<span class="feedback-fab__label">Відгук</span></button>
</div>
<div class="toast-region" aria-live="polite"></div>
```
Wrap the active nav label in `.nav__label-text`, because the highlighter mark is drawn on that span. Set `aria-current="page"` on the active link in both the sidebar and the tab bar. The `.page` element already adds bottom padding for the tab bar on mobile.

## Brand

```html
<svg class="brand__mark" viewBox="0 0 40 40" aria-hidden="true">
  <rect class="bm-tile" width="40" height="40" rx="11"/>
  <path class="bm-stroke" d="M14 11v18M14 21.5 22.5 29M14 20l7.2-6.6" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle class="bm-dot" cx="25.6" cy="11.4" r="3.6"/>
</svg>
```
Variants: `.brand--lg` (auth screen) and `.brand__beta` (`<span class="brand__beta">бета</span>`). For a favicon, use the same SVG with fills inlined (#1A5244, #FFF, #FFD84A).

## Buttons

```html
<button class="btn btn--primary">${icon('plus')}Новий урок</button>
<button class="btn btn--secondary">Скасувати</button>
<button class="btn btn--soft">Призначити</button>       <!-- tinted secondary -->
<button class="btn btn--ghost">Пропустити</button>
<button class="btn btn--danger">Видалити учня</button>
<button class="btn btn--danger-ghost">Скасувати урок</button>
<button class="btn btn--secondary btn--icon" aria-label="Редагувати">${icon('edit')}</button>
<button class="btn btn--primary btn--loading" aria-busy="true"><span>Зберігаємо</span></button>
<a class="link-btn" href="…">Усі завдання${icon('chevronRight')}</a>
```
Sizes are `btn--sm` (36px, with a 44px hit area on touch screens), default (44px) and `btn--lg` (52px). Add `btn--block` for full width. Use `disabled` or `aria-disabled="true"`. The loading state hides the label and shows a spinner, so wrap the label text in a `<span>`. Group buttons with `.btn-group`.

## Forms

```html
<form class="form">
  <div class="field">
    <label class="label" for="name">Ім’я учня <span class="label__opt">(необов’язково)</span></label>
    <input class="input" id="name" aria-describedby="name-hint">
    <p class="hint" id="name-hint">Підказка</p>
  </div>

  <div class="field field--error">
    <label class="label" for="email">Email</label>
    <input class="input" id="email" aria-invalid="true" aria-describedby="email-err">
    <p class="error-text" id="email-err">${icon('alert')}Додайте домен після @</p>
  </div>

  <div class="form__row"> <!-- auto columns ≥220px -->
    <div class="field"><label class="label" for="lvl">Рівень</label><select class="select" id="lvl">…</select></div>
    <div class="field"><label class="label" for="d">Дата</label><input class="input" id="d" type="date"></div>
  </div>

  <textarea class="textarea"></textarea>

  <div class="input-wrap">${icon('search')}<input class="input" type="search"></div>
  <div class="input-wrap input-wrap--action">
    <input class="input"><button class="btn btn--ghost btn--icon input-wrap__action" aria-label="Копіювати">${icon('copy')}</button>
  </div>

  <fieldset class="fieldset"><legend>Формат</legend>
    <label class="check"><input type="radio" name="f" checked><span class="check__body">Індивідуальний<span class="check__hint">45 або 60 хв</span></span></label>
    <label class="check"><input type="checkbox"><span class="check__body">Нагадування</span></label>
  </fieldset>

  <label class="switch"><span>Приймати після дедлайну</span><input type="checkbox" role="switch"></label>

  <div class="form__actions"><button class="btn btn--ghost" type="button">Скасувати</button><button class="btn btn--primary">Зберегти</button></div>
</form>
```
Inputs use a 16px font so iOS does not zoom on focus. On mobile, `form__actions` stacks with the primary button on top.

## Cards and stat tiles

```html
<div class="card">
  <div class="card__head"><div><p class="card__title">Група</p><p class="card__sub">Чт, 19:00</p></div><span class="level level--b2">B2</span></div>
  …
  <div class="card__foot">…</div>
</div>
```
Modifiers: `card--raised` (shadow, no border), `card--quiet` (sunken tint), `card--flush` (no padding, for lists inside), `card--interactive` (use it on an `<a>`, with hover lift) and `card--focus` (the dark-green "next up" card, one per page; a `btn--primary` inside it turns yellow).

```html
<div class="stat">
  <span class="stat__label">${icon('calendar')}Уроків цього тижня</span>
  <span class="stat__value">18</span>                                     <!-- or 12 400<span class="stat__unit">₴</span> -->
  <span class="stat__delta stat__delta--up">${icon('chevronUp','icon--sm')}на 3 більше</span>
</div>
```
Add `stat--attention` (highlighter-soft background) to a tile that needs action, for example "Чекає на перевірку".

## Lists and rows

```html
<ul class="list list--card">
  <li><a class="list-row" href="…">
    <span class="avatar avatar--3">МК</span>                    <!-- or <span class="list-row__lead">${icon('file')}</span> -->
    <span class="list-row__body">
      <span class="list-row__title">Марія К.</span>
      <span class="list-row__meta"><span class="level level--b1">B1</span><span>${icon('clock')}Сьогодні, 10:00</span></span>
    </span>
    <span class="list-row__trail">${icon('chevronRight')}</span>
  </a></li>
</ul>
```
On phones, put status badges inside `list-row__meta` rather than in the trail, so the title keeps its width.

## Tables (collapse to cards at ≤ 720px)

```html
<div class="table-wrap table-wrap--stack">
  <table class="table table--stack">
    <thead><tr><th>Учень</th><th>Рівень</th><th class="num">Баланс</th><th class="table__actions"><span class="sr-only">Дії</span></th></tr></thead>
    <tbody>
      <tr>
        <td class="table__primary">…name…</td>               <!-- becomes the card title -->
        <td data-label="Рівень"><span class="level level--b1">B1</span></td>
        <td data-label="Баланс" class="num">+900 ₴</td>
        <td class="table__actions"><button class="btn btn--ghost btn--icon btn--sm" aria-label="Дії для …">${icon('more')}</button></td>
      </tr>
    </tbody>
  </table>
</div>
```
Every `td` except `.table__primary` and `.table__actions` needs a `data-label`. Leave out the `--stack` classes to get a horizontally scrolling table instead.

## Badges, levels, statuses, chips

```html
<span class="level level--b1">B1</span>             <!-- a1 a2 b1 b2 c1 c2; .level--plain hides the step ticks -->
<span class="status status--submitted">Здано</span>
<span class="badge badge--hl">Нове</span>
<button class="chip" aria-pressed="true">Усі <span class="chip__count">24</span></button>
<span class="chip">B1<button class="chip__remove" aria-label="Прибрати фільтр B1">${icon('x','icon--sm')}</button></span>
```

| Status class | Ukrainian label |
|---|---|
| `status--assigned` | Призначено |
| `status--submitted` | Здано |
| `status--returned` | Повернуто |
| `status--graded` | Оцінено |
| `status--overdue` | Прострочено |
| `status--scheduled` | Заплановано |
| `status--done` | Проведено |
| `status--cancelled` | Скасовано |
| `status--no_show` (or `status--no-show`) | Неявка |

Badge variants: `badge--hl`, `--success`, `--warning`, `--danger`, `--info`, `--outline`, `--lg`. Chip containers: `.chips`, and `.chips--scroll` for a single scrolling row on mobile.

## Avatars

```html
<span class="avatar avatar--3">МК</span>
```
Sizes: `--xs` 24, `--sm` 32, default 40, `--lg` 56, `--xl` 80. Hues `avatar--1` … `avatar--6`: choose with `hash(name) % 6 + 1` so a person keeps the same colour everywhere. Add presence with `<span class="avatar__presence" aria-label="онлайн"></span>`. Overlap avatars with `.avatar-stack`.

## Tabs and segmented control

```html
<div class="tabs" role="tablist" aria-label="Домашні">
  <button class="tab" role="tab" aria-selected="true" aria-controls="p1">На перевірці <span class="tab__count">7</span></button>
  <button class="tab" role="tab" aria-selected="false" aria-controls="p2">Оцінені</button>
</div>

<div class="segmented" role="radiogroup" aria-label="Вигляд">   <!-- .segmented--block = full width -->
  <label><input type="radio" name="v" checked><span>День</span></label>
  <label><input type="radio" name="v"><span>Тиждень</span></label>
</div>
```

## Modal / bottom sheet

```html
<dialog class="modal" id="assign" aria-labelledby="assign-t">     <!-- .modal--wide = 800px -->
  <div class="sheet-handle" aria-hidden="true"></div>           <!-- shown only on mobile -->
  <div class="modal__head">
    <h2 class="modal__title" id="assign-t">Призначити завдання</h2>
    <button class="btn btn--ghost btn--icon modal__close" aria-label="Закрити">${icon('x')}</button>
  </div>
  <div class="modal__body">…</div>
  <div class="modal__foot"><button class="btn btn--secondary">Скасувати</button><button class="btn btn--primary">Призначити</button></div>
</dialog>
```
Open it with `dialog.showModal()`, which provides the focus trap, Esc and the backdrop. At ≤ 640px it turns into a bottom sheet with stacked full-width buttons, primary on top. To close on a backdrop click: `dialog.addEventListener('click', e => e.target === dialog && dialog.close())`. A destructive confirm says what will be lost, and its button names the action ("Скасувати урок").

## Toasts and alerts

```html
<div class="toast-region" aria-live="polite"> <!-- once per app -->
  <div class="toast toast--success" role="status">
    ${icon('checkCircle','toast__icon')}
    <div class="toast__body"><p class="toast__title">Завдання призначено</p><p>12 учнів отримали сповіщення</p></div>
    <button class="toast__action">Скасувати</button>                 <!-- or .toast__close icon button -->
  </div>
</div>
```
Variants: `toast--success`, `toast--error` (use `role="alert"`), `toast--info`. Add `toast--leaving` and remove the element after about 220ms. On mobile, toasts sit above the tab bar.

```html
<div class="alert alert--warning">${icon('alert')}<div><p class="alert__title">2 учні мають борг</p>Нагадайте про оплату.</div></div>
```
Alert variants: default (info), `--warning`, `--danger`, `--success`.

## Empty, loading, progress

```html
<div class="empty">  <!-- .empty--plain removes the dashed border -->
  <div class="empty__art">${icon('users')}</div>
  <p class="empty__title">Тут з’являться ваші учні</p>
  <p class="empty__text">Надішліть запрошення…</p>
  <button class="btn btn--primary">${icon('plus')}Запросити учня</button>
</div>

<span class="skeleton skeleton--text" style="width:60%"></span>   <!-- --title, --circle (set w/h), --block -->
<span class="sr-only" role="status">Завантаження…</span>

<div class="progress" role="progressbar" aria-valuenow="62" aria-valuemin="0" aria-valuemax="100" aria-label="Прогрес" style="--value:62%"><div class="progress__bar"></div></div>
<!-- .progress--hl (yellow), --sm, --lg; wrapper .progress-labeled > .progress-labeled__row -->

<div class="steps"><span class="steps__item steps__item--done"></span><span class="steps__item steps__item--current"></span><span class="steps__item"></span></div>
<span class="spinner" role="status" aria-label="Завантаження"></span>
```

## Calendar

Week grid (desktop):
```html
<div class="cal-toolbar">…prev/next + <span class="cal-toolbar__range">16–22 листопада</span>…</div>
<div class="week" style="--from:8; --hours:12">       <!-- first hour, number of hours; --hour = 64px row height -->
  <div class="week__corner"></div>
  <div class="week__day">Пн<span class="week__date">16</span></div>
  <div class="week__day week__day--today" aria-current="date">Вт<span class="week__date">17</span></div>
  … (7 day headers)
  <div class="week__times"><span class="week__time">08:00</span> … one per hour</div>
  <div class="week__col">
    <a class="event" href="…" style="--at:10; --len:1"><span class="event__title">Марія К.</span><span class="event__time">10:00–11:00</span></a>
  </div>
  <div class="week__col week__col--today"><span class="week__now" style="--at:9.6"></span>…</div>
  … (7 columns)
</div>
```
`--at` is the start hour as a decimal (10:30 → 10.5) and `--len` is the length in hours. Event variants: `event--group`, `event--done`, `event--cancelled`, and `event--compact` for lessons of 30 minutes or less.

Day strip and list (mobile):
```html
<div class="day-strip" role="tablist">
  <button class="day-strip__day day-strip__day--today" role="tab" aria-selected="true">Вт<span class="day-strip__num">17</span><span class="day-strip__dots"><i></i><i></i></span></button>
</div>
<div class="day-list">
  <div class="day-list__group">
    <p class="day-list__heading">Сьогодні <small>вівторок, 17 листопада</small></p>
    <a class="lesson lesson--now" href="…">
      <span class="lesson__time">10:00<small>60 хв</small></span>
      <span class="lesson__body"><span class="lesson__title">Марія К.</span><span class="lesson__meta"><span class="level level--b1">B1</span>Present Perfect</span></span>
      <span class="status status--scheduled">Скоро</span>
    </a>
  </div>
</div>
```

## Quiz

```html
<div class="quiz">
  <span class="quiz__counter">Питання 4 з 8</span>
  <div class="steps">…</div>
  <p class="quiz__question">I <span class="quiz__blank">&nbsp;</span> to London three times.</p>
  <ul class="quiz__options" role="radiogroup" aria-label="Варіанти відповіді">
    <li><button class="quiz-option" role="radio" aria-checked="false"><span class="quiz-option__key">A</span><span class="quiz-option__text">went</span></button></li>
  </ul>
  <div class="quiz__feedback quiz__feedback--incorrect" role="status"><strong>Не зовсім</strong>Пояснення…</div>
  <button class="btn btn--primary btn--block">Перевірити</button>
</div>
```
States: `aria-checked="true"` or `aria-pressed="true"` for the selected option. After checking, set `disabled` on every option, add `quiz-option--correct` or `quiz-option--incorrect`, append `${icon('checkCircle'|'xCircle','quiz-option__mark')}` and an `.sr-only` text ("Правильна відповідь"). For the result screen, use `.score` > `.score__value` ("7<small> / 8</small>").

## File upload

```html
<label class="dropzone">                     <!-- add .dropzone--over while dragging, .dropzone--error on error -->
  <input type="file" multiple accept="image/*,audio/*,.pdf" aria-describedby="dz-hint">
  <span class="dropzone__icon">${icon('upload')}</span>
  <span class="dropzone__title">Додайте фото або файл</span>
  <span class="dropzone__hint" id="dz-hint">JPG, PNG, PDF, аудіо до 10 МБ</span>
</label>
<ul class="thumbs">
  <li class="thumb"><img src="…" alt="Сторінка 1"><button class="thumb__remove" aria-label="Видалити фото 1">${icon('x')}</button></li>
  <li class="thumb thumb--uploading"><img …><div class="thumb__progress"><div class="progress progress--sm" style="--value:45%"><div class="progress__bar"></div></div></div></li>
  <li class="thumb"><div class="thumb__file">${icon('headphones')}speaking.m4a</div>…</li>
</ul>
```
On phones, `accept="image/*"` already offers the camera. `<input capture="environment">` forces the rear camera.

## Auth and landing

```html
<div class="auth">
  <div class="auth__panel">
    <form class="auth__form">
      <span class="brand brand--lg">…</span>
      <div class="stack stack--xs"><h1 class="h1">Вхід</h1><p class="muted">…</p></div>
      …fields…
      <button class="btn btn--primary btn--lg btn--block">Увійти</button>
      <div class="auth__divider">або</div>
    </form>
  </div>
  <aside class="auth__aside"><p class="auth__quote">…</p></aside>   <!-- hidden ≤ 900px -->
</div>
```
Role picker (sign-up and invites):
```html
<div class="auth__role" role="radiogroup" aria-label="Я">
  <label class="role-card"><input type="radio" name="role" value="teacher"><span>${icon('user')}Викладач</span></label>
  <label class="role-card"><input type="radio" name="role" value="student"><span>${icon('book')}Учень</span></label>
  <label class="role-card"><input type="radio" name="role" value="school"><span>${icon('school')}Школа</span></label>
</div>
```
Landing: `.landing-nav`, `.hero` (2 columns, `.hero__actions`), `.feature` > `.feature__icon`.

## Feedback button

`<button class="feedback-fab">${icon('feedback')}<span class="feedback-fab__label">Відгук</span></button>`, placed once inside `.app`. On mobile it shrinks to a 44px icon button above the tab bar, and the label stays available to screen readers.

## Accessibility checklist

- Text and background pairs are checked at 4.5:1 or better in both themes (muted text is 5.2:1 or better).
- Focus: a global `:focus-visible` 2px outline (blue in light, yellow in dark). Buttons and cards use `--ring`.
- Touch targets are 44px or more (buttons, inputs, nav, tabs, chips on touch screens, checkbox rows).
- Status is shown by text plus shape, never colour alone. CEFR badges carry step ticks.
- `prefers-reduced-motion` turns off animations and transitions. Spinners keep a slow spin.
- `viewport-fit=cover` and safe-area insets are respected by the top bar, tab bar and sheets.
