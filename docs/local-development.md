# Локальный запуск

Актуальный сценарий подключения: назначить бота администратором группы
с темами или без. `/setup` больше не обязателен; темы обнаруживаются по сообщениям.
Создавать события могут только администраторы, включая импорт по тегу.
Ограничения меню Telegram и приёмка: [automatic-chat-calendar.md](automatic-chat-calendar.md).

Требуются Python 3.12+, Node 24.12+ и Docker Compose. Выполнять из корня проекта.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.lock
.venv/bin/pip install --no-deps -e .
docker compose up -d db
.venv/bin/alembic upgrade head
```

Создать локальный `.env` по `.env.example` и вписать тестовый BOT_TOKEN
только в этот файл. Не отправлять токен в чат и не коммитить его.

API запускается отдельно:

```sh
.venv/bin/uvicorn planerbot.api:create_app --factory --host 127.0.0.1 --port 8000
```

Бот для разработки использует polling:

```sh
.venv/bin/python -c 'import asyncio; from planerbot.polling import run_polling; asyncio.run(run_polling())'
```

При необходимости задать TELEGRAM_PROXY_URL=http://127.0.0.1:19840 в .env после
запуска своего закрытого SSH-туннеля. Все три backend-процесса используют эту
настройку; при ошибке прокси прямого fallback нет. Оставить пустой для прямого доступа.

Polling не удаляет существующий webhook. Использовать отдельного тестового бота;
polling и webhook для одного токена не запускать одновременно.
Режим webhook: настроить HTTPS reverse proxy, непустой WEBHOOK_SECRET,
передать тот же secret_token при setWebhook. Endpoint `/telegram/webhook`
проверяет заголовок Telegram. Настройка внешнего webhook не выполняется автоматически.

Для публикации событий запустить отдельный worker с тем же BOT_TOKEN и DATABASE_URL:

```sh
.venv/bin/python -c 'import asyncio; from planerbot.worker import run_worker; asyncio.run(run_worker())'
```

API сохраняет событие и задание одной транзакцией; worker отправляет/обновляет
карточку в теме. Без worker события остаются в состоянии «Ожидает публикации».
Тот же worker обрабатывает личные уведомления и сообщения группам ответов.
Для ЛС пользователь разрешает сообщения в Mini App либо отправляет /start боту
в личке. /stop отключает ЛС во всех чатах; повторное открытие календаря не
отменяет отключение. Включить их снова можно личным /start.
После обновления кода сначала выполнить `alembic upgrade head`, затем перезапустить
API, polling и worker. До первой встречи выбрать часовой пояс чата в интерфейсе;
по умолчанию UTC. /event в личном диалоге открывает календарь; в теме принимает
структурированный шаблон. Настроенный тег импортирует сообщения и caption.

Frontend в другом терминале:

```sh
cd frontend
npm ci
npm run dev
```

Открыть http://127.0.0.1:5173. В обычном браузере показана инструкция входа через
Telegram. Браузерного обхода авторизации и демо-пользователя нет.
Для Telegram теста нужен HTTPS origin frontend с проксированием `/api` на API,
настроенный в Main Mini App через BotFather. Инструкция приёмки — foundation.md.

## Проверки

Browser-сценарии Cypress, их запуск без токена/БД и границы stub-проверок описаны
в [testing.md](testing.md). Полный контракт — [current-behavior.md](current-behavior.md).

```sh
docker compose exec -T db createdb -U planerbot planerbot_test
DATABASE_URL=postgresql+asyncpg://planerbot:local-development@localhost:55432/planerbot_test .venv/bin/alembic upgrade head
DATABASE_URL=postgresql+asyncpg://planerbot:local-development@localhost:55432/planerbot_test .venv/bin/python scripts/check_migrations.py
.venv/bin/ruff check backend scripts
.venv/bin/ruff format --check backend scripts
.venv/bin/mypy
.venv/bin/pytest
.venv/bin/python scripts/check_coverage.py
.venv/bin/python scripts/export_openapi.py
cd frontend
npm run generate:api
npm run lint
npm run typecheck
npm test
npm run build:check
```

Создавать тестовую БД нужно один раз. Интеграционные тесты очищают только
`planerbot_test`; не направлять их на рабочую базу. Изменения миграций проверяются
на PostgreSQL, а не SQLite. Генерация контракта должна оставлять clean diff.
`build:check` проверяет компиляцию в PR и не публикует релизный артефакт.
Миграционные проверки и pytest используют одну тестовую базу и выполняются
последовательно. Проверка миграции откатывается до 0001, создаёт тестовый чат
и подтверждает сохранение его данных после upgrade; это не команда для рабочей БД.
