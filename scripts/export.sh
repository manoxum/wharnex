#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:?project root is required}"
EXPORT_ARCHIVE="${2:?export archive path is required}"

if [[ -d "$EXPORT_ARCHIVE" ]]; then
  echo "export archive path is a directory: $EXPORT_ARCHIVE" >&2
  exit 1
fi

mkdir -p "$(dirname "$EXPORT_ARCHIVE")"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
archive="$tmp_dir/wharness.zip"

(
  cd "$ROOT_DIR/services/backend"
  go run ./cmd/exportmeta -root "$ROOT_DIR" -kind make-export -output "$tmp_dir/EXPORTS.md"
)

excludes=(
  '.git/*' '.env' 'EXPORTS.md' 'EXPORT_INDEX.md'
  '.harness/*' '*/.harness/*' '.idea/*' '*/.idea/*'
  'node_modules/*' '*/node_modules/*' 'dist/*' '*/dist/*'
  'build/*' '*/build/*' 'coverage/*' '*/coverage/*'
  '.next/*' '*/.next/*' '.vite/*' '*/.vite/*' 'vendor/*' '*/vendor/*'
  'playwright-report/*' '*/playwright-report/*' 'test-results/*' '*/test-results/*'
  '.cache/*' '*/.cache/*' '__pycache__/*' '*/__pycache__/*'
  '*.tsbuildinfo' '*.pyc' '*.log' '.DS_Store' '*.orig' '*/.orig' '*.rej' '*/.rej'
  '*.pem' '*.key' '*.p12' '*.pfx' 'id_rsa' '*/id_rsa' 'id_ed25519' '*/id_ed25519'
  'credentials.json' '*/credentials.json' 'secrets/*' '*/secrets/*'
  '*.db' '*.sqlite' '*.sqlite3' '*.dump' '*.sql.gz'
  'kernl-context-*' '*/kernl-context-*' 'wharness-input-*' '*/wharness-input-*'
  'wharness-bundle-*' '*/wharness-bundle-*'
)

(
  cd "$ROOT_DIR"
  zip -q -y -r "$archive" . -x "${excludes[@]}"
)

source_entries="$(unzip -Z1 "$archive" | awk 'NF {count++} END {print count+0}')"
source_bytes="$(unzip -l "$archive" | awk 'END {print $1+0}')"
{
  printf '# Wharness Export Index\n\n'
  printf -- '- Schema: `wharness.export-index/v1`\n'
  printf -- '- Source entries before synthetic metadata: `%s`\n' "$source_entries"
  printf -- '- Source bytes before ZIP compression: `%s`\n' "$source_bytes"
  printf -- '- Purpose: compact source/diagnostic snapshot for offline analysis; build caches, runtime state and secrets are omitted while repository patch history is retained.\n\n'
  printf '## Exclusion policy\n\n'
  printf -- '- VCS/IDE/runtime internals: `.git`, `.idea`, every `.harness` directory, logs and caches.\n'
  printf -- '- Generated/dependency trees: `node_modules`, `dist`, `build`, coverage, Vite/Next/test output and Python caches.\n'
  printf -- '- Historical patch payloads under `patches/` are retained as useful distribution/debugging context.\n'
  printf -- '- Generated transport payloads remain excluded: `kernl-context-*`, `wharness-input-*`, `wharness-bundle-*`, `*.orig`, `*.rej`.\n'
  printf -- '- Secret-like/private database material: `.env`, private keys, credentials/secrets, DB/dump files.\n\n'
  printf '## Top-level inventory\n\n```text\n'
  unzip -Z1 "$archive" | awk -F/ 'NF {count[$1]++} END {for (name in count) printf "%6d %s\n", count[name], name}' | sort -nr
  printf '```\n\n## Largest included entries\n\n```text\n'
  unzip -l "$archive" | awk 'NR>3 && $1 ~ /^[0-9]+$/ {size=$1; $1=$2=$3=""; sub(/^ +/, ""); if ($0 != "") printf "%12d  %s\n", size, $0}' | sort -nr | awk 'NR <= 15'
  printf '```\n'
} > "$tmp_dir/EXPORT_INDEX.md"

(
  cd "$tmp_dir"
  zip -q wharness.zip EXPORTS.md EXPORT_INDEX.md
)

mv -f "$archive" "$EXPORT_ARCHIVE"
test -s "$EXPORT_ARCHIVE"
unzip -tqq "$EXPORT_ARCHIVE"

archive_bytes="$(wc -c < "$EXPORT_ARCHIVE" | tr -d ' ')"
archive_human="$(du -h "$EXPORT_ARCHIVE" | awk '{print $1}')"
archive_entries="$(unzip -Z1 "$EXPORT_ARCHIVE" | awk 'NF {count++} END {print count+0}')"
archive_patch_entries="$(unzip -Z1 "$EXPORT_ARCHIVE" | awk '/^patches\// && $0 !~ /\/$/ {count++} END {print count+0}')"
archive_sha256="$(sha256sum "$EXPORT_ARCHIVE" | awk '{print $1}')"

printf 'Project exported to %s\n' "$EXPORT_ARCHIVE"
printf '  size: %s (%s bytes)\n' "$archive_human" "$archive_bytes"
printf '  entries: %s\n' "$archive_entries"
printf '  patches: %s files\n' "$archive_patch_entries"
printf '  sha256: %s\n' "$archive_sha256"
printf '  metadata: EXPORTS.md, EXPORT_INDEX.md\n'
