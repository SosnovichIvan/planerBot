#!/usr/bin/env bash
# Isolated container verification: no real Telegram token, public ACME or VPS access.
set -euo pipefail
cd "$(dirname "$0")/.."
project=planerbot-verification
test -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")"
test -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")"
test_dir=$(mktemp -d)
export RELEASE_TAG=verification
export BOT_TOKEN=123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export POSTGRES_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
compose=(docker compose -p "$project" -f deploy/compose.yaml -f deploy/verification.yaml)
cleanup() {
    "${compose[@]}" down --volumes --remove-orphans
    # Only this test's mktemp directory; contains a disposable self-signed key/dump.
    rm -r -- "$test_dir"
}
trap cleanup EXIT
"${compose[@]}" up -d --wait --wait-timeout 120 db
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --wait --wait-timeout 150 api

"${compose[@]}" exec -T db psql -U planerbot -d planerbot -v ON_ERROR_STOP=1 \
    -c 'CREATE TABLE deployment_probe (id integer PRIMARY KEY); INSERT INTO deployment_probe VALUES (42)'
"${compose[@]}" exec -T db pg_dump -U planerbot -d planerbot -Fc >"$test_dir/probe.dump"
"${compose[@]}" exec -T db createdb -U planerbot restore_probe
"${compose[@]}" exec -T db pg_restore -U planerbot -d restore_probe --exit-on-error <"$test_dir/probe.dump"
test "$("${compose[@]}" exec -T db psql -U planerbot -d restore_probe -Atc 'SELECT id FROM deployment_probe')" = 42

docker compose -p "$project" -f deploy/compose.yaml -f deploy/bootstrap.yaml \
    -f deploy/verification.yaml up -d gateway
for _attempt in {1..20}; do
    if curl --silent --output /dev/null http://127.0.0.1:18080/; then break; fi
    sleep 1
done
test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:18080/)" = 503

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=193.124.129.252 \
    -addext 'subjectAltName=IP:193.124.129.252,IP:127.0.0.1' \
    -keyout "$test_dir/privkey.pem" -out "$test_dir/fullchain.pem" 2>/dev/null
docker run --rm --user 0 -v "$test_dir:/source:ro" \
    -v "${project}_letsencrypt:/target" --entrypoint sh planerbot-backend:verification \
    -c 'mkdir -p /target/live/193.124.129.252; cp /source/*.pem /target/live/193.124.129.252/'
"${compose[@]}" up -d gateway
for _attempt in {1..20}; do
    if curl --fail --silent --cacert "$test_dir/fullchain.pem" https://127.0.0.1:18443/health/ready; then break; fi
    sleep 1
done
curl --fail --silent --show-error --cacert "$test_dir/fullchain.pem" https://127.0.0.1:18443/health/ready
curl --fail --silent --show-error --cacert "$test_dir/fullchain.pem" \
    --output "$test_dir/index.html" https://127.0.0.1:18443/
test -s "$test_dir/index.html"
test "$(curl --silent --cacert "$test_dir/fullchain.pem" --output /dev/null --write-out '%{http_code}' https://127.0.0.1:18443/api/me)" = 401
test "$(curl --silent --cacert "$test_dir/fullchain.pem" --output /dev/null --write-out '%{http_code}' https://127.0.0.1:18443/telegram/webhook)" = 404
"${compose[@]}" exec -T gateway nginx -t
