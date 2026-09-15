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

echo 'Docker is stopped. Start docker.service explicitly, then retry.' >&2
exit 1
