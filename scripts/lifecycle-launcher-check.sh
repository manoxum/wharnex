#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
MAKEFILE="$ROOT/Makefile"
START="$ROOT/scripts/start.sh"
LAUNCHER="$ROOT/scripts/launcher.sh"
SPLASH_LIB="$ROOT/scripts/splash-lib.sh"
SOURCE_FINGERPRINT="$ROOT/scripts/source-fingerprint.sh"
SOURCE_FINGERPRINT_CHECK="$ROOT/scripts/source-fingerprint-check.sh"
LAUNCHER_CHECK="$ROOT/scripts/launcher-check.sh"
INSTALL_DEV="$ROOT/scripts/install-dev.sh"
INSTALL_DEV_CHECK="$ROOT/scripts/install-dev-check.sh"
DOCKER_DAEMON_GUARD_CHECK="$ROOT/scripts/docker-daemon-guard-check.sh"
STOP="$ROOT/scripts/stop.sh"

if ! grep -Fq 'install-dev:' "$MAKEFILE" || ! grep -Fq 'scripts/install-dev.sh' "$MAKEFILE" || [ ! -x "$INSTALL_DEV" ]; then
  echo 'lifecycle regression: make install-dev must install the per-instance desktop launcher' >&2
  exit 1
fi
if [ ! -x "$INSTALL_DEV_CHECK" ] || [ ! -x "$SOURCE_FINGERPRINT_CHECK" ] || [ ! -x "$LAUNCHER_CHECK" ]; then
  echo 'lifecycle regression: launcher installation and fingerprint need behavioral checks' >&2
  exit 1
fi
if [ ! -x "$LAUNCHER" ] || [ ! -x "$SOURCE_FINGERPRINT" ]; then
  echo 'lifecycle regression: desktop launcher needs source-fingerprint helpers' >&2
  exit 1
fi
WHARNESS_ROOT="$ROOT" "$SOURCE_FINGERPRINT_CHECK"
WHARNESS_ROOT="$ROOT" "$LAUNCHER_CHECK"
WHARNESS_ROOT="$ROOT" "$INSTALL_DEV_CHECK"

if ! grep -Fq 'launcher-splash.mjs' "$SPLASH_LIB" || ! grep -Fq 'WHARNESS_SPLASH_READY_FILE' "$SPLASH_LIB" || ! grep -Fq 'wharnex_splash_open' "$LAUNCHER"; then
  echo 'lifecycle regression: launcher must open its splash before update work' >&2
  exit 1
fi
if ! grep -Fq 'WHARNEX_BOOT_PREVIOUS=1' "$LAUNCHER" || ! grep -Fq 'wharnex_splash_run make stop && wharnex_splash_run make start' "$LAUNCHER"; then
  echo 'lifecycle regression: failed updates must keep the last built Desktop available' >&2
  exit 1
fi
if ! grep -Fq 'Requested foreground handoff to the running Desktop.' "$START" || ! grep -Fq 'kill -USR1 "$focus_pid"' "$START"; then
  echo 'lifecycle regression: an already-running Desktop must receive a foreground handoff' >&2
  exit 1
fi
if [ ! -x "$DOCKER_DAEMON_GUARD_CHECK" ]; then
  echo 'lifecycle regression: Docker lifecycle needs an isolated daemon-start check' >&2
  exit 1
fi
WHARNESS_ROOT="$ROOT" "$DOCKER_DAEMON_GUARD_CHECK"
if grep -Eq 'database\.sh.*stop|stack\.sh.*(stop|down)' "$STOP" || awk '/^stop:/ { inside=1; next } inside && /^[A-Za-z0-9_.-]+:/ { exit } inside { print }' "$MAKEFILE" | grep -Eq 'stack-(stop|down)'; then
  echo 'lifecycle regression: make stop must preserve the persistent Compose stack' >&2
  exit 1
fi
if ! grep -Fq 'Wharnex build is required' "$START" || ! grep -Fq '(cd "$ROOT" && wharnex_splash_run make build)' "$START" || ! grep -Fq 'source fingerprint changed' "$START"; then
  echo 'lifecycle regression: ordinary make start must rebuild a stale application' >&2
  exit 1
fi
if [ ! -f "$SPLASH_LIB" ] || ! grep -Fq 'wharnex_splash_open' "$SPLASH_LIB" || ! grep -Fq 'wharnex_splash_close' "$SPLASH_LIB"; then
  echo 'lifecycle regression: launcher and direct start need shared splash helpers' >&2
  exit 1
fi
if ! grep -Fq 'splash-lib.sh' "$START" || ! grep -Fq 'wharnex_splash_open' "$START" || ! grep -Fq 'WHARNESS_LAUNCHER_SPLASH_ACTIVE' "$START"; then
  echo 'lifecycle regression: direct start needs one splash and launcher handoff' >&2
  exit 1
fi
if ! grep -Fq 'WHARNESS_LAUNCHER_SPLASH_ACTIVE=1' "$LAUNCHER"; then
  echo 'lifecycle regression: launcher must tell make start it owns the splash' >&2
  exit 1
fi
