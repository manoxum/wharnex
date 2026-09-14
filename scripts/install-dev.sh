#!/usr/bin/env sh
set -eu

# Installs a per-checkout, per-instance launcher without requiring root access.
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"

instance=${WHARNESS_INSTANCE_ID:-}
[ -n "$instance" ] || instance=$(basename "$ROOT")
instance=$(printf '%s' "$instance" | tr '\n\r' '  ' | sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//')
[ -n "$instance" ] || instance=wharnex
slug=$(printf '%s' "$instance" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$slug" ] || slug=wharnex
escaped_root=$(printf '%s' "$ROOT" | sed "s/'/'\\\\''/g")
escaped_instance=$(printf '%s' "$instance" | sed "s/'/'\\\\''/g")
profile_root=${WHARNESS_DESKTOP_PROFILE_ROOT:-"$HOME/.config"}
profile_dir="$profile_root/wharnex-$slug"
# `wharness-desktop` was the profile used before development launchers gained
# per-instance identity. Reusing it for the main instance preserves existing
# project bindings, local chats and the authenticated browser partition instead
# of silently opening an empty workspace in a new directory.
if [ "$slug" = main ] && [ -d "$profile_root/wharness-desktop" ]; then
  profile_dir="$profile_root/wharness-desktop"
fi
escaped_profile=$(printf '%s' "$profile_dir" | sed "s/'/'\\\\''/g")

bin_dir="$ROOT/dist/bin"
launcher="$bin_dir/wharnex-$slug"
# A terminal opened by a sandboxed IDE (notably VS Code Snap) inherits that
# IDE's private XDG_DATA_HOME. GNOME does not index .desktop files there.
# Development launchers are user-facing OS integrations, so install them in
# the canonical host user location. An explicit Wharnex override remains
# available for test or portable environments.
data_home=${WHARNESS_DESKTOP_DATA_HOME:-"$HOME/.local/share"}
icon_dir="$data_home/icons/hicolor/scalable/apps"
application_dir="$data_home/applications"
icon_name="wharnex-$slug"
icon_path="$icon_dir/$icon_name.svg"
desktop_path="$application_dir/$icon_name.desktop"

mkdir -p "$bin_dir" "$icon_dir" "$application_dir"
install -m 0644 "$ROOT/services/frontend/public/favicon.svg" "$icon_path"

tmp_launcher=$(mktemp "$bin_dir/.wharnex-launcher.XXXXXX")
cat >"$tmp_launcher" <<EOF
#!/usr/bin/env sh
set -eu
cd '$escaped_root'
# The start target rebuilds only if the recorded artifacts are absent or stale.
# A normal shortcut activation therefore reaches Electron without a redundant
# Docker image build.
export WHARNESS_INSTANCE_ID='$escaped_instance'
export WHARNESS_DESKTOP_USER_DATA_DIR='$escaped_profile'
exec make start
EOF
chmod 0755 "$tmp_launcher"
mv -f "$tmp_launcher" "$launcher"

tmp_desktop=$(mktemp "$application_dir/.wharnex-desktop.XXXXXX")
cat >"$tmp_desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Wharnex - $instance
Comment=Wharnex development instance $instance
Exec=$launcher
Icon=$icon_name
Terminal=false
Categories=Development;IDE;
# Electron exposes the package's Linux WM_CLASS, not the app-level display
# name or Chromium's --class hint. This exact value lets GNOME associate a
# development launch with this desktop entry rather than its parent IDE.
StartupWMClass=wharness-desktop
StartupNotify=true
EOF
chmod 0755 "$tmp_desktop"
mv -f "$tmp_desktop" "$desktop_path"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$application_dir" >/dev/null 2>&1 || true
fi

printf 'Wharnex development launcher installed.\n'
printf '  launcher: %s\n' "$launcher"
printf '  shortcut: Wharnex - %s\n' "$instance"
printf '  desktop:  %s\n' "$desktop_path"
