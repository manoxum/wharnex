#!/usr/bin/env sh
set -eu

# Docker-backed lifecycle commands are usable from the desktop launcher as well
# as from a terminal. Terminal commands retain their explicit-start contract;
# the installed launcher opts in so a first graphical launch can recover a
# stopped host service through the normal system policy/Polkit path.
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

if [ "${WHARNESS_LAUNCHER_AUTOSTART_DOCKER:-}" = 1 ]; then
  echo 'Docker is stopped. Starting docker.service for the Wharnex launcher…' >&2
  if ! systemctl start docker.service; then
    echo 'Wharnex could not start docker.service. Approve the system prompt if one is shown, then retry.' >&2
    exit 1
  fi
  if systemctl is-active --quiet docker.service 2>/dev/null; then
    exit 0
  fi
  echo 'docker.service did not become active after the Wharnex launcher started it.' >&2
  exit 1
fi

echo 'Docker is stopped. Start docker.service explicitly, then retry.' >&2
exit 1
