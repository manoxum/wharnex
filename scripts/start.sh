#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"
LOG_DIR="$ROOT/.harness/logs"
PID_FILE="$RUN_DIR/coordinator.pid"
LOG_FILE="$LOG_DIR/desktop.log"
BUILD_STAMP="$ROOT/.harness/build-success"

mkdir -p "$RUN_DIR" "$LOG_DIR"

alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if alive "$pid"; then
    printf 'Wharness is already running (pid %s).\n' "$pid"
    printf 'Use: make status | make logs | make stop\n'
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [ ! -f "$BUILD_STAMP" ]; then
  echo 'No successful Wharness build is recorded. Run: make build' >&2
  exit 1
fi

# Refuse to launch stale compiled artifacts after source/configuration changes.
if find \
  "$ROOT/Makefile" \
  "$ROOT/scripts" \
  "$ROOT/docker" \
  "$ROOT/services/backend" \
  "$ROOT/services/frontend/src" \
  "$ROOT/services/frontend/index.html" \
  "$ROOT/services/frontend/package.json" \
  "$ROOT/services/frontend/package-lock.json" \
  "$ROOT/services/frontend/vite.config.ts" \
  "$ROOT/services/frontend/tsconfig.json" \
  "$ROOT/services/frontend/tsconfig.app.json" \
  "$ROOT/services/frontend/tsconfig.node.json" \
  "$ROOT/services/desktop" \
  -type f -newer "$BUILD_STAMP" \
  ! -path '*/node_modules/*' \
  ! -path '*/dist/*' \
  ! -name '*.log' \
  ! -name '*.tsbuildinfo' \
  -print -quit 2>/dev/null | grep -q .; then
  echo 'Wharness build is stale because source/configuration files changed. Run: make build' >&2
  exit 1
fi

if [ ! -x "$ROOT/services/desktop/node_modules/.bin/electron" ]; then
  echo 'Electron dependencies are missing. Run: make build' >&2
  exit 1
fi
if [ ! -x "$ROOT/services/frontend/node_modules/.bin/vite" ]; then
  echo 'Frontend dependencies are missing. Run: make build' >&2
  exit 1
fi

if [ "$(uname -s 2>/dev/null || printf unknown)" = "Linux" ]; then
  if ! WHARNESS_LINUX_SANDBOX_MODE=$(WHARNESS_ROOT="$ROOT" "$ROOT/scripts/electron-sandbox.sh" mode); then
    exit 1
  fi
  export WHARNESS_LINUX_SANDBOX_MODE
  # Electron validates the chrome-sandbox shipped beside its own executable.
  # Do not redirect SUID execution through CHROME_DEVEL_SANDBOX; on packaged
  # Chromium/Electron builds that developer override is not a reliable launch path.
  unset CHROME_DEVEL_SANDBOX 2>/dev/null || true
fi

: > "$LOG_FILE"

(
  cd "$ROOT/services/desktop"
  nohup env \
    WHARNESS_ROOT="$ROOT" \
    WHARNESS_RUNTIME_DIR="$RUN_DIR" \
    HARNESS_STATE_FILE="$ROOT/.harness/state/sessions.json" \
    WHARNESS_RUNNER_IMAGE="${WHARNESS_RUNNER_IMAGE:-kernl-runner:local}" \
    WHARNESS_OZONE_PLATFORM="${WHARNESS_OZONE_PLATFORM:-auto}" \
    node dev.mjs >>"$LOG_FILE" 2>&1 </dev/null &
  echo $! > "$PID_FILE"
)

pid=$(cat "$PID_FILE")
i=0
while [ "$i" -lt 80 ]; do
  if ! alive "$pid"; then
    echo 'Wharness failed to start. Last log lines:' >&2
    tail -n 60 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  backend_ok=0
  frontend_ok=0
  electron_ok=0
  curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && backend_ok=1 || true
  curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1 && frontend_ok=1 || true
  if [ -f "$RUN_DIR/electron.pid" ]; then
    ep=$(cat "$RUN_DIR/electron.pid" 2>/dev/null || true)
    alive "$ep" && electron_ok=1 || true
  fi
  if [ "$backend_ok" -eq 1 ] && [ "$frontend_ok" -eq 1 ] && [ "$electron_ok" -eq 1 ]; then
    printf 'Wharness Desktop started.\n'
    printf '  coordinator: %s\n' "$pid"
    printf '  backend:     http://127.0.0.1:8080\n'
    printf '  frontend:    http://127.0.0.1:5173\n'
    printf '  logs:        %s\n' "$LOG_FILE"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.25
done

echo 'Wharness did not become fully ready. Last log lines:' >&2
tail -n 60 "$LOG_FILE" >&2 || true
exit 1
