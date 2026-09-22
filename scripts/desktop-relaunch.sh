#!/usr/bin/env sh
set -eu

ROOT=${1:?Wharnex root is required}
OLD_COORDINATOR_PID=${2:?previous Desktop coordinator pid is required}
RUN_DIR="$ROOT/.harness/run"
PID_FILE="$RUN_DIR/coordinator.pid"

case "$OLD_COORDINATOR_PID" in
  *[!0-9]*|'') echo "Invalid previous Desktop coordinator pid: $OLD_COORDINATOR_PID" >&2; exit 2 ;;
esac

# app.exit() makes dev.mjs observe Electron's exit and stop the old coordinator.
# Relaunching before that shutdown completes only triggers start.sh's existing
# second-instance handoff and leaves no process around to reopen the Desktop.
attempt=0
while kill -0 "$OLD_COORDINATOR_PID" 2>/dev/null; do
  if [ "$attempt" -ge 300 ]; then
    echo "Timed out waiting for previous Desktop coordinator $OLD_COORDINATOR_PID to exit." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

# The old coordinator normally removes this file itself. Clear only its exact
# stale pid if shutdown was abrupt; never erase a pid written by a newer owner.
if [ -f "$PID_FILE" ] && [ "$(cat "$PID_FILE" 2>/dev/null || true)" = "$OLD_COORDINATOR_PID" ]; then
  rm -f "$PID_FILE"
fi

exec env WHARNESS_ROOT="$ROOT" "$ROOT/scripts/start.sh"
