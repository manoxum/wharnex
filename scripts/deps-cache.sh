#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
CACHE_DIR=${WHARNESS_DEPS_CACHE_DIR:-$ROOT/.harness/cache/dependencies}
NPM_CACHE=${WHARNESS_NPM_CACHE:-${HOME:-$ROOT/.harness}/.cache/wharness-npm}
ACTION=${1:-sync}

mkdir -p "$CACHE_DIR" "$NPM_CACHE"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "$1 is required" >&2
    exit 1
  }
}

# Minimum Node accepted for an npm install, taken from the postinstall
# requirement of the Electron pinned in services/desktop/package.json.
# Below it, `npm ci` for the desktop dies inside electron's own install.js
# with a bare ERR_REQUIRE_ESM stack that names neither Node nor the
# requirement — and a self-evolution host build runs with the backend
# CONTAINER's Node, not the operator's, so the same repository can build by
# hand and fail under Wharness. Fail loudly here instead.
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=12

node_version_satisfies_minimum() {
  version=$(node --version 2>/dev/null | sed 's/^v//') || return 1
  major=${version%%.*}
  rest=${version#*.}
  minor=${rest%%.*}
  case "$major" in ''|*[!0-9]*) major=0 ;; esac
  case "$minor" in ''|*[!0-9]*) minor=0 ;; esac
  [ "$major" -gt "$MIN_NODE_MAJOR" ] && return 0
  [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]
}

# Tries to align the HOST's own Node with what this repository needs, using
# the operator's own nvm install (never installed or invoked by Wharness
# itself, and never touched from inside a container: nvm is bash-only and
# per-user, so this only ever matters for a human-invoked `make build`/`make
# deps` on the host — a container-scoped build, such as self-evolution's
# BuildHost running `make build-stage` inside the backend image, satisfies
# MIN_NODE_MAJOR/MIN_NODE_MINOR directly from that image's own pinned Node
# and never reaches this fallback). Prints the resolved node's directory on
# success so the caller can put it first on PATH; prints nothing on failure.
try_nvm_alignment() {
  command -v bash >/dev/null 2>&1 || return 1
  nvm_dir=${NVM_DIR:-$HOME/.nvm}
  [ -s "$nvm_dir/nvm.sh" ] || return 1
  resolved=$(NVM_DIR="$nvm_dir" MIN_NODE_MAJOR="$MIN_NODE_MAJOR" MIN_NODE_MINOR="$MIN_NODE_MINOR" bash -c '
    set -e
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    # Prefer an already-installed version that satisfies the minimum (avoids
    # a network install when the operator already has a suitable one, just
    # not selected as "current") before falling back to installing --lts.
    for candidate in $(nvm ls --no-colors 2>/dev/null | grep -oE "v[0-9]+\.[0-9]+\.[0-9]+" | sort -t. -k1.2,1n -k2,2n -k3,3n -r); do
      major=${candidate#v}; major=${major%%.*}
      rest=${candidate#v*.}; minor=${rest%%.*}
      if [ "$major" -gt "$MIN_NODE_MAJOR" ] || { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; }; then
        nvm use "$candidate" >/dev/null 2>&1 && { command -v node; exit 0; }
      fi
    done
    nvm install --lts >/dev/null 2>&1 && { command -v node; exit 0; }
    exit 1
  ' 2>/dev/null) || return 1
  [ -n "$resolved" ] && [ -x "$resolved" ] || return 1
  dirname "$resolved"
}

require_supported_node() {
  require node
  if node_version_satisfies_minimum; then return 0; fi
  found_version=$(node --version 2>/dev/null || echo unknown)
  printf '[deps] Node %s on PATH is older than this repository requires (>= %s.%s); trying nvm...\n' "$found_version" "$MIN_NODE_MAJOR" "$MIN_NODE_MINOR" >&2
  if node_dir=$(try_nvm_alignment) && [ -n "$node_dir" ]; then
    PATH="$node_dir:$PATH"
    export PATH
    hash -r 2>/dev/null || true
    if node_version_satisfies_minimum; then
      printf '[deps] nvm aligned this build to Node %s (%s)\n' "$(node --version)" "$node_dir" >&2
      return 0
    fi
  fi
  {
    printf '[deps] Node %s is too old for this repository: the pinned Electron requires >= %s.%s, and nvm-based alignment was unavailable or failed.\n' "$found_version" "$MIN_NODE_MAJOR" "$MIN_NODE_MINOR"
    printf '[deps] node in use: %s\n' "$(command -v node 2>/dev/null || echo 'not found')"
    printf '[deps] A Wharness self-evolution host build runs with the backend CONTAINER Node,\n'
    printf '[deps] not the one on your shell PATH. If this fired during self-evolution, rebuild\n'
    printf '[deps] the backend image (services/backend/Dockerfile pins the Alpine release that\n'
    printf '[deps] provides Node). Otherwise install nvm or upgrade the Node on PATH.\n'
  } >&2
  exit 1
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

go_fingerprint() {
  service="$ROOT/services/backend"
  {
    go version
    sha256sum "$service/go.mod"
    if [ -f "$service/go.sum" ]; then sha256sum "$service/go.sum"; fi
  } | hash_stream
}

node_fingerprint() {
  service=$1
  {
    node --version
    npm --version
    sha256sum "$service/package.json" "$service/package-lock.json"
    if [ -f "$service/.npmrc" ]; then sha256sum "$service/.npmrc"; fi
  } | hash_stream
}

node_ready() {
  name=$1
  service=$2
  hidden="$service/node_modules/.package-lock.json"
  [ -f "$hidden" ] || return 1
  case "$name" in
    frontend)
      [ -x "$service/node_modules/.bin/tsc" ] &&
        [ -x "$service/node_modules/.bin/vite" ]
      ;;
    desktop)
      [ -f "$service/node_modules/electron/package.json" ] &&
        [ -f "$service/node_modules/electron/path.txt" ] || return 1
      electron_path=$(cat "$service/node_modules/electron/path.txt")
      [ -n "$electron_path" ] &&
        [ -x "$service/node_modules/electron/dist/$electron_path" ]
      ;;
    *) return 1 ;;
  esac
}

hydrate_desktop_runtime() {
  service=$1
  # Electron 44 ships its binary downloader as an explicit entry point rather
  # than an npm lifecycle script. Importing the package preserves Electron's
  # supported cache/download behavior and materializes path.txt plus dist/.
  (cd "$service" && node -e "import('electron').then(({default: p}) => { if (!p) process.exit(1) })")
}

hidden_lock_matches() {
  service=$1
  node - "$service/package-lock.json" "$service/node_modules/.package-lock.json" <<'NODE'
const fs = require('fs')
const [rootPath, hiddenPath] = process.argv.slice(2)
const root = JSON.parse(fs.readFileSync(rootPath, 'utf8'))
const hidden = JSON.parse(fs.readFileSync(hiddenPath, 'utf8'))
const expected = root.packages || {}
const installed = hidden.packages || {}
const rootMeta = expected[''] || {}
const direct = {
  ...(rootMeta.dependencies || {}),
  ...(rootMeta.devDependencies || {}),
  ...(rootMeta.optionalDependencies || {}),
}
for (const name of Object.keys(direct)) {
  const key = `node_modules/${name}`
  if (!expected[key] || !installed[key] || expected[key].version !== installed[key].version) {
    process.exit(1)
  }
}
for (const [key, meta] of Object.entries(installed)) {
  if (!key || !expected[key]) continue
  if (meta.version !== expected[key].version ||
      (meta.integrity && expected[key].integrity && meta.integrity !== expected[key].integrity)) {
    process.exit(1)
  }
}
NODE
}

can_adopt_node_modules() {
  name=$1
  service=$2
  hidden="$service/node_modules/.package-lock.json"
  node_ready "$name" "$service" || return 1
  hidden_lock_matches "$service" || return 1
  [ ! "$service/package.json" -nt "$hidden" ] || return 1
  [ ! "$service/package-lock.json" -nt "$hidden" ] || return 1
  if [ -f "$service/.npmrc" ] && [ "$service/.npmrc" -nt "$hidden" ]; then
    return 1
  fi
  return 0
}

sync_go() {
  service="$ROOT/services/backend"
  stamp="$CACHE_DIR/backend.sha256"
  fingerprint=$(go_fingerprint)
  if [ "${WHARNESS_DEPS_FORCE:-0}" != "1" ] && stamp_matches "$stamp" "$fingerprint"; then
    printf '[deps] backend: cache hit; go mod download skipped\n'
    return
  fi
  printf '[deps] backend: dependency metadata changed; hydrating Go module cache\n'
  (cd "$service" && go mod download)
  write_stamp "$stamp" "$fingerprint"
}

sync_node() {
  name=$1
  service="$ROOT/services/$name"
  stamp="$CACHE_DIR/$name.sha256"
  fingerprint=$(node_fingerprint "$service")

  if [ "${WHARNESS_DEPS_FORCE:-0}" != "1" ] && stamp_matches "$stamp" "$fingerprint" && node_ready "$name" "$service"; then
    printf '[deps] %s: cache hit; npm ci skipped\n' "$name"
    return
  fi

  if [ "${WHARNESS_DEPS_FORCE:-0}" != "1" ] && [ ! -f "$stamp" ] && can_adopt_node_modules "$name" "$service"; then
    write_stamp "$stamp" "$fingerprint"
    printf '[deps] %s: adopted current lock-consistent node_modules; npm ci skipped\n' "$name"
    return
  fi

  require_supported_node
  printf '[deps] %s: dependency metadata changed or install missing; running deterministic npm ci\n' "$name"
  (
    cd "$service"
    npm ci \
      --cache "$NPM_CACHE" \
      --prefer-offline \
      --no-audit \
      --no-fund \
      --progress=false
  )
  if [ "$name" = desktop ]; then
    hydrate_desktop_runtime "$service"
  fi
  node_ready "$name" "$service" || {
    echo "[deps] $name: npm ci completed but required runtime files are missing" >&2
    exit 1
  }
  write_stamp "$stamp" "$fingerprint"
}

show_status() {
  for name in backend frontend desktop; do
    case "$name" in
      backend) current=$(go_fingerprint) ;;
      *) current=$(node_fingerprint "$ROOT/services/$name") ;;
    esac
    stamp="$CACHE_DIR/$name.sha256"
    if stamp_matches "$stamp" "$current"; then
      printf '%-9s valid  %s\n' "$name" "$current"
    else
      printf '%-9s stale  %s\n' "$name" "$current"
    fi
  done
}

require sha256sum
require go
require node
require npm

case "$ACTION" in
  sync)
    sync_go
    sync_node frontend
    sync_node desktop
    ;;
  status)
    show_status
    ;;
  refresh)
    WHARNESS_DEPS_FORCE=1
    export WHARNESS_DEPS_FORCE
    sync_go
    sync_node frontend
    sync_node desktop
    ;;
  *)
    echo "usage: $0 [sync|status|refresh]" >&2
    exit 2
    ;;
esac
