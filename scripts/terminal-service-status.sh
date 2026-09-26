#!/usr/bin/env sh
# Status reporting for the native Host PTY service. Sourced by terminal-service.sh.

wharnex_terminal_service_status() {
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
