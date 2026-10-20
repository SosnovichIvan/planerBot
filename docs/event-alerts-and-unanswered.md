# Приглашения по галочке и список без ответа

Контракт реализации, 2026-10-20. Изменения ещё не выпущены.

- В каждой новой форме галочка приглашения включена. При checked новый active
  event атомарно ставит приглашение на каждого известного участника в durable
  очередь; при unchecked сервер не создаёт кампанию. Повтор submit не создаёт
  повторную кампанию; редактирование само по себе не приглашает.
- `notify_members=true` — явное намерение отправки. False или отсутствие поля
  не запускает рассылку. UI при создании передаёт true по умолчанию, при правке
  галочка остаётся выключенной. Старые fingerprints совместимы; existing active
  events не получают backfill. Импорт, /event и approve без галочки не запускают
  личные приглашения сами по себе.
- Автор больше не обязан оставаться администратором для доставки автоматического
  приглашения уже созданного события. Перед отправкой проверяются active event,
  включённая тема, текущее членство получателя и действующее согласие на личку.
  /stop, выход из чата, отмена и блокировка бота не обходятся.
- Bot API не даёт массово перечислить всех прежних участников чата. Реестр
  наполняется посещениями календаря и наблюдаемыми участниками/изменениями
  членства. Не обещать уведомление человеку, неизвестному боту/без разрешения.
- GET unanswered: текущий администратор **или** сохранённый creator, всё ещё
  состоящий в чате; остальные 403. Авторские права на список не дают прав
  редактирования/настроек/рассылок. Список известных участников: имя и Telegram ID,
  bounded keyset pages (50, raw cursor), проверка актуального членства и ответа.
  Обычные результаты голосования по-прежнему скрыты до собственного ответа;
  привилегированный список доступен независимо от собственного голоса.
- UI: отдельный вложенный drawer, loading/empty/error/retry/pagination, отмена
  запросов при закрытии/смене event. Никакой выдачи имён обычному пользователю.

Данные: существующие Event/CalendarParticipant/EventResponse и campaign outbox;
изменений схемы/миграции/backfill нет. Владение — event и RSVP services.
Invitation intent сохраняется в транзакции event; network только вне транзакций.
Roster SELECT: chat_id + NOT EXISTS response + user_id cursor ORDER/LIMIT;
существующие PK (chat_id,user_id), (event_id,user_id) подходят. Membership calls
ограничены размером страницы и concurrency; нет сетевого N+1 внутри транзакции.
Сверка страницы имеет общий deadline 15 секунд и concurrency 4. При отказе,
timeout или закрытии запроса незавершённые membership tasks отменяются;
неполная проверка не возвращает персональный список.

Проверки: PostgreSQL integration (new/pending/approve/replay/import/rollback,
consent/leave/cancel), API permissions/admin/creator/no-vote, pagination и сбои;
frontend unit/coverage, Cypress mobile/desktop, API generation, types/lint.
Реальные Telegram сообщения и production не использовать.

## Поставка и совместимость

Обновляются backend/worker и frontend; новая схема БД не нужна (`alembic check`
не нашёл upgrade operations). Этот PR не добавляет миграций; общий релиз может
включать миграции предыдущих PR, поэтому штатный migrator не отключается.
False из старого или нового frontend всегда означает отсутствие приглашения.
Поле сохранено для wire/fingerprint совместимости. Для включённой по умолчанию
галочки нужен refresh интерфейса. Обновлять API и worker следует одной версией: старый worker ещё
проверяет admin роль отправителя автоматического приглашения.

При откате к старому API новая кнопка списка может получить 404 с предложением
повтора; деплой должен синхронизировать frontend. Очередь и данные не очищаются.
Новые участники не добавляются задним числом в уже созданное приглашение.
Полный historical roster Telegram здесь не восстанавливается.

## Доказательства проверки

- PostgreSQL 17.11, изолированная `planerbot_test`; миграций нет. EXPLAIN ANALYZE
  реального SELECT на 1001 синтетическом участнике: LIMIT 51, Merge Anti Join,
  index scan существующего participants PK и index-only scan responses PK,
  actual rows 51, loops 1, 5 shared hits, 0.032 ms в одном локальном warm-run.
  Это не production benchmark/SLA. Снимок страницы и повторная проверка ответов
  — отдельные bounded запросы; измерено 8 SELECT на страницу (включая две
  проверки caller/chat), нет SQL SELECT на каждого участника.
- Backend: pytest 9.1.1 / Coverage.py 7.16.2, 367 tests; 99.94% lines / 99.15%
  branches по всем backend/src/planerbot, без новых exclusions. Новые RSVP,
  campaign, notice и observer paths — 100%. Ruff и mypy прошли.
- Frontend: Vitest 4.1.11, 105 tests; 99.61% lines / 93.45% branches для
  всего src (существующие exclusions test helpers/declarations). ESLint,
  Steiger, TypeScript, verification build и повторная API-генерация прошли.
- Cypress 15.21.1: 88 tests, 59 acceptance IDs; новые FORM-10, RSVP-04/05
  вместе с существующей acceptance матрицей;
  screenshots на 390×844 и 1280×844, проверка вертикального layout списка.
  Browser tests используют stub API. Backend integration отдельно проходит
  настоящий HTTP handler → PostgreSQL → worker → TelegramGateway → mock session,
  включая повтор POST с тем же ключом и оба значения галочки; это не live Telegram приёмка.

Проверены admin/creator/обычный участник, потеря прав и отмена во время lookup,
голос во время membership call, page cursor, timeout/cancellation, /stop/выход,
отсутствие рассылки после approve без галочки, одновременное создание и rollback intent.
Реальных сообщений не отправляли, VPS/production не изменяли.

Ограничения API сверены с [Telegram Bot API](https://core.telegram.org/bots/api#getchatmember).
