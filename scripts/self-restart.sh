#!/usr/bin/env sh
set -eu

ROOT=${1:?Wharnex root is required}
TXN=${2:?transaction directory is required}
SESSION_ID=${3:-unknown}
PLAN_ID=${4:-unknown}
IMPACTS=${5:-backend,frontend,desktop}
BASE="$ROOT/.harness/self-evolution"
STATUS="$BASE/status"
LOG="$ROOT/.harness/logs/self-evolution.log"
LOCK="$BASE/active.lock"
STAGE_LOCK="$BASE/stage.lock"
KNOWN_STOP="$TXN/stop-known-good.sh"
KNOWN_START="$TXN/start-known-good.sh"
ROLLBACK="$TXN/rollback.sh"
KNOWN_STACK="$TXN/stack-known-good.sh"

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

release_stage_lock() {
  rm -f "$STAGE_LOCK"
}

cleanup_lock() {
  release_stage_lock
  rm -f "$LOCK"
}

runtime_healthy() {
  curl -fsS http://127.0.0.1:8888/api/health >/dev/null 2>&1 || return 1
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
    release_stage_lock
    return 1
  fi
  status rollback_restored "previous source/artifacts restored; restarting known-good runtime"
  if WHARNESS_ROOT="$ROOT" "$KNOWN_START" >>"$LOG" 2>&1 && runtime_healthy; then
    status rolled_back_runtime "previous Wharnex runtime restored"
    cleanup_lock
    return 0
  fi
  status rollback_deps "known-good runtime did not start; reconciling dependencies once"
  WHARNESS_ROOT="$ROOT" "$KNOWN_STOP" >>"$LOG" 2>&1 || true
  (cd "$ROOT" && make deps) >>"$LOG" 2>&1 || true
  WHARNESS_ROOT="$ROOT" "$KNOWN_STOP" >>"$LOG" 2>&1 || true
  if WHARNESS_ROOT="$ROOT" "$KNOWN_START" >>"$LOG" 2>&1 && runtime_healthy; then
    status rolled_back_runtime "previous Wharnex runtime restored after dependency reconciliation"
    cleanup_lock
    return 0
  fi
  status rollback_failed "previous runtime could not be restarted; inspect self-evolution.log"
  release_stage_lock
  return 1
}

stack_runtime_healthy() {
  curl -fsS http://127.0.0.1:8888/api/health >/dev/null 2>&1 || return 1
  curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1
}

recover_stack_runtime() {
  status rollback_runtime "new application containers failed health/start checks"
  if ! "$ROLLBACK" "$ROOT" "$TXN" >>"$LOG" 2>&1; then
    status rollback_failed "source/artifact rollback failed; persistent tunnel/database preserved"
    release_stage_lock
    return 1
  fi
  status rollback_restored "previous source/artifacts restored; rebuilding previous application images"
  if (cd "$ROOT" && make build-stage) >>"$LOG" 2>&1 && \
     WHARNESS_ROOT="$ROOT" "$KNOWN_STACK" activate-app >>"$LOG" 2>&1 && \
     stack_runtime_healthy; then
    status rolled_back_runtime "previous application containers restored; persistent tunnel/database were never restarted"
    cleanup_lock
    return 0
  fi
  status rollback_failed "previous application containers could not be restored; inspect self-evolution.log"
  release_stage_lock
  return 1
}

if [ "${WHARNESS_SERVICES_MODE:-}" = stack ]; then
  # This worker runs in a detached Docker supervisor container, so replacing
  # backend/frontend cannot terminate it. Database and tunnel are explicitly
  # outside the rollout and keep their containers/public URLs unchanged.
  sleep 2
  stack_services=''
  old_ifs=$IFS
  IFS=,
  for impact in $IMPACTS; do
    case "$impact" in backend|frontend|tunnel) stack_services="$stack_services $impact";; desktop|'') ;; *) status restart_failed "invalid activation impact $impact"; release_stage_lock; exit 1;; esac
  done
  IFS=$old_ifs
  status restarting "host build passed; activating only affected components: ${IMPACTS:-none}"
  # shellcheck disable=SC2086 -- values are validated by the closed case above.
  if WHARNESS_ROOT="$ROOT" "$ROOT/scripts/stack.sh" activate-services $stack_services >>"$LOG" 2>&1 && stack_runtime_healthy; then
    status restarted "affected components are healthy: ${IMPACTS:-none}"
    cleanup_lock
    find "$BASE" -mindepth 1 -maxdepth 1 -type d -name 'txn-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
    exit 0
  fi
  recover_stack_runtime
  exit $?
fi

# Give the request that scheduled this worker enough time to return to the UI.
sleep 2
status restarting "host build passed; handing off to detached restart supervisor"

if ! WHARNESS_ROOT="$ROOT" "$KNOWN_STOP" >>"$LOG" 2>&1; then
  status restart_failed "could not stop current Wharnex coordinator; pending batch retained for retry or extension"
  release_stage_lock
  exit 1
fi

if WHARNESS_ROOT="$ROOT" "$ROOT/scripts/start.sh" >>"$LOG" 2>&1 && runtime_healthy; then
  status restarted "new Wharnex runtime is healthy"
  cleanup_lock
  find "$BASE" -mindepth 1 -maxdepth 1 -type d -name 'txn-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true
  exit 0
fi

recover_old_runtime
