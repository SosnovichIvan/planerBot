#!/usr/bin/env bash
set -euo pipefail
cd /opt/planerbot
exec 9>/run/lock/planerbot-release.lock
flock -w 600 9
# Existing services use the current tag; renewing does not build/start the application.
export RELEASE_TAG
RELEASE_TAG=$(git describe --tags --exact-match HEAD)
compose=(docker compose --env-file /etc/planerbot/runtime.env -f deploy/compose.yaml -f deploy/proxy.yaml)
"${compose[@]}" run --rm --no-deps certbot renew --non-interactive --quiet
"${compose[@]}" exec -T gateway nginx -t
"${compose[@]}" exec -T gateway nginx -s reload
