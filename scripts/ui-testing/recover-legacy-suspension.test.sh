#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Split immediately before assertions so tests always execute the shipped query.
awk '/^DO \$\$ BEGIN/{exit} {print}' "$script_dir/recover-legacy-suspension.test.sql"
cat "$script_dir/recover-legacy-suspension.sql"
awk 'found || /^DO \$\$ BEGIN/{found=1; print}' "$script_dir/recover-legacy-suspension.test.sql"
