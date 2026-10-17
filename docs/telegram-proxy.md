# Telegram через закрытый Squid

Источник инфраструктуры: локальный проект `vpn_proxy_server`, его SSH-доступ и
Squid `10.66.66.1:3128` на proxy VPS. Конфигурацию VPN/firewall/Squid не меняем.
У HTTP-прокси нет публичного порта: HTTPS CONNECT достигается только через SSH.

## Контракт

`TELEGRAM_PROXY_URL` — приватная настройка backend, не frontend/OpenAPI.
Для локальной разработки пустое значение означает прямой доступ. Непустое —
HTTP URL с host и явным port, без credentials/path/query/fragment. Настройка
скрыта в repr и validation errors. На целевом VPS runtime validator требует
`http://telegram-proxy:19840`; автоматического fallback на прямой запрос нет.

API, polling и publication worker используют одну фабрику Bot и AiohttpSession
с явным proxy connector. Сохраняются TLS-проверка сертификата Telegram и текущие
request timeouts. Ошибки aiohttp-socks нормализуются в TelegramNetworkError:
membership отвечает недоступностью проверки, публикация — unknown без слепого
повтора. Ошибки прокси не включаются в публичный текст/traceback cause.

На VPS production Compose дополняется `deploy/proxy.yaml`. Отдельный контейнер
`telegram-proxy` выполняет SSH -NT к настроенному proxy VPS; порт 19840 слушает
только внутри Docker-сети, `ports` нет. Ключ и known_hosts монтируются read-only
через Compose secrets из `/etc/planerbot`, отсутствуют в образах/build context.
SSH: StrictHostKeyChecking, IdentitiesOnly, ExitOnForwardFailure, keepalive.
После обрыва restart policy восстанавливает туннель. TCP healthcheck подтверждает
listener, а не Telegram: отдельный preflight проверяет HTTPS HEAD через тот же
connector и ту же Docker-сеть без BOT_TOKEN, до остановки writers/миграций.

## Подготовка ключа

На VPS бота в `/etc/planerbot/proxy_ed25519` создан отдельный ключ (root:root 0600).
В authorized_keys proxy-сервера добавлен только его публичный ключ с `restrict`,
разрешением port forwarding, `permitopen="10.66.66.1:3128"` и forced command
`/bin/false`. Shell/PTY/agent forwarding для этого ключа не используются.
Host key скопирован из уже проверенного known_hosts; проверка TLS/SSH не отключается.
Ни приватный ключ, ни runtime.env не должны попадать в Git/GitHub Actions logs.

Дополнить `/etc/planerbot/runtime.env` полем TELEGRAM_PROXY_URL из example;
остальные секреты и правила перевыпуска BOT_TOKEN остаются прежними.
Внешние backups/restore БД без изменений, новых SQL/миграций нет.

Команды обслуживания используют оба файла:

```sh
RELEASE_TAG=0.1.0 docker compose --env-file /etc/planerbot/runtime.env \
  -f deploy/compose.yaml -f deploy/proxy.yaml ps
```

Номер тега — пример, не созданный релиз. Изменения по-прежнему проходят
рабочая ветка → develop → main → тег. Подготовка SSH-ключа и сетевые проверки
не означают развёртывания приложения. ACME, PostgreSQL и входящий HTTPS не
направляются через Telegram-прокси. WARP для этой схемы не нужен; маршруты
VPS остаются прежними.

## Проверки

2026-10-15: приватный Squid с proxy-сервера вернул Telegram HTTP 302.
С VPS бота через новый ограниченный ключ и временный localhost-туннель — 302;
одноразовый Python-контейнер с host networking через тот же туннель — 200
после redirect. Токен не использовался, тестовый туннель закрыт. Это проверка
сети, не Telegram Bot API getMe/создания события и не приёмка в Mini App.

Unit tests проверяют proxy/direct config, валидацию без раскрытия значений,
единый Bot session, preflight success/failure, отсутствие fallback, нормализацию
ошибок и закрытие session. Container/CI проверки собирают backend и SSH image,
проверяют Compose и прежний изолированный DB/HTTPS smoke test.

Локальный итог: 165 pytest-тестов, backend 100% строк и 99.44% ветвей
(coverage.py 7.16.2, весь backend/src/planerbot без исключения новых модулей).
network.py и конфигурация прокси — 100% строк/ветвей. Runtime validator отдельно
100% строк/ветвей; shell coverage этим отчётом не измеряется. Ruff/mypy/ShellCheck
прошли, OpenAPI не изменился. Прикладные данные и публичные HTTP-контракты прежние.

Источник API: [aiogram AiohttpSession proxy](https://docs.aiogram.dev/en/latest/api/session/aiohttp.html).

## Docker registry на VPS (2026-10-17)

Прямой HTTPS к `registry-1.docker.io` на VPS даёт TLS/connect timeout.
Docker daemon использует отдельный host-level SSH tunnel к тому же закрытому
Squid. Контейнер `telegram-proxy` для этого не используется: Docker должен
уметь скачивать образы даже без запущенных контейнеров.

- `planerbot-registry-proxy.service` слушает **только 127.0.0.1:19841**.
- Использует существующие ограниченный ключ и проверенный known_hosts из
  `/etc/planerbot`; содержимое ключа не копируется в репозиторий.
- Docker drop-in задаёт HTTP_PROXY/HTTPS_PROXY для daemon; NO_PROXY исключает
  loopback и внутренние сети. Это не proxy-конфигурация приложений/контейнеров.
- TLS остаётся end-to-end: ни insecure registry, ни отключения проверки
  сертификатов, ни публичного unauthenticated proxy нет.
- Изменения Squid, WireGuard, firewall и глобальной маршрутизации не требуются.

Шаблоны: `deploy/planerbot-registry-proxy.service` и
`deploy/docker-registry-proxy.conf`. Установка root на согласованном VPS:

```sh
install -m 644 deploy/planerbot-registry-proxy.service /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/planerbot-registry-proxy.service
systemctl daemon-reload
systemctl enable --now planerbot-registry-proxy.service
curl --proxy http://127.0.0.1:19841 -I https://registry-1.docker.io/v2/
```

Ожидается 401 от registry (не 000 и не proxy 403). Только после успешной
проверки и резервного pg_dump, в согласованное окно обслуживания:

```sh
install -d -m 755 /etc/systemd/system/docker.service.d
install -m 644 deploy/docker-registry-proxy.conf /etc/systemd/system/docker.service.d/planerbot-registry-proxy.conf
systemctl daemon-reload
systemctl restart docker
docker pull postgres:17-alpine
docker pull certbot/certbot:v5.8.0
```

На этом VPS Docker live-restore выключен: restart кратковременно останавливает
контейнеры; restart policies возвращают их, но readiness/состояние БД нужно
проверить отдельно. Туннель автоматически перезапускается при разрыве SSH;
`After` задаёт порядок запуска, а не гарантирует готовность удалённого Squid.
Ошибка pull требует проверки туннеля, не отключения TLS или прямого fallback.
Для диагностики: `systemctl status planerbot-registry-proxy` и закрытый journal;
не публиковать ключи, runtime.env и персональные данные из прикладных логов.

Откат: сохранить копию/удалить **только** drop-in
`/etc/systemd/system/docker.service.d/planerbot-registry-proxy.conf`, затем
daemon-reload/restart Docker в окно обслуживания; только после этого выключить
registry tunnel. Иначе Docker останется с proxy на неработающем localhost.
Другие Docker drop-ins/daemon.json не перезаписывать. Без доступного прямого
Docker Hub откат вернёт исходный сетевой отказ и не является способом выпуска.

Фактически проверены systemd unit, loopback bind, registry 401 и настоящие pull
PostgreSQL/Certbot. До изменения Docker сохранён закрытый pg_dump в
`/var/backups/planerbot/pre-registry-proxy-20261017T114147Z.dump` (0600).
Это эксплуатационная настройка VPS, не изменение кода/схемы приложения.
