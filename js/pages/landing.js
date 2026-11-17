// #/ — public landing page for the beta.
import { state, signOut } from '../state.js';
import { html, raw } from '../utils.js';
import { icon, brand, brandMark, toast } from '../ui.js';
import { setTitle } from '../shell.js';
import { home } from '../main.js';
import { navigate } from '../router.js';

const I = (n, c) => raw(icon(n, c));

const FEATURES = [
  ['calendar', 'Розклад без хаосу', 'Тиждень на одному екрані, регулярні уроки в один клік, посилання на дзвінок завжди під рукою.'],
  ['users', 'Картка кожного учня', 'Рівень, цілі, тема наступного уроку, історія занять і приватні нотатки — все в одному місці.'],
  ['camera', 'Домашні з фото', 'Учень фотографує зошит з телефона, ви перевіряєте, ставите оцінку й пишете коментар.'],
  ['sparkles', 'Квізи з автоперевіркою', 'Тести з вибором і пропусками перевіряються самі. Оцінка — одразу за вашою шкалою.'],
  ['wallet', 'Оплати й баланс уроків', 'Скільки уроків оплачено, скільки проведено, хто в мінусі — без табличок і нагадувань у месенджерах.'],
  ['phone', 'Кабінет учня з телефона', 'Учень бачить розклад, домашні й прогрес. Без встановлення застосунку — просто посилання.'],
];

export default async function render({ view }) {
  setTitle('');
  document.title = 'Кмітливо — простір для репетиторів і онлайн-шкіл англійської';
  const logged = !!(state.user && state.role);
  const orphan = !!(state.user && !state.role);
  const cabinet = `#${home()}`;

  const navActions = logged
    ? html`<a class="btn btn--primary lp-nav-cabinet" href="${cabinet}">${I('home', 'icon--sm')}<span>Перейти в кабінет</span></a>`
    : html`<a class="btn btn--ghost lp-nav-login" href="#/login">Увійти</a><a class="btn btn--primary lp-nav-cta" href="#/signup"><span>Отримати доступ</span></a>`;

  view.innerHTML = String(html`<div class="lp">
    <header class="lp-header">
      <div class="container landing-nav">
        ${brand({ tag: false })}
        <nav class="lp-links hide-mobile" aria-label="Розділи">
          <a href="#features" data-scroll="features">Можливості</a>
          <a href="#how" data-scroll="how">Як це працює</a>
          <a href="#schools" data-scroll="schools">Для шкіл</a>
          <a href="#students" data-scroll="students">Учням</a>
        </nav>
        <div class="cluster lp-nav-actions">${navActions}</div>
      </div>
    </header>

    <main id="main">
      ${orphan ? html`<div class="container"><div class="alert alert--warning lp-orphan">${I('alert')}<div><p class="alert__title">Акаунт ще не привʼязаний до простору</p>Ви увійшли як ${state.user.email || ''}, але не належите до жодної школи чи вчителя. Якщо ви вчитель школи — приєднайтеся за кодом; якщо учень — попросіть у вчителя код запрошення. <div class="cluster" style="margin-top:var(--s-3)"><button class="btn btn--secondary btn--sm" type="button" data-action="logout">Вийти</button></div></div></div></div>` : ''}

      <section class="container hero lp-hero">
        <div class="lp-hero__copy">
          <span class="badge badge--hl badge--lg lp-eyebrow">${I('sparkles', 'icon--sm')}Бета за запрошенням · 2026</span>
          <h1 class="display lp-title">Уроки, учні й домашні — <span class="mark">в одному спокійному місці</span></h1>
          <p class="lead">Кмітливо — простір для репетиторів і онлайн-шкіл англійської. Розклад, картки учнів, домашні з фото, квізи з автоперевіркою й оплати. А в учня — власний кабінет у телефоні.</p>
          <div class="hero__actions">
            ${logged
              ? html`<a class="btn btn--primary btn--lg" href="${cabinet}"><span>Перейти в кабінет</span>${I('arrowRight')}</a>`
              : html`<a class="btn btn--primary btn--lg" href="#/signup"><span>Отримати бета-доступ</span>${I('arrowRight')}</a><a class="btn btn--secondary btn--lg" href="#students" data-scroll="students">${I('book', 'icon--sm')}<span>Я учень</span></a>`}
          </div>
          <ul class="lp-proof">
            <li>${I('check', 'icon--sm')}Працює з телефона й ноутбука</li>
            <li>${I('check', 'icon--sm')}Нічого не треба встановлювати</li>
            <li>${I('check', 'icon--sm')}Повністю українською</li>
          </ul>
        </div>
        ${heroVisual()}
      </section>

      <section class="lp-section" id="features" aria-labelledby="lp-f">
        <div class="container stack stack--xl">
          <div class="lp-head">
            <p class="lp-kicker">Можливості</p>
            <h2 class="lp-h2" id="lp-f">Усе, що зараз розкидано по месенджерах, нотатках і таблицях</h2>
          </div>
          <div class="grid-3 lp-features">
            ${FEATURES.map(([ic, t, d], i) => html`<article class="card feature lp-feature${i === 3 ? ' lp-feature--hl' : ''}">
              <span class="feature__icon">${I(ic)}</span>
              <h3 class="h3">${t}</h3>
              <p class="text-sm muted">${d}</p>
            </article>`)}
          </div>
        </div>
      </section>

      <section class="lp-section lp-section--tint" id="how" aria-labelledby="lp-how">
        <div class="container stack stack--xl">
          <div class="lp-head">
            <p class="lp-kicker">Як це працює</p>
            <h2 class="lp-h2" id="lp-how">Три кроки — і можна вести уроки</h2>
          </div>
          <ol class="lp-steps">
            <li class="lp-step"><span class="lp-step__n">1</span><h3 class="h3">Створіть простір</h3><p class="text-sm muted">Отримайте код бета-доступу й зареєструйтеся як репетитор або школа. Займає хвилину.</p></li>
            <li class="lp-step"><span class="lp-step__n">2</span><h3 class="h3">Додайте учнів</h3><p class="text-sm muted">Кожен учень отримує особисте посилання-запрошення. Надішліть його у Viber чи Telegram.</p></li>
            <li class="lp-step"><span class="lp-step__n">3</span><h3 class="h3">Ведіть уроки</h3><p class="text-sm muted">Плануйте розклад, задавайте домашні й квізи, відмічайте оплати. Учень бачить усе у своєму кабінеті.</p></li>
          </ol>
        </div>
      </section>

      <section class="lp-section lp-band" id="schools" aria-labelledby="lp-sch">
        <div class="container lp-band__grid">
          <div class="stack stack--lg">
            <p class="lp-kicker lp-kicker--light">Для онлайн-шкіл</p>
            <h2 class="lp-h2" id="lp-sch">Уся школа — в одному розкладі</h2>
            <p class="lp-band__lead">Запросіть вчителів за кодом школи. Кожен бачить своїх учнів, а ви — загальну картину.</p>
            <ul class="lp-checks">
              <li>${I('users')}<span><b>Кілька вчителів</b>Ролі вчителя й адміністратора, запрошення одним посиланням.</span></li>
              <li>${I('calendar')}<span><b>Загальний розклад</b>Уроки всіх вчителів школи — без перетинів і пропусків.</span></li>
              <li>${I('wallet')}<span><b>Оплати всіх учнів</b>Баланс кожного учня й борги школи на одному екрані.</span></li>
            </ul>
            ${logged ? '' : html`<div><a class="btn btn--primary btn--lg lp-band__cta" href="#/signup?kind=school"><span>Створити простір школи</span>${I('arrowRight')}</a></div>`}
          </div>
          <div class="lp-school" aria-hidden="true">
            <div class="lp-school__head"><span class="fw-600">English Hub</span><span class="badge badge--outline">Школа</span></div>
            <div class="lp-school__stats">
              <div><b>6</b><small>вчителів</small></div><div><b>84</b><small>учні</small></div><div><b>126</b><small>уроків / тиждень</small></div>
            </div>
            ${[['Ірина Савчук', 18, 'admin', 2], ['Олег Бондар', 15, 'teacher', 5], ['Наталія Гнатюк', 21, 'teacher', 3], ['Марко Ткач', 12, 'teacher', 6]].map(([n, c, r, h]) => html`<div class="lp-school__row">
              <span class="avatar avatar--sm avatar--${h}">${n.split(' ').map((w) => w[0]).join('')}</span>
              <span class="grow"><b>${n}</b><small>${r === 'admin' ? 'Адміністратор' : 'Вчитель'}</small></span>
              <span class="lp-school__count">${c} учнів</span>
            </div>`)}
          </div>
        </div>
      </section>

      <section class="lp-section" id="students" aria-labelledby="lp-st">
        <div class="container">
          <div class="lp-student">
            <div class="lp-student__art" aria-hidden="true">${I('book', 'icon--lg')}</div>
            <div class="stack stack--sm grow">
              <h2 class="lp-h2 lp-h2--sm" id="lp-st">Я учень</h2>
              <p class="muted">Вчитель надіслав код запрошення? Активуйте акаунт і створіть пароль. Уже активували — входьте зі своїм логіном.</p>
            </div>
            <div class="lp-student__actions">
              <a class="btn btn--soft btn--lg" href="#/activate">${I('sparkles', 'icon--sm')}<span>Маю код запрошення</span></a>
              <a class="btn btn--secondary btn--lg" href="#/login">Увійти з логіном</a>
            </div>
          </div>
        </div>
      </section>

      <section class="lp-section lp-section--last" aria-labelledby="lp-cta">
        <div class="container">
          <div class="lp-cta">
            <div class="stack stack--sm">
              <h2 class="lp-h2" id="lp-cta">Спробуйте Кмітливо першими</h2>
              <p class="lp-cta__text">Бета безкоштовна й працює за запрошеннями. Маєте код — створіть простір за хвилину й заповніть його прикладом, щоб одразу все побачити.</p>
            </div>
            <div class="lp-cta__actions">
              ${logged
                ? html`<a class="btn btn--primary btn--lg" href="${cabinet}"><span>Перейти в кабінет</span>${I('arrowRight')}</a>`
                : html`<a class="btn btn--primary btn--lg" href="#/signup"><span>Отримати доступ</span>${I('arrowRight')}</a><a class="btn btn--ghost btn--lg" href="#/join">Я вчитель школи</a>`}
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="lp-footer">
      <div class="container lp-footer__in">
        <div class="row">${brandMark()}<span class="text-sm"><b>Кмітливо</b> <span class="muted">· бета</span></span></div>
        <nav class="lp-footer__links" aria-label="Посилання">
          <a href="#/login">Вхід</a><a href="#/activate">Активація учня</a><a href="#/join">Вчителям шкіл</a><a href="#/signup">Бета-доступ</a>
        </nav>
        <p class="text-sm muted">by Danyil Boiko · © 2026</p>
      </div>
    </footer>
  </div>`);

  // smooth in-page scrolling (hash is used by the router, so scroll manually)
  view.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-scroll]');
    if (s) {
      e.preventDefault();
      const target = view.querySelector(`#${s.dataset.scroll}`);
      target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('[data-action="logout"]')) {
      await signOut();
      toast('Ви вийшли з акаунта');
      navigate('/', { replace: true });
    }
  });
}

function heroVisual() {
  return html`<div class="lp-visual" aria-hidden="true">
    <div class="lp-window">
      <div class="lp-window__bar"><i></i><i></i><i></i><span>Кмітливо · Головна</span></div>
      <div class="lp-window__body">
        <div class="lp-mini-side">
          ${brandMark()}
          <span class="lp-mini-nav lp-mini-nav--on">${I('home')}</span>
          <span class="lp-mini-nav">${I('calendar')}</span>
          <span class="lp-mini-nav">${I('users')}</span>
          <span class="lp-mini-nav">${I('inbox')}</span>
          <span class="lp-mini-nav">${I('wallet')}</span>
        </div>
        <div class="lp-mini-main">
          <p class="lp-mini-hello">Добрий ранок, Олено</p>
          <div class="card card--focus lp-next">
            <div class="row"><span class="text-xs lp-next__label">${I('clock', 'icon--sm')}Наступний урок · через 25 хв</span></div>
            <div class="row lp-next__who"><span class="avatar avatar--sm avatar--4">МК</span><span class="grow"><b>Марія Коваль</b><small>10:00 · Present Perfect</small></span><span class="level level--b1">B1</span></div>
            <span class="btn btn--primary btn--sm">${I('video', 'icon--sm')}Почати урок</span>
          </div>
          <div class="lp-mini-stats">
            <div class="stat"><span class="stat__label">${I('calendar')}Цього тижня</span><span class="stat__value">18</span></div>
            <div class="stat stat--attention"><span class="stat__label">${I('inbox')}На перевірці</span><span class="stat__value">7</span></div>
          </div>
          <ul class="list list--card lp-mini-list">
            <li class="list-row"><span class="avatar avatar--sm avatar--2">АП</span><span class="list-row__body"><span class="list-row__title">Андрій П.</span><span class="list-row__meta">${I('camera', 'icon--sm')}Workbook p. 42</span></span><span class="status status--submitted">Здано</span></li>
            <li class="list-row"><span class="avatar avatar--sm avatar--5">СЛ</span><span class="list-row__body"><span class="list-row__title">Софія Л.</span><span class="list-row__meta">${I('sparkles', 'icon--sm')}Quiz: Past Simple</span></span><span class="status status--graded">11 / 12</span></li>
          </ul>
        </div>
      </div>
    </div>

    <div class="lp-phone">
      <div class="lp-phone__screen">
        <div class="lp-phone__top"><span class="lp-phone__notch"></span></div>
        <p class="lp-phone__hi">Привіт, Маріє</p>
        <div class="quiz lp-quiz">
          <span class="quiz__counter">Питання 4 з 8</span>
          <div class="steps"><span class="steps__item steps__item--done"></span><span class="steps__item steps__item--done"></span><span class="steps__item steps__item--done"></span><span class="steps__item steps__item--current"></span><span class="steps__item"></span></div>
          <p class="quiz__question">I <span class="quiz__blank">have been</span> to London three times.</p>
          <ul class="quiz__options">
            <li><span class="quiz-option"><span class="quiz-option__key">A</span><span class="quiz-option__text">went</span></span></li>
            <li><span class="quiz-option quiz-option--correct" aria-checked="true"><span class="quiz-option__key">B</span><span class="quiz-option__text">have been</span>${I('checkCircle', 'quiz-option__mark')}</span></li>
          </ul>
        </div>
      </div>
    </div>

    <span class="lp-sticker">${I('checkCircle', 'icon--sm')}Перевірено автоматично</span>
  </div>`;
}
