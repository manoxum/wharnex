#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"
ACTION=${1:-check}
HOST_ROOT=${WHARNESS_UP_LINK_HOST_ROOT:-}
HELPER=/opt/wharness/libexec/wharnex-up-link-unshare
PROFILE=/etc/apparmor.d/wharnex-up-link
PROFILE_SOURCE="$ROOT/services/desktop/apparmor/wharnex-up-link"
UNSHARE_SOURCE=${WHARNESS_UP_LINK_UNSHARE_SOURCE:-/usr/bin/unshare}
PARSER=${WHARNESS_UP_LINK_APPARMOR_PARSER:-/usr/sbin/apparmor_parser}
INSTALL_UID=${WHARNESS_UP_LINK_INSTALL_UID:-$(id -u)}

host_path() {
  printf '%s%s\n' "$HOST_ROOT" "$1"
}

helper_target=$(host_path "$HELPER")
profile_target=$(host_path "$PROFILE")

is_linux() {
  [ "$(uname -s 2>/dev/null || printf unknown)" = Linux ]
}

require_runtime_tools() {
  is_linux || return 0
  mode=$(printf '%s' "${WHARNESS_UP_LINK:-required}" | tr '[:upper:]' '[:lower:]')
  case "$mode" in auto|off|0|false|disabled) return 0 ;; esac
  if ! command -v pasta >/dev/null 2>&1; then
    echo 'up-whx-link requires pasta. Install passt (Debian/Ubuntu 24.04+: sudo apt install passt), then retry.' >&2
    return 1
  fi
  for tool in ip mount; do
    command -v "$tool" >/dev/null 2>&1 || {
      printf 'up-whx-link requires %s in PATH.\n' "$tool" >&2
      return 1
    }
  done
}

restriction_enabled() {
  case "${WHARNESS_UP_LINK_RESTRICTED:-}" in
    1|true) return 0 ;;
    0|false) return 1 ;;
  esac
  [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] &&
    [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1 ]
}

root_run() {
  if [ -n "$HOST_ROOT" ] || [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif [ "${WHARNESS_UP_LINK_PRIVILEGE_TOOL:-auto}" = pkexec ]; then
    pkexec "$@"
  elif [ "${WHARNESS_UP_LINK_PRIVILEGE_TOOL:-auto}" = sudo ] || [ -t 0 ]; then
    sudo "$@"
  elif command -v pkexec >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    pkexec "$@"
  else
    sudo "$@"
  fi
}

safe_mode() {
  mode=$(stat -c '%a' "$1" 2>/dev/null || printf 777)
  [ "$((0$mode & 0022))" -eq 0 ]
}

installed_files_valid() {
  [ -f "$helper_target" ] && [ ! -L "$helper_target" ] && [ -x "$helper_target" ] || return 1
  [ -f "$profile_target" ] && [ ! -L "$profile_target" ] || return 1
  cmp -s "$UNSHARE_SOURCE" "$helper_target" || return 1
  cmp -s "$PROFILE_SOURCE" "$profile_target" || return 1
  safe_mode "$helper_target" && safe_mode "$profile_target" || return 1
  if [ -z "$HOST_ROOT" ]; then
    [ "$(stat -c '%u' "$helper_target")" -eq 0 ] || return 1
    [ "$(stat -c '%u' "$profile_target")" -eq 0 ] || return 1
  fi
}

namespace_probe() {
  if restriction_enabled; then
    [ -n "$HOST_ROOT" ] && return 0
    command -v aa-exec >/dev/null 2>&1 || return 1
    aa-exec -p unconfined -- sh -c \
      'exec "$1" --user --map-root-user --net --mount --propagation slave true' \
      up-whx-link-probe "$helper_target" >/dev/null 2>&1
  else
    "$UNSHARE_SOURCE" --user --map-root-user --net --mount --propagation slave true >/dev/null 2>&1
  fi
}

check_installation() {
  is_linux || return 0
  if restriction_enabled; then
    installed_files_valid && namespace_probe
  else
    namespace_probe
  fi
}

install_profile() {
  is_linux || { printf 'up-whx-link host setup: not required on this platform\n'; return 0; }
  require_runtime_tools || return 1
  if ! restriction_enabled; then
    namespace_probe || { echo 'Unprivileged network namespaces are unavailable.' >&2; return 1; }
    printf 'up-whx-link host setup: kernel does not require an AppArmor exception\n'
    return 0
  fi
  if check_installation; then
    printf 'up-whx-link host setup: AppArmor profile and helper are ready\n'
    return 0
  fi
  [ -x "$UNSHARE_SOURCE" ] || { echo "Missing unshare executable: $UNSHARE_SOURCE" >&2; return 1; }
  [ -f "$PROFILE_SOURCE" ] || { echo "Missing AppArmor profile: $PROFILE_SOURCE" >&2; return 1; }
  [ -x "$PARSER" ] || { echo 'apparmor_parser is required for up-whx-link.' >&2; return 1; }
  if [ -z "$HOST_ROOT" ]; then
    command -v sudo >/dev/null 2>&1 || { echo 'sudo is required to install the up-whx-link AppArmor profile.' >&2; return 1; }
    command -v setfacl >/dev/null 2>&1 || { echo 'setfacl is required to restrict the up-whx-link helper.' >&2; return 1; }
    "$PARSER" -Q -K "$PROFILE_SOURCE" >/dev/null
  fi
  root_run install -d -m 0755 "$(dirname "$helper_target")" "$(dirname "$profile_target")"
  if [ -n "$HOST_ROOT" ]; then
    root_run install -m 0755 "$UNSHARE_SOURCE" "$helper_target"
    root_run install -m 0644 "$PROFILE_SOURCE" "$profile_target"
  else
    root_run install -o root -g root -m 0700 "$UNSHARE_SOURCE" "$helper_target"
    root_run setfacl -m "u:${INSTALL_UID}:rx,m::rx" "$helper_target"
    root_run install -o root -g root -m 0644 "$PROFILE_SOURCE" "$profile_target"
    root_run "$PARSER" -r "$profile_target"
  fi
  check_installation || { echo 'up-whx-link host setup verification failed.' >&2; return 1; }
  printf 'up-whx-link host setup: installed and verified for uid %s\n' "$INSTALL_UID"
}

show_status() {
  if ! is_linux; then printf 'up-whx-link host setup: not required\n'; return; fi
  if restriction_enabled; then printf 'AppArmor userns restriction: enabled\n'; else printf 'AppArmor userns restriction: disabled/unavailable\n'; fi
  if installed_files_valid; then printf 'Dedicated unshare helper: valid\n'; else printf 'Dedicated unshare helper: unavailable or stale\n'; fi
  if namespace_probe; then printf 'Network namespace probe: ready\n'; else printf 'Network namespace probe: blocked\n'; fi
}

case "$ACTION" in
  check) require_runtime_tools && check_installation ;;
  install) install_profile ;;
  status) show_status ;;
  *) echo 'usage: scripts/up-whx-link-host.sh [check|install|status]' >&2; exit 2 ;;
esac
