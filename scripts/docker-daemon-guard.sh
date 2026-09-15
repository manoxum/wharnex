#!/usr/bin/env sh
set -eu

# Docker-backed lifecycle commands are usable from the desktop launcher as well
# as from a terminal. Start the service explicitly before any Docker command.
if [ "$(uname -s 2>/dev/null || printf unknown)" != "Linux" ]; then
  exit 0
fi

# An explicit Docker endpoint is operator-owned and is not the host systemd
# socket that this guard is intended to protect.
if [ -n "${DOCKER_HOST:-}" ]; then
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  exit 0
fi

if systemctl is-active --quiet docker.service 2>/dev/null; then
  exit 0
fi

printf 'Docker is stopped; starting docker.service...\n' >&2
if [ -t 0 ] || [ -t 1 ]; then
  # Launched from a terminal: sudo can read the password itself.
  sudo systemctl start docker.service
elif command -v pkexec >/dev/null 2>&1; then
  # Launched from the desktop launcher with no controlling terminal: sudo
  # cannot read a password, so ask Polkit for a graphical prompt instead.
  pkexec systemctl start docker.service
else
  echo 'Docker service is stopped and no terminal or pkexec is available to authorize starting it.' >&2
  exit 1
fi

if ! systemctl is-active --quiet docker.service 2>/dev/null; then
  echo 'Docker service did not become active after start request.' >&2
  exit 1
fi

exit 0
