#!/usr/bin/env sh
set -eu

# OS shortcut entrypoint. It keeps the splash visible through source validation,
# an optional update, and recovery of the last built Desktop when needed.
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
LOG_DIR="$ROOT/.harness/logs"
LOG_FILE="$LOG_DIR/launcher.log"
# Shared with start.sh, so `make start` run directly from a terminal shows
# the same short splash as this OS shortcut instead of only this entrypoint
# doing it.
. "$ROOT/scripts/splash-lib.sh"

mkdir -p "$LOG_DIR" "$ROOT/.harness/run"

# IDE-integrated terminals and automation hosts may export this Electron-only
# compatibility switch. If it reaches the native launcher, the splash binary
# executes launcher-splash.mjs as plain Node and the OS shortcut appears to be
# a different/broken instance even though `make start` later sanitizes its own
# Electron child. Both entrypoints must cross the same native runtime boundary.
unset ELECTRON_RUN_AS_NODE 2>/dev/null || true

trap 'wharnex_splash_close' EXIT HUP INT TERM

start_last_build() {
  if [ ! -f "$ROOT/.harness/build-previous-success" ] && [ ! -f "$ROOT/.harness/build-success" ]; then
    echo 'No previous successful Wharnex build is available for recovery startup.' >>"$LOG_FILE"
    return 1
  fi
  wharnex_splash_update 'Atualização adiada. A iniciar a última versão disponível…'
  (cd "$ROOT" && export WHARNESS_LAUNCHER_AUTOSTART_DOCKER=1 WHARNESS_LAUNCHER_SPLASH_ACTIVE=1 WHARNEX_BOOT_PREVIOUS=1 && wharnex_splash_run make start) >>"$LOG_FILE" 2>&1 || return 1
  command -v notify-send >/dev/null 2>&1 && notify-send 'Wharnex' 'A última versão disponível foi iniciada; a atualização permanece pendente. Consulte o registo do launcher.' >/dev/null 2>&1 || true
}

# The splash is its own minimal Electron process. It writes the ready marker
# only after its frameless window can be shown, which is the lifecycle barrier
# before any stop/build/start work may begin.
if ! wharnex_splash_open 'A verificar o código do projeto…'; then
  wharnex_splash_show_failure
  echo 'Wharnex launcher splash did not become ready.' >&2
  exit 1
fi

if WHARNESS_ROOT="$ROOT" "$ROOT/scripts/source-fingerprint.sh" matches; then
  action='start'
else
  action='restart after source change'
fi

# WHARNESS_LAUNCHER_SPLASH_ACTIVE tells start.sh a splash is already owned by
# this launcher, so it does not open a second, redundant one of its own.
if [ "$action" = 'restart after source change' ]; then
  printf '%s source fingerprint changed; staging update before stopping Desktop.\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" >>"$LOG_FILE"
  wharnex_splash_update 'A compilar a nova versão. Isto pode demorar alguns minutos…'
  if (cd "$ROOT" && export WHARNESS_LAUNCHER_AUTOSTART_DOCKER=1 WHARNESS_LAUNCHER_SPLASH_ACTIVE=1 && wharnex_splash_run make build) >>"$LOG_FILE" 2>&1; then
    wharnex_splash_update 'Nova versão pronta. A reiniciar o Desktop…'
    (cd "$ROOT" && export WHARNESS_LAUNCHER_AUTOSTART_DOCKER=1 WHARNESS_LAUNCHER_SPLASH_ACTIVE=1 && wharnex_splash_run make stop && wharnex_splash_run make start) >>"$LOG_FILE" 2>&1 || {
      wharnex_splash_show_failure
      exit 1
    }
  else
    printf '%s update build failed; trying the last successful build.\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" >>"$LOG_FILE"
    if ! start_last_build; then
      wharnex_splash_show_failure
      exit 1
    fi
  fi
else
  wharnex_splash_update 'A iniciar o Desktop…'
  (cd "$ROOT" && export WHARNESS_LAUNCHER_AUTOSTART_DOCKER=1 WHARNESS_LAUNCHER_SPLASH_ACTIVE=1 && wharnex_splash_run make start) >>"$LOG_FILE" 2>&1 || start_last_build || {
    wharnex_splash_show_failure
    exit 1
  }
fi
