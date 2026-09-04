#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
CACHE_DIR=${WHARNESS_BUILD_CACHE_DIR:-$ROOT/.harness/cache/builds}
BASELINE_STAMP=${WHARNESS_BUILD_BASELINE_STAMP:-$ROOT/.harness/build-previous-success}
ACTION=${1:-status}
COMPONENT=${2:-}

mkdir -p "$CACHE_DIR"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "$1 is required" >&2
    exit 1
  }
}

hash_stream() {
  sha256sum | awk '{print $1}'
}

stamp_matches() {
  stamp=$1
  expected=$2
  [ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$expected" ]
}

write_stamp() {
  stamp=$1
  value=$2
  tmp="$stamp.tmp.$$"
  printf '%s\n' "$value" >"$tmp"
  mv -f "$tmp" "$stamp"
}

hash_tree() {
  dir=$1
  [ -d "$dir" ] || return 0
  (
    cd "$dir"
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
  )
}

hash_named_files() {
  base=$1
  shift
  for file in "$@"; do
    if [ -f "$base/$file" ]; then
      (cd "$base" && sha256sum "$file")
    fi
  done
}

backend_fingerprint() {
  service="$ROOT/services/backend"
  {
    go version
    printf 'GOOS=%s\n' "$(go env GOOS)"
    printf 'GOARCH=%s\n' "$(go env GOARCH)"
    printf 'GOFLAGS=%s\n' "$(go env GOFLAGS)"
    printf 'CGO_ENABLED=0\n'
    hash_named_files "$service" go.mod go.sum
    (
      cd "$service"
      find . -type f -name '*.go' -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
    )
  } | hash_stream
}

frontend_fingerprint() {
  service="$ROOT/services/frontend"
  {
    node --version
    npm --version
    printf 'NODE_ENV=%s\n' "${NODE_ENV:-}"
    env | LC_ALL=C sort | grep '^VITE_' || true
    hash_named_files "$service" \
      package.json package-lock.json .npmrc index.html vite.config.ts playwright.config.ts \
      tsconfig.json tsconfig.app.json tsconfig.node.json \
      .env .env.local .env.production .env.production.local
    printf '[src]\n'
    hash_tree "$service/src"
    printf '[public]\n'
    hash_tree "$service/public"
  } | hash_stream
}

desktop_fingerprint() {
  service="$ROOT/services/desktop"
  {
    node --version
    npm --version
    (
      cd "$service"
      find . -maxdepth 1 -type f \
        \( -name '*.mjs' -o -name '*.cjs' -o -name 'package.json' -o -name 'package-lock.json' -o -name '.npmrc' \) \
        -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
    )
  } | hash_stream
}

fingerprint() {
  case "$1" in
    backend) backend_fingerprint ;;
    frontend) frontend_fingerprint ;;
    desktop) desktop_fingerprint ;;
    *) echo "unknown build component: $1" >&2; exit 2 ;;
  esac
}

output_ready() {
  case "$1" in
    backend)
      [ -x "$ROOT/dist/bin/wharness-backend" ]
      ;;
    frontend)
      [ -s "$ROOT/services/frontend/dist/index.html" ]
      ;;
    desktop)
      electron_root="$ROOT/services/desktop/node_modules/electron"
      [ -f "$electron_root/package.json" ] || return 1
      [ -f "$electron_root/path.txt" ] || return 1
      electron_rel=$(cat "$electron_root/path.txt" 2>/dev/null || true)
      [ -n "$electron_rel" ] && [ -x "$electron_root/dist/$electron_rel" ]
      ;;
    *) return 1 ;;
  esac
}

has_newer_inputs() {
  component=$1
  baseline=$2
  case "$component" in
    backend)
      service="$ROOT/services/backend"
      for file in go.mod go.sum; do
        if [ -f "$service/$file" ] && [ "$service/$file" -nt "$baseline" ]; then return 0; fi
      done
      find "$service" -type f -name '*.go' -newer "$baseline" -print -quit | grep -q .
      ;;
    frontend)
      service="$ROOT/services/frontend"
      for file in package.json package-lock.json .npmrc index.html vite.config.ts playwright.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json .env .env.local .env.production .env.production.local; do
        if [ -f "$service/$file" ] && [ "$service/$file" -nt "$baseline" ]; then return 0; fi
      done
      for dir in src public; do
        if [ -d "$service/$dir" ] && find "$service/$dir" -type f -newer "$baseline" -print -quit | grep -q .; then return 0; fi
      done
      return 1
      ;;
    desktop)
      service="$ROOT/services/desktop"
      find "$service" -maxdepth 1 -type f \
        \( -name '*.mjs' -o -name '*.cjs' -o -name 'package.json' -o -name 'package-lock.json' -o -name '.npmrc' \) \
        -newer "$baseline" -print -quit | grep -q .
      ;;
    *) return 0 ;;
  esac
}

can_adopt_previous_build() {
  component=$1
  deps_stamp="$ROOT/.harness/cache/dependencies/$component.sha256"
  [ -f "$BASELINE_STAMP" ] || return 1
  [ -f "$deps_stamp" ] || return 1
  [ ! "$deps_stamp" -nt "$BASELINE_STAMP" ] || return 1
  output_ready "$component" || return 1
  if has_newer_inputs "$component" "$BASELINE_STAMP"; then return 1; fi
  return 0
}

build_component() {
  component=$1
  shift
  stamp="$CACHE_DIR/$component.sha256"
  current=$(fingerprint "$component")

  if [ "${WHARNESS_BUILD_FORCE:-0}" != "1" ] && stamp_matches "$stamp" "$current" && output_ready "$component"; then
    printf '[build] %s: cache hit; compilation skipped\n' "$component"
    return
  fi

  if [ "${WHARNESS_BUILD_FORCE:-0}" != "1" ] && [ ! -f "$stamp" ] && can_adopt_previous_build "$component"; then
    write_stamp "$stamp" "$current"
    printf '[build] %s: adopted previous successful artifact; compilation skipped\n' "$component"
    return
  fi

  printf '[build] %s: inputs changed or artifact missing; compiling\n' "$component"
  "$@"
  output_ready "$component" || {
    echo "[build] $component: command completed but expected artifact/runtime is missing" >&2
    exit 1
  }
  write_stamp "$stamp" "$current"
}

show_status() {
  for component in backend frontend desktop; do
    current=$(fingerprint "$component")
    stamp="$CACHE_DIR/$component.sha256"
    if stamp_matches "$stamp" "$current" && output_ready "$component"; then
      printf '%-9s valid  %s\n' "$component" "$current"
    elif [ ! -f "$stamp" ] && can_adopt_previous_build "$component"; then
      printf '%-9s adopt  %s\n' "$component" "$current"
    else
      printf '%-9s stale  %s\n' "$component" "$current"
    fi
  done
}

require sha256sum
require find
require sort
require xargs
require grep

case "$ACTION" in
  run)
    [ -n "$COMPONENT" ] || { echo "usage: $0 run <backend|frontend|desktop> command..." >&2; exit 2; }
    case "$COMPONENT" in
      backend) require go ;;
      frontend|desktop) require node; require npm ;;
      *) echo "unknown build component: $COMPONENT" >&2; exit 2 ;;
    esac
    shift 2
    [ "$#" -gt 0 ] || { echo "build command is required" >&2; exit 2; }
    build_component "$COMPONENT" "$@"
    ;;
  status)
    require go
    require node
    require npm
    show_status
    ;;
  invalidate)
    rm -rf "$CACHE_DIR"
    mkdir -p "$CACHE_DIR"
    ;;
  *)
    echo "usage: $0 [status|invalidate|run <component> command...]" >&2
    exit 2
    ;;
esac
