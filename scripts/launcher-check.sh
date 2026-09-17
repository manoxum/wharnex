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
grep -Fx 'make stop' "$trace"
grep -Fx 'make build' "$trace"
grep -Fx 'make start' "$trace"
grep -Fxc 'docker-autostart=1' "$trace" | grep -Fx '3'
# start.sh must know a splash is already owned by this launcher, so it never
# opens a second, redundant one when the launcher's own `make start` runs it.
grep -Fxc 'splash-active=1' "$trace" | grep -Fx '3'
if grep -Fq 'splash-node-mode' "$trace"; then
  echo 'launcher regression: splash inherited ELECTRON_RUN_AS_NODE and started as plain Node' >&2
  exit 1
fi
printf 'launcher splash checks passed.\n'
