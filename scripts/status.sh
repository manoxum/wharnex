#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"

pid_status() {
  label=$1
  file=$2
  if [ ! -f "$file" ]; then
    printf '  %-12s %s\n' "$label" 'not tracked'
    return
  fi
  pid=$(cat "$file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf '  %-12s running (pid %s)\n' "$label" "$pid"
  else
    printf '  %-12s stale/stopped\n' "$label"
  fi
}

printf 'Wharnex status\n'
pid_status coordinator "$RUN_DIR/coordinator.pid"
pid_status electron "$RUN_DIR/electron.pid"
pid_status host-pty "$RUN_DIR/hostpty.pid"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  printf 'Compose stack\n'
  WHARNESS_ROOT="$ROOT" "$ROOT/scripts/stack.sh" status || true
else
  echo 'Compose stack: Docker unavailable'
fi

GATEWAY_PORT=$(sed -n 's/^WHARNESS_GATEWAY_PORT=//p' "$ROOT/.harness/state/stack.env" 2>/dev/null | head -n 1)
[ -n "$GATEWAY_PORT" ] || GATEWAY_PORT=6969

if curl -fsS "http://127.0.0.1:$GATEWAY_PORT/api/health" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$GATEWAY_PORT/" >/dev/null 2>&1; then
  printf '  gateway HTTP  healthy (127.0.0.1:%s)\n' "$GATEWAY_PORT"
else
  printf '  gateway HTTP  unavailable (127.0.0.1:%s)\n' "$GATEWAY_PORT"
fi

STATUS_FILE="$ROOT/.harness/self-evolution/status"
if [ -f "$STATUS_FILE" ]; then
  phase=$(sed -n 's/^phase=//p' "$STATUS_FILE" | head -n 1)
  plan=$(sed -n 's/^plan_id=//p' "$STATUS_FILE" | head -n 1)
  updated=$(sed -n 's/^updated_at=//p' "$STATUS_FILE" | head -n 1)
  printf '  %-12s %s' 'self-evolve' "${phase:-unknown}"
  [ -z "$plan" ] || printf ' (plan %s)' "$plan"
  [ -z "$updated" ] || printf ' @ %s' "$updated"
  printf '\n'
fi
