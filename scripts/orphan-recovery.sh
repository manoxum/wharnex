#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUN_DIR="$ROOT/.harness/run"

[ "$(uname -s 2>/dev/null || printf unknown)" = Linux ] || exit 0

environment_matches_root() {
  pid=$1
  [ -r "/proc/$pid/environ" ] || return 1
  tr '\0' '\n' 2>/dev/null <"/proc/$pid/environ" | grep -Fqx "WHARNESS_ROOT=$ROOT"
}

verified_process() {
  label=$1
  pid=$2
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  executable=$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  case "$label" in
    # A force rebuild may replace the running backend binary atomically. Linux
    # then reports the verified executable with a literal " (deleted)" suffix
    # until the old process exits; retain the environment/root proof rather
    # than leaving that Wharness process orphaned.
    backend)
      environment_matches_root "$pid" || return 1
      case "$executable" in
        "$ROOT/dist/bin/wharness-backend"|"$ROOT/dist/bin/wharness-backend (deleted)") true ;;
        *) return 1 ;;
      esac
      ;;
    frontend)
      environment_matches_root "$pid" && [ "$cwd" = "$ROOT/services/frontend" ] || return 1
      command_line=$(tr '\0' ' ' 2>/dev/null <"/proc/$pid/cmdline")
      case "$command_line" in
        *'npm run preview'*|*'/vite preview'*) true ;;
        *) return 1 ;;
      esac
      ;;
    electron) [ "$cwd" = "$ROOT/services/desktop" ] && tr '\0' ' ' 2>/dev/null <"/proc/$pid/cmdline" | grep -Fq 'electron' ;;
    *) return 1 ;;
  esac
}

listener_pid() {
  port=$1
  ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1
}

terminate_group() {
  label=$1
  pid=$2
  verified_process "$label" "$pid" || { echo "Refusing to stop unverified $label process $pid." >&2; exit 1; }
  pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
  [ -n "$pgid" ] || { echo "Cannot resolve process group for $label process $pid." >&2; exit 1; }
  printf 'Recovering orphaned Wharness %s process %s...\n' "$label" "$pid"
  kill -TERM "-$pgid" 2>/dev/null || true
  attempts=0
  while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 40 ]; do
    attempts=$((attempts + 1))
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    verified_process "$label" "$pid" || { echo "Process identity changed while recovering $label $pid." >&2; exit 1; }
    kill -KILL "-$pgid" 2>/dev/null || true
  fi
}

recover_pid_file() {
  label=$1
  file="$RUN_DIR/$label.pid"
  [ -f "$file" ] || return 0
  pid=$(sed -n '1p' "$file" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    terminate_group "$label" "$pid"
  fi
}

recover_port() {
  label=$1
  port=$2
  pid=$(listener_pid "$port")
  [ -n "$pid" ] || return 0
  terminate_group "$label" "$pid"
}

recover_electron_groups() {
  for directory in /proc/[0-9]*; do
    pid=${directory##*/}
    verified_process electron "$pid" || continue
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ "$pid" = "$pgid" ] || continue
    terminate_group electron "$pid"
  done
}

mkdir -p "$RUN_DIR"
if [ "${WHARNESS_SERVICES_MODE:-local}" != stack ]; then
  recover_pid_file backend
  recover_pid_file frontend
  recover_port backend 8888
  recover_port frontend 5173
fi
recover_pid_file electron
recover_electron_groups
