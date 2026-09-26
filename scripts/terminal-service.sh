#!/usr/bin/env sh

terminal_service_paths() {
  TERMINAL_SOCKET="$ROOT/.harness/bridge/terminal.sock"
  TERMINAL_PID_FILE="$ROOT/.harness/state/terminald.pid"
  TERMINAL_LOG_FILE="$ROOT/.harness/logs/terminald.log"
  TERMINAL_BINARY="$ROOT/dist/bin/wharnex-host-pty"
}

terminal_service_in_container() {
  [ -f /.dockerenv ] || grep -qaE '/(docker|containerd|kubepods)/' /proc/1/cgroup 2>/dev/null
}

terminal_service_socket_ready() {
  terminal_service_paths
  [ -S "$TERMINAL_SOCKET" ] || return 1
  command -v node >/dev/null 2>&1 || return 0
  node - "$TERMINAL_SOCKET" <<'NODE'
const net = require('node:net')
const socketPath = process.argv[2]
const socket = net.createConnection(socketPath)
const fail = () => { socket.destroy(); process.exit(1) }
socket.setTimeout(500, fail)
socket.once('error', fail)
socket.once('connect', () => { socket.end(); process.exit(0) })
NODE
}

wait_terminal_service() {
  terminal_service_paths
  attempts=0
  while [ "$attempts" -lt 120 ]; do
    if terminal_service_in_container; then
      [ -S "$TERMINAL_SOCKET" ] && return 0
    elif terminal_service_socket_ready; then
      return 0
    elif [ "$attempts" -gt 5 ] && ! terminal_service_alive; then
      echo "Host terminal service exited before exposing $TERMINAL_SOCKET." >&2
      return 1
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  echo "Host terminal service did not become ready at $TERMINAL_SOCKET." >&2
  return 1
}

terminal_service_pid() {
  [ ! -f "$TERMINAL_PID_FILE" ] || sed -n '1p' "$TERMINAL_PID_FILE" 2>/dev/null || true
}

# Only a pid still running the terminal binary is ours; a recycled pid is not.
terminal_service_alive() {
  pid=$(terminal_service_pid)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null &&
    tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q "$TERMINAL_BINARY"
}

# Stops a live daemon that does not answer (after a grace period: retiring it
# ends its shells). Merely deleting its files let it outlive the restart and
# remove the new daemon's socket, which shares the path, on its way out.
retire_unresponsive_terminal_service() {
  if terminal_service_alive; then
    attempts=0
    while [ "$attempts" -lt 30 ]; do
      terminal_service_socket_ready && return 1 # recovered: keep it
      attempts=$((attempts + 1))
      sleep 0.1
    done
    printf 'Retiring unresponsive host terminal service (pid %s)...\n' "$(terminal_service_pid)"
    terminate_terminal_pid "$(terminal_service_pid)"
  fi
  rm -f "$TERMINAL_SOCKET" "$TERMINAL_PID_FILE"
}

terminate_terminal_pid() {
  kill -TERM "$1" 2>/dev/null || true
  attempts=0
  while kill -0 "$1" 2>/dev/null && [ "$attempts" -lt 40 ]; do
    attempts=$((attempts + 1))
    sleep 0.1
  done
  kill -0 "$1" 2>/dev/null && kill -KILL "$1" 2>/dev/null || true
}

migrate_legacy_terminal_sidecar() {
  terminal_service_in_container && return 0
  command -v docker >/dev/null 2>&1 || return 0
  ids=$(docker ps -aq \
    --filter "label=wharness.root=$ROOT" \
    --filter 'label=com.docker.compose.service=terminal' 2>/dev/null || true)
  [ -n "$ids" ] || return 0
  printf 'Migrating durable terminal ownership from Compose to the host service...\n'
  # IDs originate from docker ps and contain no whitespace except separators.
  # shellcheck disable=SC2086
  docker rm -f $ids >/dev/null
}

ensure_terminal_service() {
  terminal_service_paths
  mkdir -p "$(dirname "$TERMINAL_SOCKET")" "$(dirname "$TERMINAL_PID_FILE")" "$(dirname "$TERMINAL_LOG_FILE")"

  # Self-evolution reconciliation executes stack.sh from a container. It must
  # never start a supposedly host-native PTY daemon inside that container.
  # Preserve the already-running host/legacy socket until the detached Desktop
  # relaunch reaches this function from the real host.
  if terminal_service_in_container; then
    wait_terminal_service
    return
  fi

  migrate_legacy_terminal_sidecar
  if terminal_service_socket_ready; then
    return 0
  fi
  retire_unresponsive_terminal_service || return 0
  [ -x "$TERMINAL_BINARY" ] || {
    echo "Host terminal bridge binary is missing: $TERMINAL_BINARY" >&2
    return 1
  }
  for attempt in 1 2; do
    start_terminal_daemon
    wait_terminal_service && return 0
    retire_unresponsive_terminal_service || return 0
    [ "$attempt" = 1 ] && printf 'Retrying the host terminal service once...\n'
  done
  echo "Last host terminal service log lines ($TERMINAL_LOG_FILE):" >&2
  tail -n 20 "$TERMINAL_LOG_FILE" >&2 2>/dev/null || true
  return 1
}

start_terminal_daemon() {
  printf 'Starting durable native host terminal service...\n'
  # `setsid` forks internally instead of calling setsid(2) directly whenever
  # the caller is already a process-group leader, so "$!" on the `nohup
  # setsid ...` job can name a wrapper that exits immediately rather than the
  # daemon that keeps running. The daemon writes its own pid ($$, stable
  # across the following `exec`s) so the pid file always names the process
  # that is actually still alive. sh -c also starts a fresh shell that does
  # not inherit close_inherited_fds as a function, so that loop is inlined.
  daemon_command='
    printf "%s\n" "$$" >"$4"
    chmod 600 "$4"
    for fd in $(ls /proc/self/fd 2>/dev/null); do
      case "$fd" in
        0 | 1 | 2) ;;
        *) eval "exec $fd>&-" 2>/dev/null ;;
      esac
    done
    exec env \
      WHARNESS_ROOT="$1" \
      HARNESS_HOST_PTY_SOCKET="$2" \
      "$3" --socket "$2"
  '
  if command -v setsid >/dev/null 2>&1; then
    nohup setsid sh -c "$daemon_command" terminald \
      "$ROOT" "$TERMINAL_SOCKET" "$TERMINAL_BINARY" "$TERMINAL_PID_FILE" \
      >>"$TERMINAL_LOG_FILE" 2>&1 </dev/null &
  else
    nohup sh -c "$daemon_command" terminald \
      "$ROOT" "$TERMINAL_SOCKET" "$TERMINAL_BINARY" "$TERMINAL_PID_FILE" \
      >>"$TERMINAL_LOG_FILE" 2>&1 </dev/null &
  fi
}

stop_terminal_service() {
  terminal_service_paths
  terminal_service_in_container && return 0
  if command -v docker >/dev/null 2>&1; then
    ids=$(docker ps -aq \
      --filter "label=wharness.root=$ROOT" \
      --filter 'label=com.docker.compose.service=terminal' 2>/dev/null || true)
    if [ -n "$ids" ]; then
      # shellcheck disable=SC2086
      docker rm -f $ids >/dev/null
    fi
  fi
  pid=$(terminal_service_pid)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then terminate_terminal_pid "$pid"; fi
  rm -f "$TERMINAL_PID_FILE" "$TERMINAL_SOCKET"
}

terminal_service_status() {
  terminal_service_paths
  if terminal_service_in_container; then
    [ -S "$TERMINAL_SOCKET" ] && printf '  %-12s %s\n' 'terminald' 'socket available' || printf '  %-12s %s\n' 'terminald' 'socket unavailable'
    return
  fi
  if terminal_service_socket_ready; then
    pid=''
    [ ! -f "$TERMINAL_PID_FILE" ] || pid=$(sed -n '1p' "$TERMINAL_PID_FILE" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      printf '  %-12s running (pid %s, native host)\n' 'terminald' "$pid"
    else
      printf '  %-12s running (native host socket)\n' 'terminald'
    fi
  else
    printf '  %-12s %s\n' 'terminald' 'unavailable'
  fi
}
