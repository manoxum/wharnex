#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
fixture_root="$tmp_dir/repo"
fixture_home="$tmp_dir/home"
fixture_snap_data="$tmp_dir/snap/code/263/.local/share"

mkdir -p "$fixture_root/services/frontend/public"
cp "$ROOT/services/frontend/public/favicon.svg" "$fixture_root/services/frontend/public/favicon.svg"

HOME="$fixture_home" \
XDG_DATA_HOME="$fixture_snap_data" \
WHARNESS_ROOT="$fixture_root" \
WHARNESS_INSTANCE_ID='snap-test' \
"$ROOT/scripts/install-dev.sh" >/dev/null

desktop="$fixture_home/.local/share/applications/wharnex-snap-test.desktop"
icon="$fixture_home/.local/share/icons/hicolor/scalable/apps/wharnex-snap-test.svg"
launcher="$fixture_root/dist/bin/wharnex-snap-test"

test -x "$launcher"
test -f "$desktop"
test -f "$icon"
test ! -e "$fixture_snap_data/applications/wharnex-snap-test.desktop"
grep -Fqx 'Name=Wharnex - snap-test' "$desktop"
grep -Fqx "Exec=$launcher" "$desktop"
grep -Fqx 'Icon=wharnex-snap-test' "$desktop"
grep -Fqx 'StartupWMClass=wharness-desktop' "$desktop"
grep -Fqx "export WHARNESS_DESKTOP_USER_DATA_DIR='$fixture_home/.config/wharnex-snap-test'" "$launcher"
grep -Fqx 'exec make start' "$launcher"
test -x "$desktop"

mkdir -p "$fixture_home/.config/wharness-desktop"
HOME="$fixture_home" \
WHARNESS_ROOT="$fixture_root" \
WHARNESS_INSTANCE_ID='main' \
"$ROOT/scripts/install-dev.sh" >/dev/null
grep -Fqx "export WHARNESS_DESKTOP_USER_DATA_DIR='$fixture_home/.config/wharness-desktop'" "$fixture_root/dist/bin/wharnex-main"

if command -v desktop-file-validate >/dev/null 2>&1; then desktop-file-validate "$desktop"; fi
printf 'install-dev launcher checks passed.\n'
