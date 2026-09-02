#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"
PID_FILE="$RUN_DIR/coordinator.pid"

alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

if [ ! -f "$PID_FILE" ]; then
  echo 'Wharness is not running (no coordinator pid file).'
  exit 0
fi

pid=$(cat "$PID_FILE" 2>/dev/null || true)
if ! alive "$pid"; then
  echo 'Wharness coordinator is not running; cleaning stale runtime files.'
  rm -f "$RUN_DIR"/*.pid
  exit 0
fi

printf 'Stopping Wharness coordinator %s...\n' "$pid"
kill -TERM "$pid" 2>/dev/null || true

i=0
while [ "$i" -lt 40 ]; do
  alive "$pid" || break
  i=$((i + 1))
  sleep 0.25
done

if alive "$pid"; then
  echo 'Coordinator did not stop gracefully; sending SIGKILL.' >&2
  kill -KILL "$pid" 2>/dev/null || true
fi

# dev.mjs owns and terminates only the child processes that it started.
i=0
while [ "$i" -lt 20 ]; do
  remaining=0
  for f in "$RUN_DIR/backend.pid" "$RUN_DIR/frontend.pid" "$RUN_DIR/electron.pid"; do
    [ -f "$f" ] || continue
    child=$(cat "$f" 2>/dev/null || true)
    alive "$child" && remaining=1 || true
  done
  [ "$remaining" -eq 0 ] && break
  i=$((i + 1))
  sleep 0.25
done

rm -f "$RUN_DIR"/*.pid
printf 'Wharness stopped.\n'
