#!/usr/bin/env sh
set -eu

root=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}
config="$root/services/gateway/nginx.conf"

if ! grep -Eq '^proxy_read_timeout 24h;$' "$config"; then
  echo 'gateway must keep long-running Engine execution responses open for 24h' >&2
  exit 1
fi

echo 'gateway long-running execution timeout is configured'
