#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)}
STATE_DIR="$ROOT/.harness/state"
LOCK_FILE=${WHARNESS_BUILD_OPERATION_LOCK:-$STATE_DIR/build-operation.lock}
LOCK_TIMEOUT_SECONDS=${WHARNESS_BUILD_LOCK_TIMEOUT_SECONDS:-1800}

if [ "$#" -eq 0 ]; then
  echo 'usage: build-lock.sh command [args...]' >&2
  exit 2
fi
case "$LOCK_TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    echo 'WHARNESS_BUILD_LOCK_TIMEOUT_SECONDS must be a non-negative integer.' >&2
    exit 2
    ;;
esac
command -v flock >/dev/null 2>&1 || {
  echo 'flock is required to serialize Wharnex build and dependency operations.' >&2
  exit 1
}

mkdir -p "$(dirname -- "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
waited=0
while ! flock -n 9; do
  if [ "$waited" -ge "$LOCK_TIMEOUT_SECONDS" ]; then
    echo 'Timed out waiting for another Wharnex build/dependency operation to finish.' >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done

"$@"
