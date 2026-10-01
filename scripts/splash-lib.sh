#!/usr/bin/env sh
# Shared splash-window helpers for the OS-shortcut launcher (launcher.sh) and
# a direct `make start` (start.sh), so both entrypoints show the same short
# splash before Desktop startup instead of only the installed shortcut doing
# it. Sourced, not executed. The caller must set ROOT and LOG_FILE first, and
# must arrange for wharness_splash_close to run on exit (directly, or via
# `trap wharness_splash_close EXIT ...`).

WHARNESS_SPLASH_PID=''
WHARNESS_SPLASH_STATUS_FILE=''
WHARNESS_SPLASH_READY_FILE=''

wharness_splash_update() {
  [ -n "$WHARNESS_SPLASH_STATUS_FILE" ] || return 0
  wharness_splash_tmp="$WHARNESS_SPLASH_STATUS_FILE.next"
  printf '%s\n' "$1" >"$wharness_splash_tmp"
  mv -f "$wharness_splash_tmp" "$WHARNESS_SPLASH_STATUS_FILE"
}

wharness_splash_close() {
  if [ -n "$WHARNESS_SPLASH_PID" ] && kill -0 "$WHARNESS_SPLASH_PID" 2>/dev/null; then
    kill "$WHARNESS_SPLASH_PID" 2>/dev/null || true
    wait "$WHARNESS_SPLASH_PID" 2>/dev/null || true
  fi
  rm -f "$WHARNESS_SPLASH_STATUS_FILE" "$WHARNESS_SPLASH_READY_FILE"
}

wharness_splash_show_failure() {
  message='O Wharnex não iniciou. Consulte os registos do launcher para mais detalhes.'
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title='Wharnex' --text="$message" >/dev/null 2>&1 || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send 'Wharnex' "$message" >/dev/null 2>&1 || true
  fi
}

# Opens the splash window and blocks until it is ready (or gives up after
# ~3s). Prints nothing; sets WHARNESS_SPLASH_PID/STATUS_FILE/READY_FILE.
# Returns non-zero if the splash never became ready. Requires ROOT and
# LOG_FILE already set by the caller.
wharness_splash_open() {
  WHARNESS_SPLASH_STATUS_FILE=$(mktemp "$ROOT/.harness/run/launcher-splash-status.XXXXXX")
  WHARNESS_SPLASH_READY_FILE="$WHARNESS_SPLASH_STATUS_FILE.ready"
  wharness_splash_update "${1:-A iniciar o Wharnex...}"
  wharness_splash_electron=${WHARNESS_ELECTRON_BINARY:-}
  if [ -z "$wharness_splash_electron" ] && [ "$(uname -s 2>/dev/null || printf unknown)" = Linux ]; then
    wharness_splash_electron=$(WHARNESS_ROOT="$ROOT" "$ROOT/scripts/electron-runtime.sh" path 2>/dev/null || true)
  fi
  [ -n "$wharness_splash_electron" ] || wharness_splash_electron="$ROOT/services/desktop/node_modules/.bin/electron"
  WHARNESS_SPLASH_STATUS_FILE="$WHARNESS_SPLASH_STATUS_FILE" \
  WHARNESS_SPLASH_READY_FILE="$WHARNESS_SPLASH_READY_FILE" \
  "$wharness_splash_electron" "$ROOT/services/desktop/splash/launcher-splash.mjs" >>"$LOG_FILE" 2>&1 &
  WHARNESS_SPLASH_PID=$!
  wharness_splash_ready=0
  wharness_splash_attempt=0
  while [ "$wharness_splash_attempt" -lt 30 ]; do
    [ -f "$WHARNESS_SPLASH_READY_FILE" ] && { wharness_splash_ready=1; break; }
    kill -0 "$WHARNESS_SPLASH_PID" 2>/dev/null || break
    wharness_splash_attempt=$((wharness_splash_attempt + 1))
    sleep 0.1
  done
  [ "$wharness_splash_ready" -eq 1 ]
}
