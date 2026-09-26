#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
fixture="$temporary/repo"
fake_bin="$temporary/bin"
trace="$temporary/trace"

mkdir -p "$fixture/scripts" "$fixture/services/desktop" "$fixture/.harness/run" "$fake_bin"
cp "$ROOT/scripts/launcher.sh" "$ROOT/scripts/source-fingerprint.sh" "$ROOT/scripts/splash-lib.sh" "$fixture/scripts/"
cp "$ROOT/services/desktop/launcher-splash.mjs" "$fixture/services/desktop/launcher-splash.mjs"
chmod 0755 "$fixture/scripts/launcher.sh" "$fixture/scripts/source-fingerprint.sh"
printf 'fixture source\n' >"$fixture/Makefile"

cat >"$fake_bin/electron" <<'EOF'
#!/usr/bin/env sh
[ -z "${ELECTRON_RUN_AS_NODE:-}" ] || { printf 'splash-node-mode\n' >>"$WHARNESS_LAUNCHER_TRACE"; exit 9; }
printf 'splash-open\n' >>"$WHARNESS_LAUNCHER_TRACE"
printf 'ready\n' >"$WHARNESS_SPLASH_READY_FILE"
while [ -f "$WHARNESS_SPLASH_STATUS_FILE" ]; do sleep 0.01; done
EOF
cat >"$fake_bin/make" <<'EOF'
#!/usr/bin/env sh
printf 'make %s\n' "$*" >>"$WHARNESS_LAUNCHER_TRACE"
printf 'docker-autostart=%s\n' "${WHARNESS_LAUNCHER_AUTOSTART_DOCKER:-}" >>"$WHARNESS_LAUNCHER_TRACE"
printf 'splash-active=%s\n' "${WHARNESS_LAUNCHER_SPLASH_ACTIVE:-}" >>"$WHARNESS_LAUNCHER_TRACE"
printf 'boot-previous=%s\n' "${WHARNEX_BOOT_PREVIOUS:-}" >>"$WHARNESS_LAUNCHER_TRACE"
[ "${WHARNEX_TEST_BUILD_FAIL:-0}" != 1 ] || [ "$*" != build ] || exit 1
[ "${WHARNEX_TEST_START_FAIL:-0}" != 1 ] || [ "$*" != start ] || [ "${WHARNEX_BOOT_PREVIOUS:-0}" = 1 ] || exit 1
EOF
cat >"$fake_bin/zenity" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
chmod 0755 "$fake_bin/electron" "$fake_bin/make" "$fake_bin/zenity"

PATH="$fake_bin:$PATH" \
WHARNESS_ROOT="$fixture" \
WHARNESS_LAUNCHER_TRACE="$trace" \
WHARNESS_ELECTRON_BINARY="$fake_bin/electron" \
ELECTRON_RUN_AS_NODE=1 \
"$fixture/scripts/launcher.sh"

first_splash=$(awk '/^splash-open$/ { print NR; exit }' "$trace")
first_make=$(awk '/^make / { print NR; exit }' "$trace")
[ -n "$first_splash" ] && [ -n "$first_make" ] && [ "$first_splash" -lt "$first_make" ] || {
  echo 'launcher regression: a build began before the separate splash opened' >&2
  exit 1
}
grep -Fx 'make build' "$trace"
grep -Fx 'make stop' "$trace"
grep -Fx 'make start' "$trace"
build_line=$(awk '/^make build$/ { print NR; exit }' "$trace")
stop_line=$(awk '/^make stop$/ { print NR; exit }' "$trace")
[ "$build_line" -lt "$stop_line" ] || { echo 'launcher regression: Desktop stopped before a successful build' >&2; exit 1; }
grep -Fxc 'docker-autostart=1' "$trace" | grep -Fx '3'
# start.sh must know a splash is already owned by this launcher, so it never
# opens a second, redundant one when the launcher's own `make start` runs it.
grep -Fxc 'splash-active=1' "$trace" | grep -Fx '3'
if grep -Fq 'splash-node-mode' "$trace"; then
  echo 'launcher regression: splash inherited ELECTRON_RUN_AS_NODE and started as plain Node' >&2
  exit 1
fi

# A registry/DNS outage during an update must leave the previous installation
# available. The next launch should retry the pending build.
: >"$fixture/.harness/build-previous-success"
: >"$trace"
PATH="$fake_bin:$PATH" \
WHARNESS_ROOT="$fixture" \
WHARNESS_LAUNCHER_TRACE="$trace" \
WHARNESS_ELECTRON_BINARY="$fake_bin/electron" \
WHARNEX_TEST_BUILD_FAIL=1 \
"$fixture/scripts/launcher.sh"
grep -Fx 'make build' "$trace"
grep -Fx 'make start' "$trace"
grep -Fx 'boot-previous=1' "$trace"
if grep -Fxq 'make stop' "$trace"; then
  echo 'launcher regression: failed update stopped the previous Desktop' >&2
  exit 1
fi
# A recovered boot must leave the source fingerprint pending for the next try.
PATH="$fake_bin:$PATH" \
WHARNESS_ROOT="$fixture" \
WHARNESS_LAUNCHER_TRACE="$trace" \
WHARNESS_ELECTRON_BINARY="$fake_bin/electron" \
WHARNEX_TEST_BUILD_FAIL=1 \
"$fixture/scripts/launcher.sh"
[ "$(grep -Fxc 'make build' "$trace")" -eq 2 ] || {
  echo 'launcher regression: failed source update was incorrectly marked built' >&2
  exit 1
}

rm -f "$fixture/.harness/build-previous-success"
: >"$trace"
if PATH="$fake_bin:$PATH" \
  WHARNESS_ROOT="$fixture" \
  WHARNESS_LAUNCHER_TRACE="$trace" \
  WHARNESS_ELECTRON_BINARY="$fake_bin/electron" \
  WHARNEX_TEST_BUILD_FAIL=1 \
  "$fixture/scripts/launcher.sh"; then
  echo 'launcher regression: a fresh install claimed a nonexistent previous build' >&2
  exit 1
fi
if grep -Eq '^make (stop|start)$' "$trace"; then
  echo 'launcher regression: failed first build attempted to start nonexistent images' >&2
  exit 1
fi

WHARNESS_ROOT="$fixture" "$fixture/scripts/source-fingerprint.sh" write
: >"$fixture/.harness/build-success"
: >"$trace"
PATH="$fake_bin:$PATH" \
WHARNESS_ROOT="$fixture" \
WHARNESS_LAUNCHER_TRACE="$trace" \
WHARNESS_ELECTRON_BINARY="$fake_bin/electron" \
WHARNEX_TEST_START_FAIL=1 \
"$fixture/scripts/launcher.sh"
[ "$(grep -Fxc 'make start' "$trace")" -eq 2 ] || {
  echo 'launcher regression: a failed direct start did not recover from the last build' >&2
  exit 1
}
if grep -Eq '^make (stop|build)$' "$trace"; then
  echo 'launcher regression: recovery rebuilt or stopped an already built Desktop' >&2
  exit 1
fi
printf 'launcher splash checks passed.\n'
