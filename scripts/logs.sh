#!/usr/bin/env sh
set -eu
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
DESKTOP_LOG="$ROOT/.harness/logs/desktop.log"
SELF_LOG="$ROOT/.harness/logs/self-evolution.log"

if [ ! -f "$DESKTOP_LOG" ] && [ ! -f "$SELF_LOG" ]; then
  echo 'No Wharness log file yet. Start with: make start' >&2
  exit 1
fi

if [ -f "$DESKTOP_LOG" ] && [ -f "$SELF_LOG" ]; then
  exec tail -n 120 -F "$DESKTOP_LOG" "$SELF_LOG"
fi
if [ -f "$SELF_LOG" ]; then
  exec tail -n 120 -F "$SELF_LOG"
fi
exec tail -n 120 -F "$DESKTOP_LOG"
