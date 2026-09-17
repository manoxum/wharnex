#!/usr/bin/env sh
set -eu

# Resolves the canonical per-checkout, per-instance Electron profile
# directory. Sourced by both install-dev.sh (which installs the desktop
# launcher) and start.sh (which `make start` runs directly), so a plain
# `make start` run from a terminal opens the exact same authenticated
# Chromium profile as the installed launcher/desktop shortcut instead of
# falling back to Electron's own default profile directory.
#
# Requires ROOT to already be set by the caller. Sets WHARNESS_DESKTOP_SLUG
# and, unless WHARNESS_DESKTOP_USER_DATA_DIR is already set in the
# environment, WHARNESS_DESKTOP_USER_DATA_DIR.

wharness_desktop_instance=${WHARNESS_INSTANCE_ID:-}
[ -n "$wharness_desktop_instance" ] || wharness_desktop_instance=$(basename "$ROOT")
wharness_desktop_instance=$(printf '%s' "$wharness_desktop_instance" | tr '\n\r' '  ' | sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//')
[ -n "$wharness_desktop_instance" ] || wharness_desktop_instance=wharnex
WHARNESS_DESKTOP_SLUG=$(printf '%s' "$wharness_desktop_instance" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$WHARNESS_DESKTOP_SLUG" ] || WHARNESS_DESKTOP_SLUG=wharnex

if [ -z "${WHARNESS_DESKTOP_USER_DATA_DIR:-}" ]; then
  wharness_desktop_profile_root=${WHARNESS_DESKTOP_PROFILE_ROOT:-"$HOME/.config"}
  WHARNESS_DESKTOP_USER_DATA_DIR="$wharness_desktop_profile_root/wharnex-$WHARNESS_DESKTOP_SLUG"
  # `wharness-desktop` was the profile used before development launchers
  # gained per-instance identity. Reusing it for the main instance preserves
  # existing project bindings, local chats and the authenticated browser
  # partition instead of silently opening an empty workspace in a new
  # directory.
  if [ "$WHARNESS_DESKTOP_SLUG" = main ] && [ -d "$wharness_desktop_profile_root/wharness-desktop" ]; then
    WHARNESS_DESKTOP_USER_DATA_DIR="$wharness_desktop_profile_root/wharness-desktop"
  fi
fi

unset wharness_desktop_instance wharness_desktop_profile_root
