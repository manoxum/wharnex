#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
fixture="$temporary/repo"
stamp="$temporary/source-success.sha256"

mkdir -p "$fixture/schemas" "$fixture/scripts"
cp "$ROOT/scripts/source-fingerprint.sh" "$fixture/scripts/source-fingerprint.sh"
chmod 0755 "$fixture/scripts/source-fingerprint.sh"
printf 'first source version\n' >"$fixture/Makefile"
printf '{"version":1}\n' >"$fixture/schemas/execution-plan.schema.json"

if WHARNESS_ROOT="$fixture" WHARNESS_SOURCE_FINGERPRINT_STAMP="$stamp" "$fixture/scripts/source-fingerprint.sh" matches; then
  echo 'source fingerprint regression: a missing success stamp must not match' >&2
  exit 1
fi

WHARNESS_ROOT="$fixture" WHARNESS_SOURCE_FINGERPRINT_STAMP="$stamp" "$fixture/scripts/source-fingerprint.sh" write
WHARNESS_ROOT="$fixture" WHARNESS_SOURCE_FINGERPRINT_STAMP="$stamp" "$fixture/scripts/source-fingerprint.sh" matches

# Preserve the timestamp to prove invalidation comes from bytes, not mtimes.
touch -r "$fixture/Makefile" "$fixture/Makefile.before"
printf 'second source version\n' >"$fixture/Makefile"
touch -r "$fixture/Makefile.before" "$fixture/Makefile"
if WHARNESS_ROOT="$fixture" WHARNESS_SOURCE_FINGERPRINT_STAMP="$stamp" "$fixture/scripts/source-fingerprint.sh" matches; then
  echo 'source fingerprint regression: changed source bytes must invalidate a preserved mtime' >&2
  exit 1
fi

WHARNESS_ROOT="$fixture" WHARNESS_SOURCE_FINGERPRINT_STAMP="$stamp" "$fixture/scripts/source-fingerprint.sh" write
printf '{"version":2}\n' >"$fixture/schemas/execution-plan.schema.json"
if WHARNESS_ROOT="$fixture" WHARNESS_SOURCE_FINGERPRINT_STAMP="$stamp" "$fixture/scripts/source-fingerprint.sh" matches; then
  echo 'source fingerprint regression: a protocol schema change must invalidate the launcher build stamp' >&2
  exit 1
fi

printf 'source fingerprint checks passed.\n'
