#!/usr/bin/env sh
set -eu
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
LOG_FILE="$ROOT/.harness/logs/desktop.log"
if [ ! -f "$LOG_FILE" ]; then
  echo 'No Wharness log file yet. Start with: make start' >&2
  exit 1
fi
exec tail -n 120 -f "$LOG_FILE"
