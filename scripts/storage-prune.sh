#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"

HTTP_PORT=${WHARNESS_HTTP_PORT:-8888}
endpoint="http://127.0.0.1:$HTTP_PORT/api/storage/prune"
attempt=1
while [ "$attempt" -le 3 ]; do
  if result=$(curl --fail-with-body --silent --show-error --max-time 120 --request POST "$endpoint"); then
    printf '[storage] obsolete cleanup complete: %s\n' "$result"
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then
    printf '[storage] cleanup attempt %s failed; retrying...\n' "$attempt" >&2
    sleep 2
  fi
  attempt=$((attempt + 1))
done
printf '[storage] obsolete cleanup failed after 3 attempts: %s\n' "${result:-no response}" >&2
exit 1
