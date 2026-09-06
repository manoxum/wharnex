#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM
DESKTOP_LOG="$TEMP_DIR/desktop.log"
SELF_LOG="$TEMP_DIR/self.log"

printf '%s\n' 'Electron ready' '[chatgpt-load] initial-show' '[chatgpt-http] status=503' >"$DESKTOP_LOG"
printf '%s\n' 'self evolution ready' >"$SELF_LOG"

run_logs() {
  WHARNESS_ROOT="$ROOT" \
    WHARNESS_DESKTOP_LOG="$DESKTOP_LOG" \
    WHARNESS_SELF_LOG="$SELF_LOG" \
    WHARNESS_STACK_SCRIPT=/bin/echo \
    "$ROOT/scripts/logs.sh" "$@"
}

all=$(run_logs --source all --tail 20)
printf '%s\n' "$all" | grep -Fq '[frontend] logs --no-color --tail 20 frontend'
printf '%s\n' "$all" | grep -Fq '[electron] Electron ready'
printf '%s\n' "$all" | grep -Fq '[chatgpt] [chatgpt-load] initial-show'
printf '%s\n' "$all" | grep -Fq '[self] self evolution ready'

chatgpt=$(run_logs -s chatgpt -g STATUS -n 20)
[ "$chatgpt" = '[chatgpt] [chatgpt-http] status=503' ] || {
  echo 'lifecycle regression: ChatGPT source/filter did not isolate the expected line' >&2
  exit 1
}

electron=$(run_logs --source electron --tail 20)
printf '%s\n' "$electron" | grep -Fq '[electron] Electron ready'
if printf '%s\n' "$electron" | grep -Fq '[chatgpt-'; then
  echo 'lifecycle regression: Electron-only logs duplicated ChatGPT transport lines' >&2
  exit 1
fi

printf 'Categorized log behavior checks passed.\n'
