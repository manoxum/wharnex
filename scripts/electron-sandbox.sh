#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
RUNTIME="$ROOT/scripts/electron-runtime.sh"

case "${1:-check}" in
  check|mode|path|install|status)
    exec "$RUNTIME" "${1:-check}"
    ;;
  restore)
    echo 'electron-sandbox restore is deprecated; reinstalling the immutable Electron runtime.' >&2
    exec "$RUNTIME" install
    ;;
  *)
    echo 'usage: scripts/electron-sandbox.sh [check|mode|path|install|restore|status]' >&2
    exit 2
    ;;
esac
