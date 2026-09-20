#!/usr/bin/env sh
set -eu

# Fingerprint precisely the checkout inputs that can change the locally running
# Desktop, rather than relying on mtimes (which are not reliable after a Git
# checkout, archive extraction, or clock adjustment). Keep protocol schemas
# and root operational configuration here too: they are source inputs, not
# disposable documentation, and a launcher must never treat their revision as
# already built.
ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
STAMP=${WHARNESS_SOURCE_FINGERPRINT_STAMP:-$ROOT/.harness/source-success.sha256}
ACTION=${1:-current}

hash_inputs() {
  {
    for file in \
      "$ROOT/.env" \
      "$ROOT/.harnessignore" \
      "$ROOT/Makefile" \
      "$ROOT/VERSION" \
      "$ROOT/compose.yml" \
      "$ROOT/whaness.yml"
    do
      [ -f "$file" ] && sha256sum "$file"
    done
    for directory in "$ROOT/schemas" "$ROOT/scripts" "$ROOT/docker" "$ROOT/services/backend" "$ROOT/services/tunnel" "$ROOT/services/frontend" "$ROOT/services/desktop"; do
      [ -d "$directory" ] || continue
      find "$directory" -type f \
        ! -path '*/node_modules/*' \
        ! -path '*/dist/*' \
        ! -path '*/coverage/*' \
        ! -name '*.log' \
        ! -name '*.tsbuildinfo' \
        -print0
    done | LC_ALL=C sort -z | xargs -0 -r sha256sum
  } | sha256sum | awk '{print $1}'
}

current=$(hash_inputs)

case "$ACTION" in
  current)
    printf '%s\n' "$current"
    ;;
  matches)
    [ -f "$STAMP" ] && [ "$(cat "$STAMP" 2>/dev/null || true)" = "$current" ]
    ;;
  write)
    mkdir -p "$(dirname "$STAMP")"
    temporary="$STAMP.tmp.$$"
    umask 077
    printf '%s\n' "$current" >"$temporary"
    mv -f "$temporary" "$STAMP"
    ;;
  *)
    echo "usage: $0 [current|matches|write]" >&2
    exit 2
    ;;
esac
