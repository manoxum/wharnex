#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"

HTTP_PORT=${WHARNESS_HTTP_PORT:-8888}
endpoint="http://127.0.0.1:$HTTP_PORT/api/storage/prune"
result=$(curl --fail --silent --show-error --max-time 120 --request POST "$endpoint")
printf '[storage] obsolete cleanup complete: %s\n' "$result"
