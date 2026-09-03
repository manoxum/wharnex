#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
SOURCE_HELPER="$ROOT/services/desktop/node_modules/electron/dist/chrome-sandbox"
PERSISTENT_HELPER=${WHARNESS_ELECTRON_SANDBOX_PATH:-/usr/local/lib/wharness/chrome-sandbox}

is_linux() {
  [ "$(uname -s 2>/dev/null || printf unknown)" = "Linux" ]
}

is_secure_setuid_helper() {
  helper=$1
  [ -f "$helper" ] || return 1
  [ ! -L "$helper" ] || return 1
  uid=$(stat -c '%u' "$helper" 2>/dev/null || return 1)
  gid=$(stat -c '%g' "$helper" 2>/dev/null || return 1)
  mode=$(stat -c '%a' "$helper" 2>/dev/null || return 1)
  [ "$uid" = "0" ] && [ "$gid" = "0" ] && [ "$mode" = "4755" ]
}

bundled_helper_is_secure() {
  is_secure_setuid_helper "$SOURCE_HELPER"
}

persistent_helper_is_current() {
  is_secure_setuid_helper "$PERSISTENT_HELPER" || return 1
  [ -f "$SOURCE_HELPER" ] || return 1
  cmp -s "$SOURCE_HELPER" "$PERSISTENT_HELPER"
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
  if bundled_helper_is_secure; then
    printf 'setuid\n'
    return 0
  fi
  if user_namespaces_available; then
    printf 'userns\n'
    return 0
  fi
  return 1
}

print_helper_status() {
  if [ -e "$SOURCE_HELPER" ]; then
    printf 'Bundled helper metadata: uid=%s gid=%s mode=%s path=%s\n' \
      "$(stat -c '%u' "$SOURCE_HELPER" 2>/dev/null || printf '?')" \
      "$(stat -c '%g' "$SOURCE_HELPER" 2>/dev/null || printf '?')" \
      "$(stat -c '%a' "$SOURCE_HELPER" 2>/dev/null || printf '?')" \
      "$SOURCE_HELPER"
  else
    printf 'Bundled helper is missing: %s\n' "$SOURCE_HELPER"
  fi
}

install_bundled_helper() {
  is_linux || {
    printf 'Electron SUID sandbox installation is only required on Linux.\n'
    return 0
  }
  [ -f "$SOURCE_HELPER" ] || {
    echo 'Electron chrome-sandbox is missing. Run: make build' >&2
    exit 1
  }
  command -v sudo >/dev/null 2>&1 || {
    echo 'sudo is required to configure the Electron SUID sandbox helper.' >&2
    exit 1
  }

  printf 'Configuring Electron packaged chrome-sandbox as root:root mode 4755...\n'
  sudo chown root:root "$SOURCE_HELPER"
  sudo chmod 4755 "$SOURCE_HELPER"

  if ! bundled_helper_is_secure; then
    echo 'Electron packaged chrome-sandbox is still not configured correctly.' >&2
    print_helper_status >&2
    exit 1
  fi

  # Keep a root-owned byte-identical recovery copy when possible. Chromium/Electron
  # still launches the helper beside its own executable; this copy is diagnostic
  # and can be used to restore the packaged helper after dependency reinstall.
  persistent_dir=$(dirname -- "$PERSISTENT_HELPER")
  sudo install -d -o root -g root -m 0755 "$persistent_dir"
  sudo install -o root -g root -m 4755 "$SOURCE_HELPER" "$PERSISTENT_HELPER"

  printf 'Electron Linux SUID sandbox configured: %s\n' "$SOURCE_HELPER"
}

restore_from_persistent() {
  is_linux || return 0
  if ! persistent_helper_is_current; then
    echo 'No current persistent Electron sandbox copy is available for restore.' >&2
    exit 1
  fi
  command -v sudo >/dev/null 2>&1 || {
    echo 'sudo is required to restore the Electron SUID sandbox helper.' >&2
    exit 1
  }
  sudo install -o root -g root -m 4755 "$PERSISTENT_HELPER" "$SOURCE_HELPER"
  bundled_helper_is_secure || {
    echo 'Failed to restore Electron packaged chrome-sandbox.' >&2
    exit 1
  }
  printf 'Electron Linux SUID sandbox restored: %s\n' "$SOURCE_HELPER"
}

print_failure() {
  cat >&2 <<EOF_FAILURE
Electron Linux sandbox is unavailable.

The chrome-sandbox shipped beside the Electron binary is not root-owned mode 4755,
and unprivileged user namespaces could not be created. Wharness refuses to launch
Electron with --no-sandbox.

Electron packaged helper:
  $SOURCE_HELPER

Configure that exact helper once, then retry:
  make electron-sandbox-install
  make electron-sandbox-check
  make start

Important: npm install/npm ci may recreate node_modules and reset these privileged
permissions. If that happens, run make electron-sandbox-install again.
EOF_FAILURE
  print_helper_status >&2
}

case "${1:-check}" in
  mode)
    if ! resolve_mode; then
      print_failure
      exit 1
    fi
    ;;
  path)
    if bundled_helper_is_secure; then
      printf '%s\n' "$SOURCE_HELPER"
    else
      exit 1
    fi
    ;;
  install)
    install_bundled_helper
    ;;
  restore)
    restore_from_persistent
    ;;
  check)
    if ! mode=$(resolve_mode); then
      print_failure
      exit 1
    fi
    case "$mode" in
      none)
        printf 'Electron sandbox preflight: non-Linux platform; no Linux helper required.\n'
        ;;
      setuid)
        printf 'Electron Linux sandbox: setuid (Electron packaged helper: %s)\n' "$SOURCE_HELPER"
        ;;
      userns)
        printf 'Electron Linux sandbox: user namespaces; invalid packaged SUID helper will be disabled, not the Chromium sandbox.\n'
        ;;
    esac
    ;;
  *)
    echo 'usage: scripts/electron-sandbox.sh [check|mode|path|install|restore]' >&2
    exit 2
    ;;
esac
