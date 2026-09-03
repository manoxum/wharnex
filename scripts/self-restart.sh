#!/usr/bin/env sh
set -eu

ROOT=${1:?Wharness root is required}
TXN=${2:?transaction directory is required}
SESSION_ID=${3:-unknown}
PLAN_ID=${4:-unknown}
BASE="$ROOT/.harness/self-evolution"
STATUS="$BASE/status"
LOG="$ROOT/.harness/logs/self-evolution.log"
LOCK="$BASE/active.lock"
KNOWN_STOP="$TXN/stop-known-good.sh"
KNOWN_START="$TXN/start-known-good.sh"
ROLLBACK="$TXN/rollback.sh"

case "$TXN" in
  "$BASE"/txn-*) ;;
  *) echo "Invalid self-evolution transaction path: $TXN" >&2; exit 2 ;;
esac

mkdir -p "$BASE" "$(dirname "$LOG")"

status() {
  phase=$1
  detail=${2:-}
  tmp="$STATUS.tmp.$$"
  {
    printf 'phase=%s\n' "$phase"
    printf 'session_id=%s\n' "$SESSION_ID"
    printf 'plan_id=%s\n' "$PLAN_ID"
    printf 'transaction=%s\n' "$(basename "$TXN")"
    printf 'updated_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    [ -z "$detail" ] || printf 'detail=%s\n' "$detail"
  } > "$tmp"
  mv -f "$tmp" "$STATUS"
  printf '[%s] self-evolution %s plan=%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$phase" "$PLAN_ID" "$detail" >> "$LOG"
}

cleanup_lock() {
  rm -f "$LOCK"
}

runtime_healthy() {
  curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 || return 1
  curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1 || return 1
  [ -f "$ROOT/.harness/run/electron.pid" ] || return 1
  ep=$(cat "$ROOT/.harness/run/electron.pid" 2>/dev/null || true)
  [ -n "$ep" ] && kill -0 "$ep" 2>/dev/null
}

recover_old_runtime() {
  status rollback_runtime "new runtime failed health/start checks"
  WHARNESS_ROOT="$ROOT" "$KNOWN_STOP" >/dev/null 2>&1 || true
  if ! "$ROLLBACK" "$ROOT" "$TXN" >>"$LOG" 2>&1; then
    status rollback_failed "source/artifact rollback failed; manual recovery required"
    cleanup_lock
    return 1
  fi
  status rollback_restored "previous source/artifacts restored; restarting known-good runtime"
  if WHARNESS_ROOT="$ROOT" "$KNOWN_START" >>"$LOG" 2>&1 && runtime_healthy; then
    status rolled_back_runtime "previous Wharness runtime restored"
    cleanup_lock
    rm -rf "$TXN"
    return 0
  fi
  status rollback_deps "known-good runtime did not start; reconciling dependencies once"
  WHARNESS_ROOT="$ROOT" "$KNOWN_STOP" >>"$LOG" 2>&1 || true
  (cd "$ROOT" && make deps) >>"$LOG" 2>&1 || true
  WHARNESS_ROOT="$ROOT" "$KNOWN_STOP" >>"$LOG" 2>&1 || true
  if WHARNESS_ROOT="$ROOT" "$KNOWN_START" >>"$LOG" 2>&1 && runtime_healthy; then
    status rolled_back_runtime "previous Wharness runtime restored after dependency reconciliation"
    cleanup_lock
    rm -rf "$TXN"
    return 0
  fi
  status rollback_failed "previous runtime could not be restarted; inspect self-evolution.log"
  cleanup_lock
  return 1
}

# Give the request that scheduled this worker enough time to return to the UI.
sleep 2
status restarting "host build passed; handing off to detached restart supervisor"

if ! WHARNESS_ROOT="$ROOT" "$KNOWN_STOP" >>"$LOG" 2>&1; then
  status restart_failed "could not stop current Wharness coordinator"
  cleanup_lock
  exit 1
fi

if WHARNESS_ROOT="$ROOT" "$ROOT/scripts/start.sh" >>"$LOG" 2>&1 && runtime_healthy; then
  status restarted "new Wharness runtime is healthy"
  cleanup_lock
  rm -rf "$TXN"
  find "$BASE" -mindepth 1 -maxdepth 1 -type d -name 'txn-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
  exit 0
fi

recover_old_runtime
