#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"

pid_status() {
  label=$1
  file=$2
  if [ ! -f "$file" ]; then
    printf '  %-12s %s\n' "$label" 'not tracked'
    return
  fi
  pid=$(cat "$file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf '  %-12s running (pid %s)\n' "$label" "$pid"
  else
    printf '  %-12s stale/stopped\n' "$label"
  fi
}

printf 'Wharness status\n'
pid_status coordinator "$RUN_DIR/coordinator.pid"
pid_status backend "$RUN_DIR/backend.pid"
pid_status frontend "$RUN_DIR/frontend.pid"
pid_status electron "$RUN_DIR/electron.pid"

if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
  echo '  backend HTTP  healthy'
else
  echo '  backend HTTP  unavailable'
fi
if curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
  echo '  frontend HTTP healthy'
else
  echo '  frontend HTTP unavailable'
fi
