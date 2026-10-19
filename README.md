# planerBot

Telegram-бот и персональный календарь событий из нескольких чатов с темами и без.

Пользователь открывает календарь из подключённого чата и видит события только
тех подключённых чатов, в которых состоит. Администратор создаёт событие
в календаре или через бота, выбирает чат и тему; бот публикует карточку.
Сообщения с настроенным тегом также распознаются как события.

Реализованы персональный Mini App, проверка членства и ролей, настройки чатов,
создание/правка/отмена, импорт по тегу, публикации, RSVP, личные рассылки и отметки
изменений. Плановые напоминания и CRUD тем не реализованы; реальные Telegram-
клиенты требуют отдельной приёмки.

Начните с [полного описания текущего поведения](docs/current-behavior.md),
[матрицы приёмки](docs/acceptance.md) и [запуска Cypress/остальных тестов](docs/testing.md).

## Документация

- [Требования и критерии приёмки](docs/requirements.md).
- [Архитектурное предложение](docs/architecture.md).
- [План реализации](docs/implementation-plan.md).
- [Происхождение навыков и правила разработки](docs/development.md).
- [Инструкции агентам](AGENTS.md).
- [Локальный запуск и проверки](docs/local-development.md).
- [Контракт каркаса и проверка Telegram](docs/foundation.md).
- [События, настройки, парсинг и доставка](docs/events-implementation.md).
- [Автоподключение чатов и компактный календарь](docs/automatic-chat-calendar.md).
- [Создание события из календаря и команды /event](docs/event-creation-flow.md).
- [События выбранного дня, место и клавиатура чата](docs/day-events-and-location.md).
- [Ответы на события и личные уведомления](docs/event-rsvp.md).
- [Дизайн календаря и отметки изменений](docs/prototype-redesign.md).
- [Удаление события и аудит мобильных компонентов](docs/event-removal-and-ui-audit.md).
- [Техподдержка через команду /support](docs/support.md).
- [Маркеры начала события, текущая дата и проверка рассылки](docs/calendar-start-today-delivery.md).
- [VPS, HTTPS на IP, релиз и восстановление](docs/deployment.md).
- [Закрытый прокси для Telegram](docs/telegram-proxy.md).

Стек каркаса: Python 3.12 / aiogram / FastAPI, PostgreSQL 17,
React / TypeScript для Telegram Mini App. Стилизация — Tailwind CSS
(выбор пользователя). Точные зависимости фиксируются в requirements-dev.lock
и frontend/package-lock.json; runtime backend — requirements-prod.lock.

## Работа с репозиторием

Рабочая ветка → PR в `develop` → PR из `develop` в `main`.
Прямые push в `develop` и `main` запрещены правилами проекта.
Релиз — только по тегу `MAJOR.MINOR.PATCH` на коммите из истории `main`.

Секреты, токен Telegram, пользовательские сообщения и дампы БД не коммитятся.
