# Локальный запуск

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

Polling не удаляет существующий webhook. Использовать отдельного тестового бота;
polling и webhook для одного токена не запускать одновременно.
Режим webhook: настроить HTTPS reverse proxy, непустой WEBHOOK_SECRET,
передать тот же secret_token при setWebhook. Endpoint `/telegram/webhook`
проверяет заголовок Telegram. Настройка внешнего webhook не выполняется автоматически.

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

```sh
docker compose exec -T db createdb -U planerbot planerbot_test
DATABASE_URL=postgresql+asyncpg://planerbot:local-development@localhost:55432/planerbot_test .venv/bin/alembic upgrade head
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
