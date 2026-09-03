#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
MAKEFILE="$ROOT/Makefile"
START="$ROOT/scripts/start.sh"

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
