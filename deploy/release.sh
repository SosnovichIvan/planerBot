#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/planerbot
test "$(id -u)" = 0
exec 9>/run/lock/planerbot-release.lock
flock -n 9
tag=${1:-}
[[ $tag =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
test "$(git remote get-url origin)" = https://github.com/SosnovichIvan/planerBot.git
git fetch origin main:refs/remotes/origin/main "refs/tags/$tag:refs/tags/$tag"
bash deploy/check-release.sh "$tag"
test "$(stat -c '%a:%U' /etc/planerbot/runtime.env)" = 600:root
export RELEASE_TAG=$tag
compose=(docker compose --env-file /etc/planerbot/runtime.env -f deploy/compose.yaml)
# Validation prints no secret values; env file is data, never sourced as shell code.
python3 deploy/validate-env.py /etc/planerbot/runtime.env
"${compose[@]}" config --quiet
docker build --target backend -t "planerbot-backend:$tag" .
docker build --target gateway -t "planerbot-gateway:$tag" .
"${compose[@]}" pull db certbot

# First certificate is obtained with an HTTP-only gateway, no application exposed.
if ! "${compose[@]}" run --rm --no-deps --entrypoint sh certbot -c 'test -s /etc/letsencrypt/live/193.124.129.252/fullchain.pem'; then
    docker compose --env-file /etc/planerbot/runtime.env -f deploy/compose.yaml -f deploy/bootstrap.yaml up -d gateway
    "${compose[@]}" run --rm --no-deps certbot certonly --non-interactive --agree-tos \
        --register-unsafely-without-email --required-profile shortlived \
        --webroot -w /var/www/acme --ip-address 193.124.129.252 \
        --cert-name 193.124.129.252
else
    "${compose[@]}" run --rm --no-deps certbot renew --non-interactive --quiet
fi

"${compose[@]}" stop api bot worker
"${compose[@]}" up -d --wait db
install -d -m 700 /var/backups/planerbot
backup="/var/backups/planerbot/$tag-$(date -u +%Y%m%dT%H%M%SZ).dump"
"${compose[@]}" exec -T db pg_dump -U planerbot -d planerbot -Fc >"$backup"
test -s "$backup"
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" up -d --wait api
"${compose[@]}" up -d bot worker gateway

install -m 644 deploy/planerbot-cert-renew.service deploy/planerbot-cert-renew.timer /etc/systemd/system/
install -m 700 deploy/renew-cert.sh /usr/local/sbin/planerbot-renew-cert
systemctl daemon-reload
systemctl enable --now planerbot-cert-renew.timer
curl --fail --silent --show-error --max-time 20 https://193.124.129.252/health/ready
"${compose[@]}" ps
