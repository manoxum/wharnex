#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
STATE_DIR="$ROOT/.harness/state"
DATA_DIR="$ROOT/.harness/postgres/data"
ENV_FILE="$STATE_DIR/postgres.env"
IMAGE=${WHARNESS_POSTGRES_IMAGE:-postgres:17-alpine}
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"
# Must stay byte-for-byte consistent with scripts/stack.sh's PROJECT/LEGACY_CONTAINER
# formula: this legacy container's name/ownership label is compared against it.
PROJECT=${WHARNESS_COMPOSE_PROJECT_NAME:-}
[ -n "$PROJECT" ] || PROJECT=$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//')
[ -n "$PROJECT" ] || PROJECT="wharness-project"
CONTAINER="wharness-postgres-$PROJECT"

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo 'Docker is required for the Wharness PostgreSQL database.' >&2; exit 1; }
  WHARNESS_ROOT="$ROOT" "$ROOT/scripts/docker-daemon-guard.sh"
  docker info >/dev/null 2>&1 || { echo 'The Docker daemon is not available for the Wharness PostgreSQL database.' >&2; exit 1; }
}

container_exists() {
  docker inspect "$CONTAINER" >/dev/null 2>&1
}

docker_available() {
  command -v docker >/dev/null 2>&1 || return 1
  WHARNESS_ROOT="$ROOT" "$ROOT/scripts/docker-daemon-guard.sh" >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1
}

validate_owner() {
  owner=$(docker inspect -f '{{ index .Config.Labels "wharness.root" }}' "$CONTAINER" 2>/dev/null || true)
  [ "$owner" = "$ROOT" ] || { echo "Refusing unowned PostgreSQL container: $CONTAINER" >&2; exit 1; }
}

ensure_credentials() {
  mkdir -p "$STATE_DIR" "$ROOT/.harness/postgres"
  chmod 700 "$STATE_DIR" "$ROOT/.harness/postgres"
  if [ ! -d "$DATA_DIR" ]; then
    mkdir "$DATA_DIR"
    chmod 700 "$DATA_DIR"
  fi
  if [ ! -f "$ENV_FILE" ]; then
    password=$(od -An -N 32 -tx1 /dev/urandom | tr -d ' \n')
    umask 077
    {
      printf 'POSTGRES_USER=wharness\n'
      printf 'POSTGRES_DB=wharness\n'
      printf 'POSTGRES_PASSWORD=%s\n' "$password"
    } >"$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

ensure_database() {
  require_docker
  ensure_credentials
  if container_exists; then
    validate_owner
    running=$(docker inspect -f '{{.State.Running}}' "$CONTAINER")
    [ "$running" = true ] || docker start "$CONTAINER" >/dev/null
  else
    docker run -d \
      --name "$CONTAINER" \
      --label "wharness.root=$ROOT" \
      --env-file "$ENV_FILE" \
      --mount "type=bind,src=$DATA_DIR,dst=/var/lib/postgresql/data" \
      --publish 127.0.0.1::5432 \
      "$IMAGE" >/dev/null
  fi
  attempts=0
  until docker exec "$CONTAINER" pg_isready -q -U wharness -d wharness; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 120 ]; then
      echo 'Wharness PostgreSQL did not become ready.' >&2
      exit 1
    fi
    sleep 0.25
  done
  port=$(docker port "$CONTAINER" 5432/tcp | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | head -n 1)
  [ -n "$port" ] || { echo 'Wharness PostgreSQL has no validated loopback port.' >&2; exit 1; }
  password=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ENV_FILE" | head -n 1)
  [ -n "$password" ] || { echo 'Wharness PostgreSQL credentials are incomplete.' >&2; exit 1; }
  printf 'postgres://wharness:%s@127.0.0.1:%s/wharness?sslmode=disable\n' "$password" "$port"
}

stop_database() {
  docker_available || exit 0
  container_exists || exit 0
  validate_owner
  running=$(docker inspect -f '{{.State.Running}}' "$CONTAINER")
  [ "$running" = true ] || exit 0
  docker stop --time 10 "$CONTAINER" >/dev/null
  echo 'Wharness PostgreSQL stopped.'
}

status_database() {
  if ! docker_available || ! container_exists; then
    echo '  database     not created'
    exit 0
  fi
  validate_owner
  running=$(docker inspect -f '{{.State.Running}}' "$CONTAINER")
  if [ "$running" = true ]; then
    port=$(docker port "$CONTAINER" 5432/tcp | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | head -n 1)
    printf '  database     running (loopback port %s)\n' "${port:-unknown}"
  else
    echo '  database     stopped (data preserved)'
  fi
}

case ${1:-} in
  ensure) ensure_database ;;
  stop) stop_database ;;
  status) status_database ;;
  *) echo 'usage: database.sh ensure|stop|status' >&2; exit 2 ;;
esac
