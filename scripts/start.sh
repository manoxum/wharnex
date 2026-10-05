#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"
LOG_DIR="$ROOT/.harness/logs"
PID_FILE="$RUN_DIR/coordinator.pid"
LOG_FILE="$LOG_DIR/desktop.log"
BUILD_STAMP="$ROOT/.harness/build-success"
SOURCE_FINGERPRINT="$ROOT/scripts/source-fingerprint.sh"
# Optional per-checkout overrides (Electron profile dir, etc). Gitignored.
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"
# IDE terminals export Electron-as-Node mode; the splash and the Desktop must
# never inherit it, exactly as in launcher.sh (AGENTS.md §9).
unset ELECTRON_RUN_AS_NODE 2>/dev/null || true
# Host ports UI Lab may reach from inside the up-whx-link (adr/ADR-0089).
if [ -n "${WHARNEX_UP_LINK_HOST_PORTS:-}" ]; then export WHARNEX_UP_LINK_HOST_PORTS; fi
# A `make start` run directly from a terminal, outside the installed
# launcher, previously left WHARNESS_DESKTOP_USER_DATA_DIR unset. Electron
# then fell back to its own default profile directory instead of the
# launcher's, so a plain `make start` opened what was effectively a
# different, unauthenticated instance (separate Chromium profile, separate
# ChatGPT login) from the one the desktop shortcut already uses. Resolve the
# same canonical profile install-dev.sh installs the launcher with, unless
# the caller already set one explicitly.
. "$SCRIPT_DIR/desktop-profile.sh"

mkdir -p "$RUN_DIR" "$LOG_DIR"

alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if alive "$pid"; then
    # A launcher invocation while the coordinator is alive must bring the
    # Desktop back to the foreground. On Linux, signal the already-isolated
    # Electron instead of launching another Chromium process on the host.
    if [ "$(uname -s 2>/dev/null || printf unknown)" = "Linux" ]; then
      focus_pid=$(cat "$RUN_DIR/electron-main.pid" 2>/dev/null || true)
      wrapper_pid=$(cat "$RUN_DIR/electron.pid" 2>/dev/null || true)
      focus_parent=$(awk '/^PPid:/ { print $2 }' "/proc/$focus_pid/status" 2>/dev/null || true)
      if ! alive "$focus_pid" || [ "$focus_parent" != "$wrapper_pid" ] || ! kill -USR1 "$focus_pid" 2>/dev/null; then
        echo 'Wharnex coordinator is running without a reachable Desktop; use make restart.' >&2
        exit 1
      fi
    else
      focus_electron="$ROOT/services/desktop/node_modules/.bin/electron"
      nohup env WHARNESS_DESKTOP_USER_DATA_DIR="${WHARNESS_DESKTOP_USER_DATA_DIR:-}" "$focus_electron" "$ROOT/services/desktop/main.mjs" \
        >>"$LOG_FILE" 2>&1 </dev/null &
    fi
    printf 'Wharnex Desktop is already running (pid %s).\n' "$pid"
    printf 'Requested foreground handoff to the running Desktop.\n'
    printf 'Use: make status | make logs | make stop\n'
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# `make start` run directly from a terminal is otherwise indistinguishable
# from the installed OS launcher except for the splash it shows first. When
# WHARNESS_LAUNCHER_SPLASH_ACTIVE is set, the launcher already owns one
# around this call (see launcher.sh), so a second splash here would just be a
# redundant window flashing on top of it.
own_splash=0
if [ "${WHARNESS_LAUNCHER_SPLASH_ACTIVE:-}" != 1 ]; then
  . "$SCRIPT_DIR/splash-lib.sh"
  trap 'wharness_splash_close' EXIT HUP INT TERM
  if wharness_splash_open 'A verificar o código do projeto…'; then
    own_splash=1
  else
    wharness_splash_close
  fi
fi

WHARNESS_ROOT="$ROOT" WHARNESS_SERVICES_MODE=stack "$ROOT/scripts/orphan-recovery.sh"

build_required=''
if [ "${WHARNEX_BOOT_PREVIOUS:-0}" = 1 ]; then
  if [ ! -f "$BUILD_STAMP" ] && [ ! -f "$ROOT/.harness/build-previous-success" ]; then
    echo 'No previous successful Wharnex build is available for recovery startup.' >&2
    exit 1
  fi
  echo 'Wharnex update is pending; starting the last available build.'
elif [ ! -f "$BUILD_STAMP" ]; then
  build_required='no successful build is recorded'
elif ! WHARNESS_ROOT="$ROOT" "$SOURCE_FINGERPRINT" matches; then
  build_required='source fingerprint changed'
fi

if [ -n "$build_required" ]; then
  printf 'Wharnex build is required (%s); rebuilding before startup...\n' "$build_required"
  [ "$own_splash" -eq 1 ] && wharness_splash_update 'A compilar a nova versão. Isto pode demorar alguns minutos…' || true
  (cd "$ROOT" && make build)
fi

[ "$own_splash" -eq 1 ] && wharness_splash_update 'A iniciar o Desktop…' || true

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

# Gateway/backend/frontend/webapp/PostgreSQL/tunnel/terminal are persistent Compose services.
# The Desktop reaches backend and frontend exclusively through the gateway.
WHARNESS_ROOT="$ROOT" "$ROOT/scripts/stack.sh" ensure

# stack.sh ensure just (re)wrote the only published application port.
GATEWAY_PORT=$(sed -n 's/^WHARNESS_GATEWAY_PORT=//p' "$ROOT/.harness/state/stack.env" 2>/dev/null | head -n 1)
[ -n "$GATEWAY_PORT" ] || GATEWAY_PORT=6969

: > "$LOG_FILE"
(
  cd "$ROOT/services/desktop"
  session_launcher=''
  if command -v setsid >/dev/null 2>&1; then session_launcher=setsid; fi
  nohup $session_launcher env \
    WHARNESS_ROOT="$ROOT" \
    WHARNESS_RUNTIME_DIR="$RUN_DIR" \
    WHARNESS_SERVICES_MODE=stack \
    WHARNESS_API_URL="http://127.0.0.1:$GATEWAY_PORT" \
    WHARNESS_FRONTEND_URL="http://127.0.0.1:$GATEWAY_PORT" \
    WHARNESS_DESKTOP_USER_DATA_DIR="${WHARNESS_DESKTOP_USER_DATA_DIR:-}" \
    WHARNESS_INSTANCE_ID="${WHARNESS_INSTANCE_ID:-}" \
    WHARNESS_RUNNER_IMAGE="${WHARNESS_RUNNER_IMAGE:-kernl-runner:local}" \
    WHARNESS_OZONE_PLATFORM="${WHARNESS_OZONE_PLATFORM:-auto}" \
    WHARNESS_LINUX_SANDBOX_MODE="${WHARNESS_LINUX_SANDBOX_MODE:-}" \
    WHARNESS_ELECTRON_BINARY="${WHARNESS_ELECTRON_BINARY:-}" \
    WHARNESS_BEHAVIOR_PROBE="${WHARNESS_BEHAVIOR_PROBE:-}" \
    node lifecycle/dev.mjs >>"$LOG_FILE" 2>&1 </dev/null &
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
     curl -fsS "http://127.0.0.1:$GATEWAY_PORT/api/health" >/dev/null 2>&1 && \
     curl -fsS "http://127.0.0.1:$GATEWAY_PORT/" >/dev/null 2>&1; then
    printf 'Wharnex Desktop started.\n'
    printf '  coordinator: %s\n' "$pid"
    printf '  gateway:     http://127.0.0.1:%s (Compose)\n' "$GATEWAY_PORT"
    printf '  logs:        %s\n' "$LOG_FILE"
    exit 0
  fi
  i=$((i + 1))
  sleep 0.25
done

echo 'Wharnex Desktop did not become fully ready. Last log lines:' >&2
tail -n 60 "$LOG_FILE" >&2 || true
exit 1
