#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
INSTALLER="$ROOT/scripts/up-whx-link-host.sh"
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
fake_unshare="$fixture/unshare"

mkdir "$fixture/path"
ln -s "$(command -v uname)" "$fixture/path/uname"
ln -s "$(command -v tr)" "$fixture/path/tr"
ln -s "$(command -v id)" "$fixture/path/id"
if PATH="$fixture/path" WHARNESS_ROOT="$ROOT" WHARNESS_UP_LINK_HOST_ROOT="$fixture/missing" \
  /bin/sh "$INSTALLER" install >"$fixture/missing.log" 2>&1; then
  echo 'up-whx-link host check accepted a missing pasta executable' >&2
  exit 1
fi
grep -Fq 'sudo apt install passt' "$fixture/missing.log" || {
  echo 'up-whx-link host check did not explain how to install pasta' >&2
  exit 1
}
if WHARNESS_UP_LINK=off PATH="$fixture/path" WHARNESS_ROOT="$ROOT" \
  /bin/sh "$INSTALLER" check >"$fixture/disabled.log" 2>&1; then
  echo 'up-whx-link host check accepted an unisolated Desktop' >&2
  exit 1
fi
grep -Fq 'up-whx-link is required on Linux' "$fixture/disabled.log"

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
