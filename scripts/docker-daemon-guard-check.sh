#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
fake_bin="$temporary/bin"
state="$temporary/docker-running"
trace="$temporary/trace"

mkdir -p "$fake_bin"
cat >"$fake_bin/uname" <<'EOF'
#!/usr/bin/env sh
printf 'Linux\n'
EOF
cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  is-active)
    [ -f "$WHARNESS_DOCKER_GUARD_STATE" ] && exit 0
    exit 3
    ;;
  start)
    printf 'systemctl %s\n' "$*" >>"$WHARNESS_DOCKER_GUARD_TRACE"
    : >"$WHARNESS_DOCKER_GUARD_STATE"
    ;;
  *)
    exit 64
    ;;
esac
EOF
chmod 0755 "$fake_bin/uname" "$fake_bin/systemctl"

if PATH="$fake_bin:$PATH" \
  WHARNESS_DOCKER_GUARD_STATE="$state" \
  WHARNESS_DOCKER_GUARD_TRACE="$trace" \
  "$ROOT/scripts/docker-daemon-guard.sh" >"$temporary/default.out" 2>&1; then
  echo 'docker daemon guard regression: terminal lifecycle unexpectedly auto-started Docker' >&2
  exit 1
fi
grep -Fqx 'Docker is stopped. Start docker.service explicitly, then retry.' "$temporary/default.out"
[ ! -e "$trace" ] || {
  echo 'docker daemon guard regression: terminal lifecycle invoked systemctl start' >&2
  exit 1
}

PATH="$fake_bin:$PATH" \
WHARNESS_DOCKER_GUARD_STATE="$state" \
WHARNESS_DOCKER_GUARD_TRACE="$trace" \
WHARNESS_LAUNCHER_AUTOSTART_DOCKER=1 \
"$ROOT/scripts/docker-daemon-guard.sh"
grep -Fqx 'systemctl start docker.service' "$trace"
printf 'docker daemon guard checks passed.\n'
