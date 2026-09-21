#!/usr/bin/env sh
# Reports new implementation files over the 200-line cap defined in
# SoT/CODE_QUALITY.md (adr/ADR-0066). Not wired into scripts/quality-gates.sh
# or CI yet by explicit choice; run manually or via `make file-size-check`.
set -eu
cd "$(dirname "$0")/.."

LIMIT=200
BASE=${1:-$(git merge-base HEAD main 2>/dev/null || echo main)}

EXT_PATTERN='\.(go|ts|tsx|js|jsx|mjs|cjs|css|scss|html)$'
EXEMPT_PATTERN='(^|/)(node_modules|dist|build|vendor|testdata|fixtures)(/|$)|\.min\.|_pb\.go$|\.pb\.go$|^services/frontend/src/generated/|package-lock\.json$|go\.sum$|go\.mod$'

list_candidates() {
  {
    git diff --name-status "$BASE"...HEAD -- 2>/dev/null | awk '$1=="A"{ $1=""; sub(/^\t/,""); print }'
    git diff --name-status --cached -- 2>/dev/null | awk '$1=="A"{ $1=""; sub(/^\t/,""); print }'
    git status --porcelain 2>/dev/null | awk '$1=="??"{ $1=""; sub(/^ /,""); print }'
  } | sort -u
}

violations=0
checked=0

for file in $(list_candidates); do
  [ -f "$file" ] || continue
  echo "$file" | grep -qE "$EXT_PATTERN" || continue
  echo "$file" | grep -qE "$EXEMPT_PATTERN" && continue

  checked=$((checked + 1))
  lines=$(wc -l < "$file" | tr -d ' ')
  if [ "$lines" -gt "$LIMIT" ]; then
    violations=$((violations + 1))
    echo "VIOLATION: $file has $lines lines (limit $LIMIT)"
  fi
done

echo "checked $checked new implementation file(s) against a ${LIMIT}-line cap (base: $BASE)"

if [ "$violations" -gt 0 ]; then
  echo "$violations file(s) exceed the cap. See SoT/CODE_QUALITY.md." >&2
  exit 1
fi

exit 0
