(function () {
  const icon = (name, size = 18) => {
    const paths = {
      copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      arrow: '<path d="m9 5 7 7-7 7"/>',
      file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
      home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 21v-8h6v8"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
      people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5v1"/>',
      upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  };
  const palette = [
    ['Canvas', '#0b0b0c', 'Глубина рабочего пространства'],
    ['Sidebar', '#101011', 'Нейтральная навигация'],
    ['Panel', '#19191b', 'Основа прозрачной поверхности'],
    ['Raised', '#242426', 'Поля и вложенные элементы'],
    ['Line', '#39393c', 'Тонкие границы и разделители'],
    ['Ivory', '#f3f3f3', 'Основной текст'],
    ['Secondary', '#96969c', 'Подписи и вспомогательный текст'],
    ['Clear', '#ededf0', 'Основное действие и свет'],
    ['Verified', '#c8c8ce', 'Получен и проверен'],
    ['Amber', '#c79761', 'Точечный сигнал внимания'],
    ['Coral', '#cd7373', 'Точечный сигнал просрочки']
  ];
  const swatches = palette.map(([name, value, description], i) => `<button class="kit-swatch" type="button" data-copy="${value}" aria-label="Скопировать цвет ${name}: ${value}"><span class="kit-swatch-color ${i > 4 ? 'kit-swatch-light' : ''}" style="--kit-swatch:${value}"><span class="kit-swatch-index">${String(i + 1).padStart(2, '0')}</span>${icon('copy', 16)}</span><span class="kit-swatch-meta"><span><strong>${name}</strong><span class="kit-swatch-description">${description}</span></span><code>${value.toUpperCase()}</code></span></button>`).join('');
  const spaceSteps = [4, 8, 12, 16, 24, 32, 48, 64].map(value => `<div class="kit-space-step"><span>${value}</span><i style="height:${value}px"></i><code>${value}px</code></div>`).join('');

  window.renderKit = function () {
    return `<div class="kit-page">
      <header class="kit-intro">
        <div><div class="eyebrow kit-kicker">Design system / 01</div><h1 class="kit-heading">Каждая деталь.<br><span>В одной системе.</span></h1><p class="kit-lead">Компоненты для спокойного и понятного сбора документов. Общий визуальный язык сайта и Telegram mini app.</p></div>
        <div class="kit-intro-note"><span class="kit-version">UI KIT <b>1.1</b></span><div class="kit-note-line"><i></i> Clear glass</div><p>Монохромная основа.<br>Прозрачный материал.<br>Свет по краям.</p></div>
      </header>

      <section class="kit-section" aria-labelledby="kit-palette-title">
        <div class="kit-section-head"><div><div class="eyebrow">01 / Foundations</div><h2 id="kit-palette-title">Цветовая система</h2></div><p>Нажмите на образец,<br>чтобы скопировать HEX.</p></div>
        <div class="kit-palette">${swatches}</div>
        <div class="kit-usage-note">${icon('check', 16)} <span>Монохром — основа интерфейса. Статус передают текст, иконка и маленькая сигнальная точка.</span></div>
      </section>

      <section class="kit-section" aria-labelledby="kit-material-title">
        <div class="kit-section-head"><div><div class="eyebrow">02 / Material</div><h2 id="kit-material-title">Clear glass</h2></div><p>Прозрачный слой, мягкое отражение.<br>Контент всегда остаётся читаемым.</p></div>
        <div class="kit-material-grid">
          <article class="kit-material-demo"><div class="kit-material-stage kit-material-stage-base"><div class="kit-glass-sample kit-glass-base"><span class="kit-glass-index">01 / Base</span><span class="kit-glass-number">12<span>/18</span></span><span class="kit-glass-caption">Общая готовность</span></div></div><div class="kit-material-info"><h3>Пространство</h3><p>Лёгкий слой для спокойного обзора.</p><div class="kit-material-recipe"><span>Fill <b>4%</b></span><span>Blur <b>16 px</b></span><span>Edge <b>6%</b></span></div></div></article>
          <article class="kit-material-demo"><div class="kit-material-stage kit-material-stage-panel"><div class="kit-glass-sample kit-glass-panel"><span class="kit-glass-index">02 / Panel</span><span class="kit-glass-doc">${icon('file', 24)} Свидетельство<br>о рождении</span><span class="kit-glass-caption">Мама · Кишинёв</span></div></div><div class="kit-material-info"><h3>Панель</h3><p>Основной материал карточки документа.</p><div class="kit-material-recipe"><span>Fill <b>6%</b></span><span>Blur <b>24 px</b></span><span>Edge <b>12%</b></span></div></div></article>
          <article class="kit-material-demo"><div class="kit-material-stage kit-material-stage-raised"><div class="kit-glass-sample kit-glass-raised"><span class="kit-glass-index">03 / Raised</span><span class="kit-glass-action">${icon('plus', 24)}<span>Добавить<br>документ</span></span><span class="kit-glass-caption">Ближайшее действие</span></div></div><div class="kit-material-info"><h3>Поверхность действия</h3><p>Больше света для активных элементов.</p><div class="kit-material-recipe"><span>Fill <b>10%</b></span><span>Blur <b>32 px</b></span><span>Edge <b>18%</b></span></div></div></article>
        </div>
        <div class="kit-usage-note">${icon('check', 16)} <span>Свет собирается в углах и на кромке. Янтарный и красный используются только в сигналах статуса.</span></div>
      </section>

      <section class="kit-section" aria-labelledby="kit-type-title">
        <div class="kit-section-head"><div><div class="eyebrow">03 / Typography</div><h2 id="kit-type-title">Типографика</h2></div><p>Manrope / system sans<br>Тонкая типографика, открытый ритм.</p></div>
        <div class="panel kit-type-panel">
          <div class="kit-type-main"><div class="kit-type-font">Aa</div><div><h3>Manrope</h3><p class="muted">Light · Regular · Medium</p><p class="kit-type-alphabet">Аа Бб Вв Гг Дд Ее Жж Зз<br>0123456789</p></div></div>
          <div class="kit-type-scale">
            <div class="kit-type-row"><span class="kit-type-hero">Документы</span><code>Display / 40 / 300</code></div>
            <div class="kit-type-row"><span class="kit-type-title">Моё дело</span><code>Title / 28 / 400</code></div>
            <div class="kit-type-row"><span class="kit-type-subtitle">Ближайшее действие</span><code>Section / 18 / 500</code></div>
            <div class="kit-type-row"><span class="kit-type-body">Свидетельство о рождении</span><code>Body / 14 / 400</code></div>
            <div class="kit-type-row"><span class="kit-type-caption">Получение · Кишинёв</span><code>Caption / 12 / 400</code></div>
            <div class="kit-type-row"><span class="kit-type-label">МОИ ДОКУМЕНТЫ</span><code>Label / 10 / 500</code></div>
          </div>
        </div>
      </section>

      <section class="kit-section" aria-labelledby="kit-space-title">
        <div class="kit-section-head"><div><div class="eyebrow">04 / Geometry</div><h2 id="kit-space-title">Интервалы и форма</h2></div><p>Базовый шаг — 4 px.<br>Крупные интервалы отделяют смысл.</p></div>
        <div class="kit-geometry"><div class="panel kit-space-panel"><div class="kit-component-label">Шкала интервалов</div><div class="kit-space-scale">${spaceSteps}</div></div><div class="panel kit-radius-panel"><div class="kit-component-label">Радиусы</div><div class="kit-radius-items"><div><span class="kit-radius-sample kit-radius-small"></span><b>6 px</b><small>Метки</small></div><div><span class="kit-radius-sample kit-radius-mid"></span><b>12 px</b><small>Поля</small></div><div><span class="kit-radius-sample kit-radius-button"></span><b>12 px</b><small>Кнопки</small></div><div><span class="kit-radius-sample kit-radius-large"></span><b>24 px</b><small>Панели</small></div><div><span class="kit-radius-sample kit-radius-phone"></span><b>43 px</b><small>iPhone</small></div></div></div></div>
      </section>

      <section class="kit-section" aria-labelledby="kit-components-title">
        <div class="kit-section-head"><div><div class="eyebrow">05 / Components</div><h2 id="kit-components-title">Из деталей в интерфейс</h2></div><p>Примеры можно редактировать.<br>Данные ниже — демонстрационные.</p></div>
        <div class="kit-component-grid">
          <article class="panel kit-component-card"><div class="kit-component-heading"><h3>Кнопки</h3><span>01</span></div><p class="kit-component-copy">Одно основное действие на экран. Иконка дополняет короткий глагол.</p><div class="kit-button-samples"><button class="btn btn-primary" type="button" data-screen="add">${icon('plus')} Добавить документ</button><button class="btn kit-btn-secondary" type="button" data-screen="detail">Подробнее ${icon('arrow', 15)}</button><button class="btn kit-btn-quiet" type="button" data-view="overview">Отмена</button><button class="btn kit-btn-disabled" type="button" disabled>Сохранено ${icon('check', 15)}</button><button class="kit-icon-button" type="button" data-screen="detail" aria-label="Пример кнопки загрузки">${icon('upload')}</button></div><div class="kit-component-foot">Высота 44 px · Фокус с видимой обводкой</div></article>
          <article class="panel kit-component-card"><div class="kit-component-heading"><h3>Поля ввода</h3><span>02</span></div><div class="kit-field-grid"><div class="field kit-field"><label for="kit-doc-name">Название документа</label><input id="kit-doc-name" type="text" value="Свидетельство о рождении" autocomplete="off"></div><div class="field kit-field"><label for="kit-doc-person">Владелец</label><select id="kit-doc-person"><option>Мама</option><option>Я</option><option>Дедушка</option></select></div><div class="field kit-field"><label for="kit-doc-city">Город получения</label><input id="kit-doc-city" type="text" value="Кишинёв" autocomplete="off"></div><div class="field kit-field"><label for="kit-doc-date">Действует до</label><input id="kit-doc-date" type="date" value="2026-12-18"></div></div><div class="kit-field-help">Дата неизвестна? Поле можно заполнить позже.</div></article>
          <article class="panel kit-component-card"><div class="kit-component-heading"><h3>Статусы</h3><span>03</span></div><p class="kit-component-copy">Получение и срок действия — две независимые характеристики документа.</p><div class="kit-status-group"><div class="kit-component-label">Получение</div><div class="kit-badge-row"><span class="badge kit-badge-neutral">Не добавлен</span><span class="badge pending">Нужно запросить</span><span class="badge warning">В работе</span><span class="badge ready">${icon('check', 12)} Получен</span></div></div><div class="kit-status-group"><div class="kit-component-label">Срок действия</div><div class="kit-badge-row"><span class="badge ready">Действителен</span><span class="badge warning">Истекает скоро</span><span class="badge expired">Истёк</span><span class="badge kit-badge-neutral">Нужно проверить</span></div></div></article>
          <article class="panel kit-component-card"><div class="kit-component-heading"><h3>Люди и группы</h3><span>04</span></div><p class="kit-component-copy">Владелец остаётся видимым на всех этапах. Нейтральные аватары различаются инициалами и глубиной тона.</p><div class="kit-people-list"><div class="kit-person"><span class="avatar kit-avatar-self">Я</span><div><strong>Мои документы</strong><small>3 из 5 получено</small></div><span class="kit-person-count">03 / 05</span></div><div class="kit-person"><span class="avatar mom kit-avatar-mom">М</span><div><strong>Мама</strong><small>2 из 4 получено</small></div><span class="kit-person-count">02 / 04</span></div><div class="kit-person"><span class="avatar grand kit-avatar-grandpa">Д</span><div><strong>Дедушка</strong><small>2 из 3 получено</small></div><span class="kit-person-count">02 / 03</span></div></div></article>
        </div>
        <article class="panel kit-wide-component"><div class="kit-component-heading"><h3>Строка документа</h3><span>05</span></div><p class="kit-component-copy">Название, человек, место и состояние читаются в одном проходе.</p><div class="kit-document-row"><div class="kit-doc-icon">${icon('file', 22)}</div><div class="kit-doc-info"><strong>Свидетельство о рождении</strong><span><b>Мама</b><i></i> Кишинёв <i></i> Выдано 18 июня 2026</span></div><div class="kit-doc-state"><span class="badge ready">${icon('check', 12)} Получен</span><small>Действует до 18 декабря</small></div><button type="button" class="kit-icon-button" data-screen="detail" aria-label="Пример открытия документа">${icon('arrow')}</button></div><div class="kit-document-row"><div class="kit-doc-icon">${icon('file', 22)}</div><div class="kit-doc-info"><strong>Архивная выписка</strong><span><b>Дедушка</b><i></i> Бельцы <i></i> Запрос от 8 октября</span></div><div class="kit-doc-state"><span class="badge warning">В работе</span><small>Ожидается 24 октября</small></div><button type="button" class="kit-icon-button" data-screen="detail" aria-label="Пример открытия запроса">${icon('arrow')}</button></div></article>
        <div class="kit-component-grid kit-component-grid-bottom">
          <article class="panel kit-component-card"><div class="kit-component-heading"><h3>Навигация</h3><span>06</span></div><p class="kit-component-copy">Четыре понятных раздела. Активный раздел выделен светом и прозрачной формой.</p><div class="kit-nav-sample" role="group" aria-label="Пример нижней навигации"><button type="button" class="kit-nav-item kit-nav-active" data-screen="home" aria-pressed="true">${icon('home', 22)}<span>Обзор</span></button><button type="button" class="kit-nav-item" data-screen="documents" aria-pressed="false">${icon('file', 22)}<span>Документы</span></button><button type="button" class="kit-nav-item" data-screen="family" aria-pressed="false">${icon('people', 22)}<span>Семья</span></button><button type="button" class="kit-nav-item" data-screen="plan" aria-pressed="false">${icon('calendar', 22)}<span>План</span></button></div><div class="kit-component-foot">Область нажатия ≥ 44 px · Подписи всегда видимы</div></article>
          <article class="panel kit-component-card"><div class="kit-component-heading"><h3>Пустое состояние</h3><span>07</span></div><div class="kit-empty-state"><div class="kit-empty-icon">${icon('file', 27)}<span>+</span></div><h4>Начнём с первого документа</h4><p>Добавьте название и владельца.<br>Скан и даты можно прикрепить позже.</p><button class="btn btn-primary" type="button" data-screen="add">${icon('plus', 16)} Добавить документ</button></div></article>
        </div>
      </section>
      <footer class="kit-footer"><span>Kinpass / Design system</span><span>Clear glass · Manrope · Монохром</span><span>01 — 05</span></footer>
    </div>`;
  };
})();
