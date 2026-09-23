#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
make backend-check
make desktop-check
if [ -d services/frontend/node_modules ]; then
  make frontend-check
else
  echo "frontend dependencies not installed; skipping frontend gates" >&2
fi

if [ -d services/webapp/node_modules ]; then
  make webapp-check
else
  echo "webapp dependencies not installed; skipping webapp gates" >&2
fi
