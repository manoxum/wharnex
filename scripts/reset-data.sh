#!/usr/bin/env sh
# Destroys this checkout's runtime data: every Wharnex table in PostgreSQL,
# every object in the artifact bucket, and the Electron userData.
#
# All work runs inside the containers that own the data (psql in the database
# container, mc inside the minio container), so this never depends on a client
# being installed on the operator's host — see the host-independence invariant
# in AGENTS.md section 11.
#
# The ChatGPT browser partition is preserved by default: it holds an
# authenticated session that is expensive to rebuild and is not Wharnex state.
# Pass --include-browser-session to destroy that too.
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
KEEP_BROWSER_SESSION=1
BACKUP=1

for arg in "$@"; do
  case "$arg" in
    --include-browser-session) KEEP_BROWSER_SESSION=0 ;;
    --no-backup) BACKUP=0 ;;
    *) printf 'reset-data: unsupported option %s\n' "$arg" >&2; exit 2 ;;
  esac
done

# shellcheck source=/dev/null
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"

PROJECT=${WHARNESS_COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}
DB_CONTAINER="${PROJECT}-database-1"
MINIO_CONTAINER="${PROJECT}-minio-1"
USER_DATA=${WHARNESS_DESKTOP_USER_DATA:-$HOME/.config/wharness-desktop}
BUCKET=${HARNESS_ARTIFACT_BUCKET:-wharness-artifacts}

running() { docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null | grep -q true; }

printf 'Wharnex data reset for %s\n' "$ROOT"
printf '  database container : %s\n' "$DB_CONTAINER"
printf '  artifact container : %s (bucket %s)\n' "$MINIO_CONTAINER" "$BUCKET"
printf '  desktop user data  : %s\n' "$USER_DATA"
if [ "$KEEP_BROWSER_SESSION" -eq 1 ]; then
  printf '  ChatGPT session    : preserved\n'
else
  printf '  ChatGPT session    : DESTROYED\n'
fi

# A destructive, irreversible action gets an explicit typed confirmation rather
# than a yes/no keypress, so it cannot happen by reflex or by a stray Enter.
if [ "${WHARNESS_RESET_CONFIRM:-}" != "RESET WHARNESS" ]; then
  printf '\nThis destroys every session, artifact and local chat in this checkout.\n'
  printf 'Type exactly: RESET WHARNESS\n> '
  read -r answer
  [ "$answer" = "RESET WHARNESS" ] || { printf 'reset-data: confirmation mismatch; nothing was changed.\n' >&2; exit 1; }
fi

if [ "$BACKUP" -eq 1 ] && running "$DB_CONTAINER"; then
  backup_dir="$HOME/wharnex-reset-backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup_dir"
  printf 'Backing up PostgreSQL to %s/postgres.sql.gz\n' "$backup_dir"
  docker exec "$DB_CONTAINER" pg_dump -U wharness -d wharness | gzip > "$backup_dir/postgres.sql.gz"
fi

printf 'Stopping Wharnex processes\n'
"$ROOT/scripts/stop.sh" >/dev/null 2>&1 || true

if running "$DB_CONTAINER"; then
  printf 'Dropping Wharnex tables\n'
  # Drop by name-space rather than a hardcoded list, so a table added later is
  # still removed instead of silently surviving a "reset".
  docker exec "$DB_CONTAINER" psql -U wharness -d wharness -v ON_ERROR_STOP=1 -q -c "
    DO \$\$
    DECLARE statement text;
    BEGIN
      SELECT string_agg(format('DROP TABLE IF EXISTS %I CASCADE', tablename), '; ')
        INTO statement
        FROM pg_tables
       WHERE schemaname = 'public'
         AND (tablename LIKE 'harness\_%' OR tablename LIKE 'legacy\_%');
      IF statement IS NOT NULL THEN EXECUTE statement; END IF;
    END \$\$;"
else
  printf 'Database container is not running; skipping table drop\n' >&2
fi

if running "$MINIO_CONTAINER"; then
  printf 'Emptying artifact bucket %s\n' "$BUCKET"
  docker exec "$MINIO_CONTAINER" sh -c '
    mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 || exit 0
    mc rm --recursive --force "local/'"$BUCKET"'" >/dev/null 2>&1 || true
  '
else
  printf 'MinIO container is not running; skipping artifact wipe\n' >&2
fi

if [ -d "$USER_DATA" ]; then
  if [ "$KEEP_BROWSER_SESSION" -eq 1 ] && [ -d "$USER_DATA/Partitions" ]; then
    printf 'Resetting desktop user data, preserving the ChatGPT session\n'
    staging=$(mktemp -d)
    cp -a "$USER_DATA/Partitions" "$staging/Partitions"
    rm -rf "$USER_DATA"
    mkdir -p "$USER_DATA"
    cp -a "$staging/Partitions" "$USER_DATA/Partitions"
    rm -rf "$staging"
  else
    printf 'Resetting desktop user data\n'
    rm -rf "$USER_DATA"
  fi
fi

rm -rf "$ROOT/.harness/run" "$ROOT/.harness/logs"
printf 'Wharnex data reset complete. Run `make start` for a fresh workspace.\n'
