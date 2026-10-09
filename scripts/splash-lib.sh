#!/usr/bin/env sh
# Shared splash-window helpers for the OS-shortcut launcher (launcher.sh) and
# a direct `make start` (start.sh), so both entrypoints show the same short
# splash before Desktop startup instead of only the installed shortcut doing
# it. Sourced, not executed. The caller must set ROOT and LOG_FILE first, and
# must arrange for wharnex_splash_close to run on exit (directly, or via
# `trap wharnex_splash_close EXIT ...`).

WHARNEX_SPLASH_PID=${WHARNEX_SPLASH_PID:-}
WHARNESS_SPLASH_STATUS_FILE=${WHARNESS_SPLASH_STATUS_FILE:-}
WHARNESS_SPLASH_READY_FILE=${WHARNESS_SPLASH_READY_FILE:-}

wharnex_splash_run() {
  if [ -n "${WHARNEX_SPLASH_OUTPUT_FILE:-}" ] && [ "${WHARNEX_SPLASH_CAPTURE_ACTIVE:-0}" != 1 ] &&
     command -v node >/dev/null 2>&1 && [ -f "$ROOT/services/desktop/splash/output/run.mjs" ] &&
     node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then
    node "$ROOT/services/desktop/splash/output/run.mjs" "$@"
  else
    "$@"
  fi
}

wharnex_splash_update() {
  [ -n "$WHARNESS_SPLASH_STATUS_FILE" ] || return 0
  wharnex_splash_tmp="$WHARNESS_SPLASH_STATUS_FILE.next"
  printf '%s\n' "$1" >"$wharnex_splash_tmp"
  mv -f "$wharnex_splash_tmp" "$WHARNESS_SPLASH_STATUS_FILE"
}

wharnex_splash_close() {
  # The failed splash owns its temporary files until the user closes the window.
  if [ -n "$WHARNESS_SPLASH_STATUS_FILE" ] && [ -f "$WHARNESS_SPLASH_STATUS_FILE.failed" ] && kill -0 "$WHARNEX_SPLASH_PID" 2>/dev/null; then return 0; fi
  if [ -n "$WHARNEX_SPLASH_PID" ] && kill -0 "$WHARNEX_SPLASH_PID" 2>/dev/null; then
    kill "$WHARNEX_SPLASH_PID" 2>/dev/null || true
    wait "$WHARNEX_SPLASH_PID" 2>/dev/null || true
  fi
  rm -f "$WHARNESS_SPLASH_STATUS_FILE" "$WHARNESS_SPLASH_STATUS_FILE.next" "$WHARNESS_SPLASH_READY_FILE" "${WHARNEX_SPLASH_OUTPUT_FILE:-}" \
    "${WHARNESS_SPLASH_STATUS_FILE}.failed" "${WHARNEX_SPLASH_OUTPUT_FILE:-}.next"
}

wharnex_splash_show_failure() {
  if [ -n "$WHARNESS_SPLASH_STATUS_FILE" ] && kill -0 "$WHARNEX_SPLASH_PID" 2>/dev/null; then
    wharnex_splash_update 'O Wharnex não iniciou. Consulta a saída abaixo para identificar a falha.'
    : > "$WHARNESS_SPLASH_STATUS_FILE.failed"
    return 0
  fi
  message='O Wharnex não iniciou. Consulte os registos do launcher para mais detalhes.'
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title='Wharnex' --text="$message" >/dev/null 2>&1 || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send 'Wharnex' "$message" >/dev/null 2>&1 || true
  fi
}

# Opens the splash window and blocks until it is ready (or gives up after
# ~3s). The package entrypoint is launcher-splash.mjs; its Linux WM_CLASS
# matches the installed launcher rather than the generic Electron executable.
# Prints nothing; sets WHARNEX_SPLASH_PID/STATUS_FILE/READY_FILE.
# Returns non-zero if the splash never became ready. Requires ROOT and
# LOG_FILE already set by the caller.
wharnex_splash_open() {
  WHARNESS_SPLASH_STATUS_FILE=$(mktemp "$ROOT/.harness/run/launcher-splash-status.XXXXXX")
  WHARNESS_SPLASH_READY_FILE="$WHARNESS_SPLASH_STATUS_FILE.ready"
  WHARNEX_SPLASH_OUTPUT_FILE="$WHARNESS_SPLASH_STATUS_FILE.output"
  WHARNEX_SPLASH_DESKTOP_LOG_FILE="$ROOT/.harness/logs/desktop.log"
  export WHARNESS_SPLASH_STATUS_FILE WHARNEX_SPLASH_OUTPUT_FILE WHARNEX_SPLASH_DESKTOP_LOG_FILE
  : > "$WHARNEX_SPLASH_OUTPUT_FILE"
  chmod 600 "$WHARNEX_SPLASH_OUTPUT_FILE"
  wharnex_splash_update "${1:-A iniciar o Wharnex...}"
  wharnex_splash_electron=${WHARNESS_ELECTRON_BINARY:-}
  if [ -z "$wharnex_splash_electron" ] && [ "$(uname -s 2>/dev/null || printf unknown)" = Linux ]; then
    wharnex_splash_electron=$(WHARNESS_ROOT="$ROOT" "$ROOT/scripts/electron-runtime.sh" path 2>/dev/null || true)
  fi
  [ -n "$wharnex_splash_electron" ] || wharnex_splash_electron="$ROOT/services/desktop/node_modules/.bin/electron"
  WHARNESS_SPLASH_STATUS_FILE="$WHARNESS_SPLASH_STATUS_FILE" \
  WHARNESS_SPLASH_READY_FILE="$WHARNESS_SPLASH_READY_FILE" \
  "$wharnex_splash_electron" "$ROOT/services/desktop/splash" >>"$LOG_FILE" 2>&1 &
  WHARNEX_SPLASH_PID=$!
  wharnex_splash_ready=0
  wharnex_splash_attempt=0
  while [ "$wharnex_splash_attempt" -lt 30 ]; do
    [ -f "$WHARNESS_SPLASH_READY_FILE" ] && { wharnex_splash_ready=1; break; }
    kill -0 "$WHARNEX_SPLASH_PID" 2>/dev/null || break
    wharnex_splash_attempt=$((wharnex_splash_attempt + 1))
    sleep 0.1
  done
  [ "$wharnex_splash_ready" -eq 1 ]
}
