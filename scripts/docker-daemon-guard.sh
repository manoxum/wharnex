#!/usr/bin/env sh
set -eu

# Docker socket activation is useful for general CLI ergonomics, but it is unsafe
# for Wharnex to trigger implicitly: starting dockerd can recreate bridges,
# routes, NAT rules and veth devices while Electron/Chromium has live requests.
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

if systemctl is-active --quiet docker.socket 2>/dev/null; then
  cat >&2 <<'MSG'
Wharnex refused to socket-activate Docker.

docker.socket is active but docker.service is stopped. Invoking Docker here can
start dockerd and recreate host bridges/routes/veth interfaces, which may cause
Electron/Chromium ERR_NETWORK_CHANGED failures.

Start Docker explicitly when you intend to use the Protected runner, then retry:
  sudo systemctl start docker.service
MSG
  exit 1
fi

exit 0
