#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
make backend-check
make desktop-check
if [ -n "${WHARNESS_TEST_DATABASE_URL:-}" ]; then
  (cd services/backend && go test ./internal/dbidentity -count=1)
elif [ "${WHARNEX_REQUIRE_DATABASE_GATE:-0}" = 1 ]; then
  echo "database identity gate requires WHARNESS_TEST_DATABASE_URL" >&2
  exit 1
else
  echo "WHARNESS_TEST_DATABASE_URL not configured; skipping database identity integration gate" >&2
fi
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
