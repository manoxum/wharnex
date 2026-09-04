#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
SOURCE_DIST="$ROOT/services/desktop/node_modules/electron/dist"
RUNTIME_BASE=/opt/wharness/electron
LEGACY_HELPER=/usr/local/lib/wharness/chrome-sandbox

is_linux() {
  [ "$(uname -s 2>/dev/null || printf unknown)" = "Linux" ]
}

electron_version() {
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const value = JSON.parse(fs.readFileSync(path, "utf8")).version;
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value || ""))) process.exit(2);
    process.stdout.write(String(value));
  ' "$ROOT/services/desktop/node_modules/electron/package.json"
}

electron_arch() {
  case "$(uname -m 2>/dev/null || printf unknown)" in
    x86_64|amd64) printf 'x64\n' ;;
    aarch64|arm64) printf 'arm64\n' ;;
    armv7l|armv7*) printf 'armv7l\n' ;;
    *)
      echo "Unsupported Linux architecture for Electron runtime: $(uname -m 2>/dev/null || printf unknown)" >&2
      return 1
      ;;
  esac
}

runtime_dir() {
  version=$(electron_version) || {
    echo 'Electron dependencies are missing or invalid. Run: make build' >&2
    return 1
  }
  arch=$(electron_arch) || return 1
  printf '%s/%s-linux-%s\n' "$RUNTIME_BASE" "$version" "$arch"
}

source_electron() {
  printf '%s/electron\n' "$SOURCE_DIST"
}

source_helper() {
  printf '%s/chrome-sandbox\n' "$SOURCE_DIST"
}

runtime_electron() {
  printf '%s/electron\n' "$(runtime_dir)"
}

runtime_helper() {
  printf '%s/chrome-sandbox\n' "$(runtime_dir)"
}

manifest_value() {
  manifest=$1
  key=$2
  sed -n "s/^${key}=//p" "$manifest" | head -n 1
}

is_sha256() {
  value=$1
  [ "${#value}" -eq 64 ] || return 1
  case "$value" in
    *[!0-9a-f]*) return 1 ;;
  esac
}

runtime_is_secure() {
  target=$(runtime_dir) || return 1
  electron="$target/electron"
  helper="$target/chrome-sandbox"
  manifest="$target/.wharness-runtime"

  [ -d "$target" ] || return 1
  [ ! -L "$target" ] || return 1
  [ -x "$electron" ] || return 1
  [ -f "$helper" ] || return 1
  [ ! -L "$electron" ] || return 1
  [ ! -L "$helper" ] || return 1
  [ -f "$manifest" ] || return 1

  [ "$(stat -c '%u' "$target" 2>/dev/null || printf '?')" = "0" ] || return 1
  [ "$(stat -c '%a' "$target" 2>/dev/null || printf '?')" = "755" ] || return 1
  [ "$(stat -c '%u' "$electron" 2>/dev/null || printf '?')" = "0" ] || return 1
  [ "$(stat -c '%a' "$electron" 2>/dev/null || printf '?')" = "755" ] || return 1
  [ "$(stat -c '%u' "$helper" 2>/dev/null || printf '?')" = "0" ] || return 1
  [ "$(stat -c '%g' "$helper" 2>/dev/null || printf '?')" = "0" ] || return 1
  [ "$(stat -c '%a' "$helper" 2>/dev/null || printf '?')" = "4755" ] || return 1

  # The complete runtime is privileged installation state. No file may remain
  # user-owned or group/world-writable after installation.
  if find "$target" -xdev \( ! -user root -o -perm /022 \) -print -quit 2>/dev/null | grep -q .; then
    return 1
  fi
  if find "$target" -xdev ! -path "$helper" -perm /6000 -print -quit 2>/dev/null | grep -q .; then
    return 1
  fi

  expected_version=$(manifest_value "$manifest" version)
  expected_arch=$(manifest_value "$manifest" arch)
  expected_electron_sha=$(manifest_value "$manifest" electron_sha256)
  expected_helper_sha=$(manifest_value "$manifest" chrome_sandbox_sha256)

  [ "$(manifest_value "$manifest" schema)" = "wharness.electron-runtime/v1" ] || return 1
  [ "$expected_version" = "$(electron_version)" ] || return 1
  [ "$expected_arch" = "$(electron_arch)" ] || return 1
  is_sha256 "$expected_electron_sha" || return 1
  is_sha256 "$expected_helper_sha" || return 1
  [ "$(sha256sum "$electron" | awk '{print $1}')" = "$expected_electron_sha" ] || return 1
  [ "$(sha256sum "$helper" | awk '{print $1}')" = "$expected_helper_sha" ] || return 1
}

user_namespaces_available() {
  command -v unshare >/dev/null 2>&1 || return 1
  unshare -Ur true >/dev/null 2>&1
}

resolve_mode() {
  if ! is_linux; then
    printf 'none\n'
    return 0
  fi
  if runtime_is_secure; then
    printf 'runtime\n'
    return 0
  fi
  if user_namespaces_available; then
    printf 'userns\n'
    return 0
  fi
  return 1
}

print_runtime_status() {
  target=$(runtime_dir 2>/dev/null || true)
  if [ -n "$target" ] && [ -e "$target" ]; then
    printf 'Electron runtime candidate: %s\n' "$target"
    printf '  runtime owner=%s mode=%s\n' \
      "$(stat -c '%U:%G' "$target" 2>/dev/null || printf '?')" \
      "$(stat -c '%a' "$target" 2>/dev/null || printf '?')"
    if [ -e "$target/chrome-sandbox" ]; then
      printf '  chrome-sandbox owner=%s mode=%s\n' \
        "$(stat -c '%U:%G' "$target/chrome-sandbox" 2>/dev/null || printf '?')" \
        "$(stat -c '%a' "$target/chrome-sandbox" 2>/dev/null || printf '?')"
    fi
  else
    printf 'Electron runtime is not installed for the current Electron version.\n'
  fi
}

print_failure() {
  target=$(runtime_dir 2>/dev/null || printf '%s/<version>-linux-<arch>' "$RUNTIME_BASE")
  cat >&2 <<EOF_FAILURE
Electron Linux sandbox runtime is unavailable.

Wharness does not make node_modules privileged. npm install/npm ci may replace that
entire tree, so a SUID chrome-sandbox inside the workspace is not durable.

Required immutable runtime:
  $target

Install/synchronize it once for the current Electron version:
  make electron-runtime-install
  make electron-runtime-check
  make start

After installation, normal make build / npm install / npm ci operations do not touch
this runtime. A new install is required only when the pinned Electron version changes.
Wharness never falls back to --no-sandbox.
EOF_FAILURE
  print_runtime_status >&2 || true
}

install_runtime() {
  is_linux || {
    printf 'Dedicated Electron runtime installation is only required on Linux.\n'
    return 0
  }
  command -v sudo >/dev/null 2>&1 || {
    echo 'sudo is required for the root-owned Wharness Electron runtime.' >&2
    exit 1
  }
  command -v sha256sum >/dev/null 2>&1 || {
    echo 'sha256sum is required to install the Electron runtime.' >&2
    exit 1
  }
  command -v cp >/dev/null 2>&1 || {
    echo 'cp is required to install the Electron runtime.' >&2
    exit 1
  }

  source_electron_path=$(source_electron)
  source_helper_path=$(source_helper)
  [ -x "$source_electron_path" ] || {
    echo 'Electron binary is missing. Run: make build' >&2
    exit 1
  }
  [ -f "$source_helper_path" ] || {
    echo 'Electron chrome-sandbox is missing. Run: make build' >&2
    exit 1
  }
  [ ! -L "$source_electron_path" ] || {
    echo 'Refusing to install a symlinked Electron binary.' >&2
    exit 1
  }
  [ ! -L "$source_helper_path" ] || {
    echo 'Refusing to install a symlinked chrome-sandbox helper.' >&2
    exit 1
  }
  if find "$SOURCE_DIST" -type l -print -quit | grep -q .; then
    echo 'Refusing to install Electron runtime containing symbolic links.' >&2
    exit 1
  fi

  version=$(electron_version)
  arch=$(electron_arch)
  target=$(runtime_dir)
  source_electron_sha=$(sha256sum "$source_electron_path" | awk '{print $1}')
  source_helper_sha=$(sha256sum "$source_helper_path" | awk '{print $1}')

  stage_parent=$(mktemp -d "${TMPDIR:-/tmp}/wharness-electron-runtime.XXXXXX")
  trap 'rm -rf "$stage_parent"' EXIT HUP INT TERM
  stage="$stage_parent/runtime"
  cp -a "$SOURCE_DIST" "$stage"
  chmod -R go-w "$stage"
  find "$stage" -exec chmod u-s,g-s {} +
  chmod 0755 "$stage/electron" "$stage/chrome-sandbox"

  [ "$(sha256sum "$stage/electron" | awk '{print $1}')" = "$source_electron_sha" ] || {
    echo 'Electron binary changed while staging the runtime.' >&2
    exit 1
  }
  [ "$(sha256sum "$stage/chrome-sandbox" | awk '{print $1}')" = "$source_helper_sha" ] || {
    echo 'chrome-sandbox changed while staging the runtime.' >&2
    exit 1
  }

  manifest="$stage_parent/manifest"
  cat > "$manifest" <<EOF_MANIFEST
schema=wharness.electron-runtime/v1
version=$version
arch=$arch
electron_sha256=$source_electron_sha
chrome_sandbox_sha256=$source_helper_sha
EOF_MANIFEST
  chmod 0644 "$manifest"

  install_parent="$RUNTIME_BASE/.install-${version}-${arch}-$$"
  printf 'Installing immutable Electron %s (%s) runtime at %s\n' "$version" "$arch" "$target"
  sudo install -d -o root -g root -m 0755 "$RUNTIME_BASE"
  sudo rm -rf -- "$install_parent"
  sudo cp -a -- "$stage" "$install_parent"
  sudo chown -R root:root "$install_parent"
  sudo chmod -R go-w "$install_parent"
  sudo find "$install_parent" -exec chmod u-s,g-s {} +
  sudo chmod 0755 "$install_parent" "$install_parent/electron"
  sudo chmod 4755 "$install_parent/chrome-sandbox"
  sudo install -o root -g root -m 0644 "$manifest" "$install_parent/.wharness-runtime"

  # Verify the privileged staging tree before publishing it as the active runtime.
  installed_electron_sha=$(sha256sum "$install_parent/electron" | awk '{print $1}')
  installed_helper_sha=$(sha256sum "$install_parent/chrome-sandbox" | awk '{print $1}')
  [ "$installed_electron_sha" = "$source_electron_sha" ] || {
    sudo rm -rf -- "$install_parent"
    echo 'Installed Electron runtime checksum mismatch.' >&2
    exit 1
  }
  [ "$installed_helper_sha" = "$source_helper_sha" ] || {
    sudo rm -rf -- "$install_parent"
    echo 'Installed chrome-sandbox checksum mismatch.' >&2
    exit 1
  }
  [ "$(stat -c '%u:%g:%a' "$install_parent/chrome-sandbox")" = "0:0:4755" ] || {
    sudo rm -rf -- "$install_parent"
    echo 'Installed chrome-sandbox metadata is not root:root 4755.' >&2
    exit 1
  }

  sudo rm -rf -- "$target"
  sudo mv -- "$install_parent" "$target"
  sudo chmod 0755 "$target"

  # Remove the obsolete standalone helper from v1.2.23.x. The stable runtime
  # contains the helper beside the exact Electron binary that executes it.
  sudo rm -f -- "$LEGACY_HELPER"

  # Migration cleanup: v1.2.23.x may have made the npm-managed helper SUID.
  # The workspace must return to ordinary user-owned dependency state now that
  # the privileged helper lives only inside the immutable runtime.
  if [ "$(stat -c '%u' "$source_helper_path" 2>/dev/null || printf '?')" = "0" ]; then
    sudo chown "$(id -u):$(id -g)" "$source_helper_path"
  fi
  chmod 0755 "$source_helper_path"

  if ! runtime_is_secure; then
    echo 'Installed Electron runtime failed the Wharness security validation.' >&2
    print_runtime_status >&2 || true
    exit 1
  fi

  printf 'Electron Linux runtime installed and verified: %s\n' "$target"
  printf 'Future npm install/npm ci/make build operations will not modify it.\n'
}

case "${1:-check}" in
  mode)
    if ! resolve_mode; then
      print_failure
      exit 1
    fi
    ;;
  path)
    mode=$(resolve_mode) || {
      print_failure
      exit 1
    }
    case "$mode" in
      runtime) runtime_electron ;;
      userns|none) source_electron ;;
      *) exit 1 ;;
    esac
    ;;
  install)
    install_runtime
    ;;
  check)
    if ! mode=$(resolve_mode); then
      print_failure
      exit 1
    fi
    case "$mode" in
      none)
        printf 'Electron runtime preflight: non-Linux platform; dedicated Linux runtime not required.\n'
        ;;
      runtime)
        printf 'Electron Linux sandbox: immutable runtime + SUID helper (%s)\n' "$(runtime_dir)"
        ;;
      userns)
        printf 'Electron Linux sandbox: user namespaces; workspace SUID helper remains unprivileged.\n'
        ;;
    esac
    ;;
  status)
    print_runtime_status
    ;;
  *)
    echo 'usage: scripts/electron-runtime.sh [check|mode|path|install|status]' >&2
    exit 2
    ;;
esac
