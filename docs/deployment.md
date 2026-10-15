# VPS: релиз и восстановление

Цель: `https://193.124.129.252`, выделенный VPS Ubuntu с Docker Compose v2.
Без домена. Один экземпляр polling, один publication worker, один API и
PostgreSQL 17. Это пилот с коротким окном обслуживания, не zero-downtime rollout.

## Контракт поставки

Рабочая ветка → PR в develop → PR develop в main → неизменяемый тег MAJOR.MINOR.PATCH.
`deploy/check-release.sh` запрещает любой другой ref и тег вне истории origin/main.
Release workflow запускается только на push тега, сначала проверяет формат и
принадлежность main, затем проверяет контейнерные образы без изменения VPS.
Фактическая установка — явный запуск `deploy/release.sh TAG` на VPS из checkout
этого же тега. Скрипт повторно проверяет удалённую main и не переносит теги.

Секреты не входят в build context или образы. `/etc/planerbot/runtime.env`
(root:root, 0600) содержит новый BOT_TOKEN и случайный POSTGRES_PASSWORD (hex).
DATABASE_URL вычисляется Compose из пароля, без передачи через аргументы процессов.
Старый токен из переписки не использовать. GitHub secret BOT_TOKEN сам по себе
не копируется на VPS; после перевыпуска его обновляют в GitHub и на сервере.
Root-пароль заменить отдельно, не передавать Actions; доступ по проверенному SSH-ключу.

## Процессы и границы

- Gateway: только 80/443 наружу, статика и `/api/`, `/health/` → api:8000.
- API: один uvicorn, без наружного порта. Webhook снаружи не опубликован;
  WEBHOOK_SECRET пуст, используется только polling. OpenAPI/docs наружу не проксируются.
- Polling и worker: один экземпляр каждого, restart unless-stopped, остановка 40s.
- PostgreSQL: постоянный named volume, без опубликованного порта, healthcheck.
- Certbot: webroot challenge, постоянные сертификаты/ACME-аккаунт; timer каждые 12h,
  reload Nginx после успешной команды renew. Ошибка timer видна в systemd journal.

Формы и API без изменений, SQL и схемы без изменений (N/A новых индексов/миграций).
Перед обновлением всех writers останавливают, делают pg_dump, выполняют upgrade
и только затем запускают новую версию. База не удаляется ни одним release-скриптом.
При отказе миграции writers остаются остановлены; автоматического downgrade нет.

## Первичная подготовка

Проверить занятость 80/443, память, диск и доступ к api.telegram.org. На VPS 1.6 GiB
RAM; сборки идут последовательно. При нехватке памяти увеличить VPS или добавить
swap отдельно — скрипты не меняют swap, firewall, SSH и сторонние сервисы.

После слияния main создать тег на проверенном main-коммите и отправить его:

```sh
git fetch origin main
git tag 0.1.0 origin/main
git push origin 0.1.0
```

На VPS клонировать публичный репозиторий в `/opt/planerbot`, переключиться на тег.
Создать `/etc/planerbot` с правами 0700 и runtime.env с правами 0600, без истории
shell и без вывода токена. Поля из `deploy/runtime.env.example`.
Сначала проверить, что токен перевыпущен, webhook этого нового бота не настроен,
другой polling не запущен. Скрипт не вызывает deleteWebhook и не удаляет updates.

```sh
cd /opt/planerbot
bash deploy/release.sh 0.1.0
```

Первый запуск поднимает временный HTTP-only gateway для ACME challenge, получает
публично доверенный сертификат для IP (соглашение Let's Encrypt принимается оператором
через `ACME_AGREE_TOS=yes` в runtime.env), затем включает HTTPS. При отказе ACME
остаётся только HTTP challenge с 503 для приложения, без выдачи приватных данных.
Порт 80 должен оставаться доступным для продления. Сертификат действителен около
6 дней; timer обязателен. Установка timer — часть release.sh.

После запуска: `curl --fail https://193.124.129.252/health/ready`, браузер без
предупреждений о сертификате, `systemctl list-timers planerbot-cert-renew.timer`.
BotFather → Main Mini App → URL `https://193.124.129.252` (настройка вручную).
Реальная Telegram-приёмка: два forum-чата, разные членства, /setup, настройки
timezone/тем, создание/парсинг/правка/отмена, worker и запрет чужих событий.

## Обслуживание и восстановление

`docker compose --env-file /etc/planerbot/runtime.env -f deploy/compose.yaml ps`
(добавить `RELEASE_TAG=текущий-тег` в окружение). Логи могут содержать персональные
данные/ошибки провайдера; не публиковать их целиком. Docker log rotation 10MB × 3.

До каждой миграции release.sh сохраняет закрытый pg_dump custom format в
`/var/backups/planerbot/TAG-TIMESTAMP.dump`. Backups автоматически не удаляются;
нужны контроль диска, внешняя копия и политика retention перед расширением пилота.
Для первого пустого запуска дамп тоже создаётся. Резервные копии на том же VPS
не защищают от его потери. RPO — последний дамп, RTO не измерен.

Ошибка build/preflight не останавливает текущую версию. После остановки writers
ошибка backup/migration не запускает новую версию. Readiness не доказывает работу
Telegram; дополнительно проверить polling/worker logs и публикацию в тестовую тему.
При ошибке после миграции — forward fix; старую версию запускать только после
проверки совместимости схемы. Не применять `down -v` и не откатывать Alembic в production.
Восстановление дампа сначала в отдельную PostgreSQL 17 БД и проверка данных, затем
согласованное переключение. Автоматический destructive restore не реализован.

Код/Compose можно проверять локально с fake token; release-скрипт без разрешённого
тега отказывает до build/сети приложения. Реальный выпуск сертификата, prod restore
и Telegram-приёмка должны быть отмечены отдельно после первого запуска.

## Выполненные проверки

Локально: 136 pytest-тестов (24 из них — operational guards), backend 100% строк,
99.41% ветвей. `coverage run --branch --source=deploy -m pytest
backend/tests/test_deployment.py --no-cov` — отдельные 100% строк и ветвей
validate-env.py; shell-процент этим отчётом не измеряется. Ruff, mypy, ShellCheck
и обе Compose-конфигурации проверены. Python 3.12.14, pytest 9.1.1,
coverage.py 7.16.2; продуктовый backend-код не изменён.

Оба образа собраны для verification, `pip check` успешен. `bash deploy/smoke-test.sh`
проверяет изолированный Docker-проект: пустая PostgreSQL 17 → upgrade head,
readiness API в read-only контейнере от UID 10001, pg_dump/pg_restore в другую БД
с проверкой контрольной записи, bootstrap HTTP 503 → HTTPS с локально доверенным
одноразовым self-signed сертификатом, отдача статики, 401 без Telegram-подписи,
404 для внешнего webhook и `nginx -t`. Тестовые контейнеры/тома/сертификаты удалены
после проверки; обычная локальная БД не затронута. Этот smoke test включён в PR CI.
Это не доказательство доверия к будущему Let's Encrypt сертификату или работы
всех Telegram-клиентов. На VPS эти scripts ещё не запускались.

Источники: [IP-сертификаты Let's Encrypt](https://letsencrypt.org/2026/03/11/shorter-certs-certbot),
[Certbot renew/webroot](https://eff-certbot.readthedocs.io/en/stable/using.html).
