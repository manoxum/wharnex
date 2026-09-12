#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"
LOG_DIR="$ROOT/.harness/logs"
PID_FILE="$RUN_DIR/coordinator.pid"
LOG_FILE="$LOG_DIR/desktop.log"
BUILD_STAMP="$ROOT/.harness/build-success"
# Optional per-checkout overrides (Electron profile dir, etc). Gitignored.
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"

mkdir -p "$RUN_DIR" "$LOG_DIR"

alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if alive "$pid"; then
    printf 'Wharnex Desktop is already running (pid %s).\n' "$pid"
    printf 'Use: make status | make logs | make stop\n'
    exit 0
  fi
  rm -f "$PID_FILE"
fi

WHARNESS_ROOT="$ROOT" WHARNESS_SERVICES_MODE=stack "$ROOT/scripts/orphan-recovery.sh"

if [ ! -f "$BUILD_STAMP" ]; then
  echo 'No successful Wharnex build is recorded. Run: make build' >&2
  exit 1
fi

if find \
  "$ROOT/Makefile" \
  "$ROOT/compose.yml" \
  "$ROOT/scripts" \
  "$ROOT/services/backend" \
  "$ROOT/services/tunnel" \
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
  echo 'Wharnex build is stale because source/configuration files changed. Run: make build' >&2
  exit 1
fi

if [ ! -x "$ROOT/services/desktop/node_modules/.bin/electron" ]; then
  echo 'Electron dependencies are missing. Run: make build' >&2
  exit 1
fi

if [ "$(uname -s 2>/dev/null || printf unknown)" = "Linux" ]; then
  WHARNESS_ROOT="$ROOT" "$ROOT/scripts/electron-runtime.sh" check
  WHARNESS_LINUX_SANDBOX_MODE=$(WHARNESS_ROOT="$ROOT" "$ROOT/scripts/electron-runtime.sh" mode)
  WHARNESS_ELECTRON_BINARY=$(WHARNESS_ROOT="$ROOT" "$ROOT/scripts/electron-runtime.sh" path)
  export WHARNESS_LINUX_SANDBOX_MODE WHARNESS_ELECTRON_BINARY
  unset CHROME_DEVEL_SANDBOX 2>/dev/null || true
fi

# Backend/frontend/PostgreSQL/tunnel are persistent Compose services. Normal
# start updates only the application containers while preserving tunnel/DB.
WHARNESS_ROOT="$ROOT" "$ROOT/scripts/stack.sh" ensure

# stack.sh ensure just (re)wrote these; read back the ports actually applied
# for this checkout instead of assuming the 8888/5173 defaults, so two
# checkouts on different ports each wait on and report their own.
HTTP_PORT=$(sed -n 's/^WHARNESS_HTTP_PORT=//p' "$ROOT/.harness/state/stack.env" 2>/dev/null | head -n 1)
WEB_PORT=$(sed -n 's/^WHARNESS_WEB_PORT=//p' "$ROOT/.harness/state/stack.env" 2>/dev/null | head -n 1)
[ -n "$HTTP_PORT" ] || HTTP_PORT=8888
[ -n "$WEB_PORT" ] || WEB_PORT=5173

: > "$LOG_FILE"
(
  cd "$ROOT/services/desktop"
  session_launcher=''
  if command -v setsid >/dev/null 2>&1; then session_launcher=setsid; fi
  nohup $session_launcher env \
    WHARNESS_ROOT="$ROOT" \
    WHARNESS_RUNTIME_DIR="$RUN_DIR" \
    WHARNESS_SERVICES_MODE=stack \
    WHARNESS_API_URL="http://127.0.0.1:$HTTP_PORT" \
    WHARNESS_FRONTEND_URL="http://127.0.0.1:$WEB_PORT" \
    WHARNESS_DESKTOP_USER_DATA_DIR="${WHARNESS_DESKTOP_USER_DATA_DIR:-}" \
    WHARNESS_RUNNER_IMAGE="${WHARNESS_RUNNER_IMAGE:-kernl-runner:local}" \
    WHARNESS_OZONE_PLATFORM="${WHARNESS_OZONE_PLATFORM:-auto}" \
    WHARNESS_LINUX_SANDBOX_MODE="${WHARNESS_LINUX_SANDBOX_MODE:-}" \
    WHARNESS_ELECTRON_BINARY="${WHARNESS_ELECTRON_BINARY:-}" \
    WHARNESS_BEHAVIOR_PROBE="${WHARNESS_BEHAVIOR_PROBE:-}" \
    node dev.mjs >>"$LOG_FILE" 2>&1 </dev/null &
  echo $! > "$PID_FILE"
)

pid=$(cat "$PID_FILE")
i=0
while [ "$i" -lt 120 ]; do
  if ! alive "$pid"; then
    echo 'Wharnex Desktop failed to start. Last log lines:' >&2
    tail -n 60 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  electron_ok=0
  if [ -f "$RUN_DIR/electron.pid" ]; then
    ep=$(cat "$RUN_DIR/electron.pid" 2>/dev/null || true)
    alive "$ep" && electron_ok=1 || true
  fi
  if [ "$electron_ok" -eq 1 ] && \
     curl -fsS "http://127.0.0.1:$HTTP_PORT/api/health" >/dev/null 2>&1 && \
     curl -fsS "http://127.0.0.1:$WEB_PORT/" >/dev/null 2>&1; then
    printf 'Wharnex Desktop started.\n'
    printf '  coordinator: %s\n' "$pid"
    printf '  backend:     http://127.0.0.1:%s (Compose)\n' "$HTTP_PORT"
    printf '  frontend:    http://127.0.0.1:%s (Compose)\n' "$WEB_PORT"
    printf '  logs:        %s\n' "$LOG_FILE"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.25
done

echo 'Wharnex Desktop did not become fully ready. Last log lines:' >&2
tail -n 60 "$LOG_FILE" >&2 || true
exit 1
