#!/usr/bin/env bash
set -euo pipefail
tag=${1:-}
if [[ ! $tag =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    echo 'Expected an immutable MAJOR.MINOR.PATCH tag' >&2
    exit 1
fi
commit=$(git rev-parse --verify "refs/tags/$tag^{commit}")
git rev-parse --verify refs/remotes/origin/main >/dev/null
git merge-base --is-ancestor "$commit" refs/remotes/origin/main
test "$(git rev-parse HEAD)" = "$commit"
test -z "$(git status --porcelain --untracked-files=normal)"
printf '%s\n' "$commit"
