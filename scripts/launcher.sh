#!/usr/bin/env sh
set -eu

# OS shortcut entrypoint.  It owns the short-lived splash so source validation
# and an optional rebuild never expose a stale Desktop window to the user.
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
LOG_DIR="$ROOT/.harness/logs"
LOG_FILE="$LOG_DIR/launcher.log"
SPLASH_PID=''
SPLASH_STATUS_FILE=''
SPLASH_READY_FILE=''

mkdir -p "$LOG_DIR" "$ROOT/.harness/run"

# IDE-integrated terminals and automation hosts may export this Electron-only
# compatibility switch. If it reaches the native launcher, the splash binary
# executes launcher-splash.mjs as plain Node and the OS shortcut appears to be
# a different/broken instance even though `make start` later sanitizes its own
# Electron child. Both entrypoints must cross the same native runtime boundary.
unset ELECTRON_RUN_AS_NODE 2>/dev/null || true

close_splash() {
  if [ -n "$SPLASH_PID" ] && kill -0 "$SPLASH_PID" 2>/dev/null; then
    kill "$SPLASH_PID" 2>/dev/null || true
    wait "$SPLASH_PID" 2>/dev/null || true
  fi
  rm -f "$SPLASH_STATUS_FILE" "$SPLASH_READY_FILE"
}

update_splash() {
  [ -n "$SPLASH_STATUS_FILE" ] || return 0
  temporary="$SPLASH_STATUS_FILE.next"
  printf '%s\n' "$1" >"$temporary"
  mv -f "$temporary" "$SPLASH_STATUS_FILE"
}

show_failure() {
  message='O Wharnex não iniciou. Consulte os registos do launcher para mais detalhes.'
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title='Wharnex' --text="$message" >/dev/null 2>&1 || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send 'Wharnex' "$message" >/dev/null 2>&1 || true
  fi
}

trap 'close_splash' EXIT HUP INT TERM

# The splash is its own minimal Electron process. It writes the ready marker
# only after its frameless window can be shown, which is the lifecycle barrier
# before any stop/build/start work may begin.
SPLASH_STATUS_FILE=$(mktemp "$ROOT/.harness/run/launcher-splash-status.XXXXXX")
SPLASH_READY_FILE="$SPLASH_STATUS_FILE.ready"
update_splash 'A verificar o código do projeto…'
SPLASH_ELECTRON=${WHARNESS_ELECTRON_BINARY:-}
if [ -z "$SPLASH_ELECTRON" ] && [ "$(uname -s 2>/dev/null || printf unknown)" = Linux ]; then
  SPLASH_ELECTRON=$(WHARNESS_ROOT="$ROOT" "$ROOT/scripts/electron-runtime.sh" path 2>/dev/null || true)
fi
[ -n "$SPLASH_ELECTRON" ] || SPLASH_ELECTRON="$ROOT/services/desktop/node_modules/.bin/electron"
WHARNESS_SPLASH_STATUS_FILE="$SPLASH_STATUS_FILE" \
WHARNESS_SPLASH_READY_FILE="$SPLASH_READY_FILE" \
"$SPLASH_ELECTRON" "$ROOT/services/desktop/launcher-splash.mjs" >>"$LOG_FILE" 2>&1 &
SPLASH_PID=$!
ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  [ -f "$SPLASH_READY_FILE" ] && { ready=1; break; }
  kill -0 "$SPLASH_PID" 2>/dev/null || break
  attempt=$((attempt + 1))
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  show_failure
  echo 'Wharnex launcher splash did not become ready.' >&2
  exit 1
fi

if WHARNESS_ROOT="$ROOT" "$ROOT/scripts/source-fingerprint.sh" matches; then
  action='start'
else
  action='restart after source change'
fi

if [ "$action" = 'restart after source change' ]; then
  update_splash 'Código alterado. A parar a versão anterior…'
  printf '%s source fingerprint changed; rebuilding and restarting.\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" >>"$LOG_FILE"
  update_splash 'A compilar a nova versão. Isto pode demorar alguns minutos…'
  (cd "$ROOT" && export WHARNESS_LAUNCHER_AUTOSTART_DOCKER=1 && make stop && make build && make start) >>"$LOG_FILE" 2>&1 || {
    show_failure
    exit 1
  }
else
  update_splash 'A iniciar o Desktop…'
  (cd "$ROOT" && export WHARNESS_LAUNCHER_AUTOSTART_DOCKER=1 && make start) >>"$LOG_FILE" 2>&1 || {
    show_failure
    exit 1
  }
fi
