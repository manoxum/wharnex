#!/usr/bin/env sh
set -eu

root=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}
config="$root/services/gateway/nginx.conf"

if ! grep -Eq '^proxy_read_timeout 24h;$' "$config"; then
  echo 'gateway must keep long-running Engine execution responses open for 24h' >&2
  exit 1
fi

if ! grep -Eq '^client_body_timeout 30m;$' "$config" || ! grep -Eq '^proxy_send_timeout 30m;$' "$config"; then
  echo 'gateway must allow bounded large artifact uploads for 30m' >&2
  exit 1
fi

echo 'gateway long-running execution and artifact upload timeouts are configured'
