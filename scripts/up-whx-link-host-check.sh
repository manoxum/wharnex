#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
INSTALLER="$ROOT/scripts/up-whx-link-host.sh"
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
fake_unshare="$fixture/unshare"

printf '#!/usr/bin/env sh\nexit 0\n' >"$fake_unshare"
chmod 0755 "$fake_unshare"

run_installer() {
  WHARNESS_ROOT="$ROOT" \
  WHARNESS_UP_LINK_HOST_ROOT="$fixture/root" \
  WHARNESS_UP_LINK_RESTRICTED=1 \
  WHARNESS_UP_LINK_UNSHARE_SOURCE="$fake_unshare" \
  WHARNESS_UP_LINK_APPARMOR_PARSER=/bin/true \
  "$INSTALLER" "$@"
}

run_installer install >/dev/null
run_installer check
helper="$fixture/root/opt/wharness/libexec/wharnex-up-link-unshare"
profile="$fixture/root/etc/apparmor.d/wharnex-up-link"
cmp -s "$fake_unshare" "$helper"
cmp -s "$ROOT/services/desktop/apparmor/wharnex-up-link" "$profile"
grep -Fq 'profile wharnex-up-link /opt/wharness/libexec/wharnex-up-link-unshare' "$profile"
grep -Fq 'userns,' "$profile"

printf '# stale\n' >>"$helper"
if run_installer check >/dev/null 2>&1; then
  echo 'up-whx-link host check accepted a stale helper' >&2
  exit 1
fi
run_installer install >/dev/null
cmp -s "$fake_unshare" "$helper"

printf 'up-whx-link host installer checks passed.\n'
