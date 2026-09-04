#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
MAKEFILE="$ROOT/Makefile"
START="$ROOT/scripts/start.sh"
ELECTRON_RUNTIME="$ROOT/scripts/electron-runtime.sh"
DESKTOP_DEV="$ROOT/services/desktop/dev.mjs"

section() {
  target=$1
  awk -v header="$target:" '
    $0 == header { inside=1; next }
    inside && /^[A-Za-z0-9_.-]+:/ { exit }
    inside { print }
  ' "$MAKEFILE"
}

build_block=$(section build)
deps_block=$(section deps)

if printf '%s\n' "$build_block" | grep -Eq 'build-runner|docker[[:space:]]+(build|run|info)'; then
  echo 'lifecycle regression: make build must not invoke the Docker runner/daemon' >&2
  exit 1
fi

if printf '%s\n' "$deps_block" | grep -Eq 'command -v docker|docker[[:space:]]'; then
  echo 'lifecycle regression: normal dependencies must not require/invoke Docker' >&2
  exit 1
fi

if grep -Fq '"$ROOT/docker" \' "$START"; then
  echo 'lifecycle regression: Dockerfile changes must not stale the application-only build stamp' >&2
  exit 1
fi

if ! grep -Fq 'build-runner: runner-deps' "$MAKEFILE"; then
  echo 'lifecycle regression: runner construction must remain an explicit guarded target' >&2
  exit 1
fi

printf 'Lifecycle network-stability checks passed.\n'


if [ ! -x "$ELECTRON_RUNTIME" ]; then
  echo 'lifecycle regression: immutable Electron runtime manager is missing or not executable' >&2
  exit 1
fi

if ! grep -Fq '/opt/wharness/electron' "$ELECTRON_RUNTIME"; then
  echo 'lifecycle regression: Linux Electron runtime must live outside the npm workspace' >&2
  exit 1
fi

if grep -Eq 'sudo[[:space:]]+(chown|chmod).*SOURCE_(HELPER|DIST)' "$ELECTRON_RUNTIME"; then
  echo 'lifecycle regression: node_modules Electron files must never be made privileged in place' >&2
  exit 1
fi

if ! grep -Fq 'WHARNESS_ELECTRON_BINARY' "$START" || ! grep -Fq 'electron-runtime.sh' "$START"; then
  echo 'lifecycle regression: start must resolve the immutable Electron runtime before launch' >&2
  exit 1
fi

if ! grep -Fq 'resolveElectronBinary' "$DESKTOP_DEV" || ! grep -Fq 'electron-runtime.sh' "$DESKTOP_DEV"; then
  echo 'lifecycle regression: desktop coordinator must resolve and honor the immutable Electron binary' >&2
  exit 1
fi

printf 'Lifecycle immutable Electron runtime checks passed.
'

DEPS_CACHE="$ROOT/scripts/deps-cache.sh"
if [ ! -x "$DEPS_CACHE" ]; then
  echo 'lifecycle regression: dependency fingerprint cache helper is missing' >&2
  exit 1
fi
if ! grep -Fq 'deps-cache.sh" sync' "$MAKEFILE"; then
  echo 'lifecycle regression: make deps must use dependency fingerprint cache' >&2
  exit 1
fi
if ! grep -Fq -- '--prefer-offline' "$DEPS_CACHE" || \
   ! grep -Fq -- '--no-audit' "$DEPS_CACHE" || \
   ! grep -Fq -- '--no-fund' "$DEPS_CACHE"; then
  echo 'lifecycle regression: npm hydration must reuse cache without audit/funding network work' >&2
  exit 1
fi
if printf '%s\n' "$deps_block" | grep -Eq 'npm[[:space:]]+install'; then
  echo 'lifecycle regression: make deps must not unconditionally run npm install' >&2
  exit 1
fi
if ! printf '%s\n' "$build_block" | grep -Fq '$(BUILD_JOBS)'; then
  echo 'lifecycle regression: application components must retain bounded parallel build support' >&2
  exit 1
fi
printf 'Lifecycle fast rebuild checks passed.\n'

BUILD_CACHE="$ROOT/scripts/build-cache.sh"
if [ ! -x "$BUILD_CACHE" ]; then
  echo 'lifecycle regression: compiled-artifact cache helper is missing' >&2
  exit 1
fi
if ! grep -Fq 'build-cache.sh" run frontend' "$MAKEFILE"; then
  echo 'lifecycle regression: frontend production build must use the artifact fingerprint cache' >&2
  exit 1
fi
if ! grep -Fq 'services/frontend/dist/index.html' "$BUILD_CACHE"; then
  echo 'lifecycle regression: frontend cache hit must require the production artifact' >&2
  exit 1
fi
if ! grep -Fq 'build-previous-success' "$MAKEFILE"; then
  echo 'lifecycle regression: build adoption must preserve fail-closed active build stamp semantics' >&2
  exit 1
fi
printf 'Lifecycle compiled-artifact cache checks passed.\n'
