#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"
PID_FILE="$RUN_DIR/coordinator.pid"

alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

if [ ! -f "$PID_FILE" ]; then
  echo 'Wharnex Desktop is not running (no coordinator pid file).'
  WHARNESS_ROOT="$ROOT" WHARNESS_SERVICES_MODE=stack "$ROOT/scripts/orphan-recovery.sh"
  exit 0
fi

pid=$(cat "$PID_FILE" 2>/dev/null || true)
if ! alive "$pid"; then
  echo 'Wharnex Desktop coordinator is not running; cleaning stale runtime files.'
  WHARNESS_ROOT="$ROOT" WHARNESS_SERVICES_MODE=stack "$ROOT/scripts/orphan-recovery.sh"
  rm -f "$RUN_DIR"/*.pid
  exit 0
fi

printf 'Stopping Wharnex Desktop coordinator %s...\n' "$pid"
kill -TERM "$pid" 2>/dev/null || true

i=0
while [ "$i" -lt 40 ]; do
  alive "$pid" || break
  i=$((i + 1))
  sleep 0.25
done
if alive "$pid"; then
  echo 'Desktop coordinator did not stop gracefully; sending SIGKILL.' >&2
  kill -KILL "$pid" 2>/dev/null || true
fi

rm -f "$RUN_DIR"/*.pid
printf 'Wharnex Desktop stopped. Compose services remain running.\n'
