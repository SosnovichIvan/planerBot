# Проверки документации и приложения

## Быстрый запуск Cypress

Требуются Node 24.12+ и npm. Используется зафиксированный Cypress 15.21.1,
браузер Electron из его бинарника, start-server-and-test 3.0.13 и
cypress-real-events 1.15.1. Production-
бот, PostgreSQL, Telegram-токен и пароль VPS для этого набора **не нужны**.

```sh
cd frontend
npm ci
npm run e2e:trace
npm run typecheck
npm run e2e
```

`e2e` сам запускает Vite на `http://127.0.0.1:4173` со strictPort, ждёт
готовности, выполняет `e2e:run` и останавливает дочерний сервер при успехе/ошибке.
Занятый порт — ошибка, чужой сервер не завершается. Для интерактивной отладки:

```sh
# терминал 1
npm run dev -- --port 4173 --strictPort
# терминал 2
npm run e2e:open
# либо отдельная спецификация на уже запущенном сервере
npm run e2e:run -- --spec cypress/e2e/settings-layout.cy.ts
```

Cypress config запрещает другой baseUrl. Не менять этот guard для проверки
production. При переопределении `CYPRESS_CACHE_FOLDER` использовать одинаковое
значение при install и run. Если установлен только npm-пакет, бинарник можно
установить отдельно `npx cypress install`. Скачать его без postinstall позволяет
`CYPRESS_INSTALL_BINARY=0 npm ci`; затем нужен отдельный install перед E2E.
Документация вендора: [установка](https://docs.cypress.io/app/get-started/install-cypress),
[конфигурация](https://docs.cypress.io/app/references/configuration),
[перехват запросов](https://docs.cypress.io/api/commands/intercept),
[нативные события cypress-real-events](https://github.com/dmtrKovalenko/cypress-real-events).

Клавиатурные сценарии используют `cy.realPress` с настоящим фокусом, включая
browser-default действия Enter и Escape во вложенных dialog. В локальном
Electron встроенный `cy.press` не выполнял эти действия; ручной вызов `cancel`
не используется как замена проверке. Плагин работает в Chromium-браузерах:
этот набор запускается в Electron, совместимость с Firefox не заявляется.

## Что именно тестируется

Загружаются настоящие `index.html`, React entrypoint, компоненты и Tailwind CSS.
В код приложения не добавлены test-login, demo-user или ветка `window.Cypress`.
Тестовый Telegram SDK устанавливается только из Cypress до загрузки страницы;
CDN SDK заменён пустым ответом. Используется невалидная для реального сервера
тестовая строка initData — она никогда не отправляется на production.

Все `/api/**` перехватываются внутри `cypress/support/scenario.ts`. Неизвестный
route вызывает ошибку теста, а не сетевой fallback. Fixtures типизированы по
generated OpenAPI declarations. Подмена ответов моделирует сценарии UI и
записывает тело/ключ запросов, но **не является реализацией бизнес-правил сервера**.
Например, тест «counts скрыты» доказывает отрисовку `counts:null`, а реальные
HMAC, проверку членства и вычисление counts доказывают PostgreSQL/pytest-тесты.

Дата фиксирована на 17 октября 2026, подменяется только Date; обычные timers
работают. Встречи fixtures — 20 октября. Чаты/имена/ссылки полностью тестовые,
реальные ЛС и сообщения в Telegram не отправляются. Успешное создание в fixture
не доказывает работу production worker. `openTelegramLink` проверяет переданный
URL без внешнего перехода. Подтверждения browser confirm проверяются в тестах.

Spec-файлы:

- `access-calendar.cy.ts`: вход/ошибки/роли, страницы чатов, месяц/фильтр/повестка.
- `event-form.cy.ts`: создание, валидация, неизвестный исход, правка/no-op/уведомления.
- `rsvp-messages.cy.ts`: RSVP, аудитория, рассылки, разрешение ЛС, изменения.
- `settings-layout.cy.ts`: настройки, deep links, селекты, кнопки и прокрутка формы.

Реестр сценариев: [acceptance.md](acceptance.md). Проверка `e2e:trace` требует,
чтобы каждый ID UI-матрицы встретился в названии `it` и каждый тестовый ID был
описан. Она не подменяет assertions и не измеряет процент покрытия кода.
Новые тесты добавляются с новым ID и ожидаемым результатом в матрицу.

## Риски и границы

- Browser viewport — не эмуляция Telegram iPhone, soft keyboard или WebKit.
  Ручная матрица устройств обязательна отдельно.
- Проверки геометрии требуют ненулевой высоты полей, границ footer/окна,
  отсутствия горизонтального overflow и 44×44 для крестика. Это функциональные
  assertions, не сравнение скриншота и не гарантия полного WCAG-соответствия.
- E2E не выполняется на VPS и не очищает БД. Запуск pytest/миграций — другой слой.
- Нет retries, произвольных sleeps или подавления `uncaught:exception`: ошибка
  приложения должна завершать тест. Синхронизация — по DOM и intercept aliases.
- Cypress — dev dependency. Docker build пропускает загрузку его бинарника,
  тесты и screenshots не входят в gateway image. Runtime backend не изменён.
- npm audit на исходном наборе dev-зависимостей сообщает high advisory
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  в braces через micromatch/fast-glob/globby/Steiger. Это не пять разных CVE.
  Массовый `audit fix --force` с откатом Steiger не применяется в этой задаче;
  замечание не означает уязвимость опубликованного browser bundle, но требует
  отдельного решения по инструментам разработки. Чистый security audit не заявляется.

## Остальные проверки

```sh
# frontend
npm run lint
npm run typecheck
npm test
npm run build:check
npm run e2e:trace
npm run e2e
```

Vitest/V8 измеряет всю авторскую `src`, включая неимпортированные файлы,
с порогом 90% строк/ветвей/функций/statements. Generated declarations, test-файлы,
test-support и setup исключены явно. Cypress не заменяет и не понижает этот gate;
тестовый код Cypress находится вне production src и не включён в знаменатель.
TypeScript для приложения и Cypress проверяется раздельными конфигурациями,
чтобы Mocha/Chai не смешивались с Vitest/testing-library.

Backend: команды и подготовка изолированной `planerbot_test` описаны в
[local-development.md](local-development.md). pytest, migration check и smoke
работают на PostgreSQL 17. Их нельзя направлять на рабочую БД. Сначала миграция
тестовой БД, потом pytest; миграционные проверки и pytest не запускать параллельно
на одной БД. `check_coverage.py` отдельно контролирует backend lines/branches ≥90%.

## CI и результаты

PR workflow сохраняет существующие Branch policy, Backend, Frontend и Repository
hygiene. Добавлен job `Cypress scenarios`: Node 24.12, npm ci, cache бинарника по
lockfile, traceability и полный browser-run. Ошибка завершает job; screenshots
ошибок загружаются artifact на 7 дней. Cypress Cloud и record key не используются.
Логи runner остаются в GitHub Actions. Бинарник скачивается только в Cypress job;
обычные frontend-проверки и Docker build используют CYPRESS_INSTALL_BINARY=0.

Новый job не объявляется обязательным branch protection без отдельного изменения
настройки репозитория: его наличие в YAML и статус required — разные вещи.
Он выполняется для feature → develop и develop → main. Эти проверки не создают
релиз и не деплоят приложение. Выпуск остаётся только по проверенному тегу main.

Фактические результаты конкретного изменения фиксируются в описании PR и выводе
CI. Не переносить старые проценты/число тестов как доказательство нового коммита.
