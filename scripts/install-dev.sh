#!/usr/bin/env sh
set -eu

# Installs a per-checkout, per-instance launcher without requiring root access.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"

instance=${WHARNESS_INSTANCE_ID:-}
[ -n "$instance" ] || instance=$(basename "$ROOT")
instance=$(printf '%s' "$instance" | tr '\n\r' '  ' | sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//')
[ -n "$instance" ] || instance=wharnex
# Shared with start.sh, so a plain `make start` resolves the exact same
# profile directory as the installed launcher instead of Electron's own
# default profile. Sourced from this script's own real location (not $ROOT,
# which tests override to a fixture directory that only stages a few files).
. "$SCRIPT_DIR/desktop-profile.sh"
slug=$WHARNESS_DESKTOP_SLUG
escaped_root=$(printf '%s' "$ROOT" | sed "s/'/'\\\\''/g")
escaped_instance=$(printf '%s' "$instance" | sed "s/'/'\\\\''/g")
escaped_profile=$(printf '%s' "$WHARNESS_DESKTOP_USER_DATA_DIR" | sed "s/'/'\\\\''/g")

bin_dir="$ROOT/dist/bin"
launcher="$bin_dir/wharnex-$slug"
# A terminal opened by a sandboxed IDE (notably VS Code Snap) inherits that
# IDE's private XDG_DATA_HOME. GNOME does not index .desktop files there.
# Development launchers are user-facing OS integrations, so install them in
# the canonical host user location. An explicit Wharnex override remains
# available for test or portable environments.
data_home=${WHARNESS_DESKTOP_DATA_HOME:-"$HOME/.local/share"}
icon_dir="$data_home/icons/hicolor/scalable/apps"
icon_raster_dir="$data_home/icons/hicolor/256x256/apps"
application_dir="$data_home/applications"
icon_name="wharnex-$slug"
icon_path="$icon_dir/$icon_name.svg"
icon_raster_path="$icon_raster_dir/$icon_name.png"
desktop_path="$application_dir/$icon_name.desktop"
desktop_icon="$icon_path"

mkdir -p "$bin_dir" "$icon_dir" "$icon_raster_dir" "$application_dir"
install -m 0644 "$ROOT/services/frontend/public/favicon.svg" "$icon_path"
# GNOME's application overview is more reliable with a concrete raster icon
# than with a newly-installed SVG name whose theme cache may be stale, and the
# Desktop tray prefers that same raster over anything it can generate. It used
# to be produced by ImageMagick `convert`, so on a host without it the PNG was
# simply absent; this rasterizes the same mark with the Node standard library.
# Resolved from this script's own location, not $ROOT, for the same reason
# desktop-profile.sh is.
if node "$SCRIPT_DIR/../services/desktop/icon/write-desktop-icon.mjs" "$icon_raster_path" 256; then
  desktop_icon="$icon_raster_path"
fi

tmp_launcher=$(mktemp "$bin_dir/.wharnex-launcher.XXXXXX")
cat >"$tmp_launcher" <<EOF
#!/usr/bin/env sh
set -eu
cd '$escaped_root'
# The dedicated launcher presents a splash, then uses a durable source
# fingerprint to decide whether the running Desktop needs a build/restart.
export WHARNESS_INSTANCE_ID='$escaped_instance'
export WHARNESS_DESKTOP_USER_DATA_DIR='$escaped_profile'
exec '$escaped_root/scripts/launcher.sh'
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
Icon=$desktop_icon
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
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$data_home/icons/hicolor" >/dev/null 2>&1 || true
fi

printf 'Wharnex development launcher installed.\n'
printf '  launcher: %s\n' "$launcher"
printf '  shortcut: Wharnex - %s\n' "$instance"
printf '  desktop:  %s\n' "$desktop_path"
