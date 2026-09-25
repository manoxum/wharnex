#!/usr/bin/env sh
set -eu

ROOT_REAL=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
. "$ROOT_REAL/scripts/terminal-service.sh"

if terminal_service_in_container; then
  printf 'terminal service checks skipped: running inside a container.\n'
  exit 0
fi
command -v node >/dev/null 2>&1 || {
  printf 'terminal service checks skipped: node is not available.\n'
  exit 0
}

fixture=$(mktemp -d)
cleanup() {
  [ -z "${daemon_pid:-}" ] || kill -9 "$daemon_pid" 2>/dev/null || true
  rm -rf "$fixture"
}
trap cleanup EXIT HUP INT TERM

ROOT="$fixture/checkout"
mkdir -p "$ROOT/dist/bin"
cat >"$ROOT/dist/bin/wharnex-host-pty" <<'NODE'
#!/usr/bin/env node
const net = require('node:net')
const fs = require('node:fs')
const socketArgIndex = process.argv.indexOf('--socket')
const socketPath = process.argv[socketArgIndex + 1]
fs.rmSync(socketPath, { force: true })
net.createServer().listen(socketPath)
setInterval(() => {}, 1000)
NODE
chmod 0755 "$ROOT/dist/bin/wharnex-host-pty"

lock="$fixture/stack-operation.lock"
: >"$lock"
# Simulate scripts/stack.sh's acquire_stack_operation_lock: an exclusive
# flock held open on fd 9 for the whole lifetime of the calling script.
exec 9>"$lock"
command -v flock >/dev/null 2>&1 || {
  printf 'terminal service checks skipped: flock is not available.\n'
  exit 0
}
flock -n 9

terminal_service_paths
ensure_terminal_service >/dev/null

attempts=0
while [ ! -f "$TERMINAL_PID_FILE" ] && [ "$attempts" -lt 50 ]; do
  attempts=$((attempts + 1))
  sleep 0.1
done
[ -f "$TERMINAL_PID_FILE" ] || {
  echo 'terminal service regression: daemon never wrote its pid file' >&2
  exit 1
}
daemon_pid=$(sed -n '1p' "$TERMINAL_PID_FILE")

for fd_path in /proc/"$daemon_pid"/fd/*; do
  [ -e "$fd_path" ] || continue
  target=$(readlink -f "$fd_path" 2>/dev/null || true)
  if [ "$target" = "$lock" ]; then
    echo "terminal service regression: the host PTY daemon inherited the stack-operation.lock fd ($fd_path), leaking the lock for as long as the daemon runs" >&2
    exit 1
  fi
done

# Release our own handle. If the daemon still held the lock's open file
# description (the leak this test guards against), a fresh flock would still
# block because BSD-style flock is tied to the open file description, not to
# the process that first acquired it.
exec 9>&-
if ! flock -n "$lock" -c true; then
  echo 'terminal service regression: stack-operation.lock remained held after its acquiring process released it' >&2
  exit 1
fi

printf 'terminal service checks passed.\n'
