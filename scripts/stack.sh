#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
STATE_DIR="$ROOT/.harness/state"
BRIDGE_DIR="$ROOT/.harness/bridge"
STACK_ENV="$STATE_DIR/stack.env"
POSTGRES_ENV="$STATE_DIR/postgres.env"
LEGACY_DATA="$ROOT/.harness/postgres/data"
POSTGRES_IMAGE=${WHARNESS_POSTGRES_IMAGE:-postgres:17-alpine}
# Optional per-checkout overrides (compose project name, ports). Gitignored,
# so two checkouts of this repo can each pin their own values without
# colliding when run concurrently.
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"
# The Compose project identity used to be a SHA-256 hash of the absolute repo
# path, which made every checkout's resources (`wharness-<hash>`) opaque and
# gave two checkouts no way to choose their own name. It now comes from an
# explicit override or, by default, the checkout's own folder name, so
# `docker ps`/`docker compose ls` read as the project itself.
PROJECT=${WHARNESS_COMPOSE_PROJECT_NAME:-}
[ -n "$PROJECT" ] || PROJECT=$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//')
[ -n "$PROJECT" ] || PROJECT="wharness-project"
POSTGRES_VOLUME="wharness-postgres-$PROJECT"
TUNNEL_VOLUME="wharness-tunnel-$PROJECT"
MINIO_VOLUME="wharness-minio-$PROJECT"
LEGACY_CONTAINER="wharness-postgres-$PROJECT"
MIGRATION_MARKER="$STATE_DIR/stack-postgres-migrated-v1"
POSTGRES_RECONCILE_MARKER="$STATE_DIR/stack-postgres-reconciled-v2"
LEGACY_RECOVERY_CONTAINER="wharness-postgres-recovery-$PROJECT"
TUNNEL_MIGRATION_MARKER="$STATE_DIR/stack-tunnel-state-migrated-v1"
BACKEND_IMAGE="wharness-backend:$PROJECT"
FRONTEND_IMAGE="wharness-frontend:$PROJECT"
TUNNEL_IMAGE="wharness-tunnel:$PROJECT"
# Host ports are also per-checkout: two checkouts running concurrently must
# not both try to bind 127.0.0.1:8080/5173.
HTTP_PORT=${WHARNESS_HTTP_PORT:-8080}
WEB_PORT=${WHARNESS_WEB_PORT:-5173}
INSTANCE_ID=${WHARNESS_INSTANCE_ID:-}

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo 'Docker is required for the Wharness service stack.' >&2; exit 1; }
  docker compose version >/dev/null 2>&1 || { echo 'Docker Compose v2 is required for the Wharness service stack.' >&2; exit 1; }
  WHARNESS_ROOT="$ROOT" "$ROOT/scripts/docker-daemon-guard.sh"
  docker info >/dev/null 2>&1 || { echo 'The Docker daemon is not available for the Wharness service stack.' >&2; exit 1; }
}

secret_hex() {
  od -An -N 32 -tx1 /dev/urandom | tr -d ' \n'
}

ensure_credentials() {
  mkdir -p "$STATE_DIR" "$BRIDGE_DIR/tmp"
  chmod 700 "$STATE_DIR" "$BRIDGE_DIR" "$BRIDGE_DIR/tmp"
  if [ ! -f "$POSTGRES_ENV" ]; then
    umask 077
    {
      printf 'POSTGRES_USER=wharness\n'
      printf 'POSTGRES_DB=wharness\n'
      printf 'POSTGRES_PASSWORD=%s\n' "$(secret_hex)"
    } >"$POSTGRES_ENV"
  fi
  chmod 600 "$POSTGRES_ENV"

  user=$(sed -n 's/^POSTGRES_USER=//p' "$POSTGRES_ENV" | head -n 1)
  database=$(sed -n 's/^POSTGRES_DB=//p' "$POSTGRES_ENV" | head -n 1)
  password=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$POSTGRES_ENV" | head -n 1)
  [ "$user" = wharness ] && [ "$database" = wharness ] && [ -n "$password" ] || {
    echo 'Wharness PostgreSQL credentials are incomplete or incompatible.' >&2
    exit 1
  }

  token=$(sed -n 's/^WHARNESS_TUNNEL_API_TOKEN=//p' "$STACK_ENV" 2>/dev/null | head -n 1 || true)
  [ -n "$token" ] || token=$(secret_hex)
  minio_user=$(sed -n 's/^WHARNESS_MINIO_ROOT_USER=//p' "$STACK_ENV" 2>/dev/null | head -n 1 || true)
  [ -n "$minio_user" ] || minio_user=wharness
  minio_password=$(sed -n 's/^WHARNESS_MINIO_ROOT_PASSWORD=//p' "$STACK_ENV" 2>/dev/null | head -n 1 || true)
  [ -n "$minio_password" ] || minio_password=$(secret_hex)
  docker_gid=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)
  [ -n "$docker_gid" ] || { echo 'Cannot resolve Docker socket group id.' >&2; exit 1; }

  umask 077
  stack_env_tmp=$(mktemp "$STATE_DIR/stack.env.tmp.XXXXXX")
  {
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$PROJECT"
    printf 'WHARNESS_STACK_ID=%s\n' "$PROJECT"
    printf 'WHARNESS_ROOT=%s\n' "$ROOT"
    printf 'WHARNESS_HOME=%s\n' "$HOME"
    printf 'WHARNESS_UID=%s\n' "$(id -u)"
    printf 'WHARNESS_GID=%s\n' "$(id -g)"
    printf 'WHARNESS_DOCKER_GID=%s\n' "$docker_gid"
    printf 'WHARNESS_STATE_DIR=%s\n' "$STATE_DIR"
    printf 'WHARNESS_BRIDGE_DIR=%s\n' "$BRIDGE_DIR"
    printf 'WHARNESS_POSTGRES_VOLUME=%s\n' "$POSTGRES_VOLUME"
    printf 'WHARNESS_TUNNEL_VOLUME=%s\n' "$TUNNEL_VOLUME"
    printf 'WHARNESS_MINIO_VOLUME=%s\n' "$MINIO_VOLUME"
    printf 'WHARNESS_DATABASE_PASSWORD=%s\n' "$password"
    printf 'WHARNESS_TUNNEL_API_TOKEN=%s\n' "$token"
    printf 'WHARNESS_MINIO_ROOT_USER=%s\n' "$minio_user"
    printf 'WHARNESS_MINIO_ROOT_PASSWORD=%s\n' "$minio_password"
    printf 'WHARNESS_HTTP_PORT=%s\n' "$HTTP_PORT"
    printf 'WHARNESS_WEB_PORT=%s\n' "$WEB_PORT"
    printf 'WHARNESS_INSTANCE_ID=%s\n' "$INSTANCE_ID"
  } >"$stack_env_tmp"
  mv -f "$stack_env_tmp" "$STACK_ENV"
  chmod 600 "$STACK_ENV"
}

compose() {
  docker compose --project-name "$PROJECT" --env-file "$STACK_ENV" -f "$ROOT/compose.yml" "$@"
}

volume_empty() {
  volume=$1
  docker run --rm --entrypoint sh -v "$volume:/target" "$POSTGRES_IMAGE" -c \
    'test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)"'
}

stop_owned_legacy_database() {
  docker inspect "$LEGACY_CONTAINER" >/dev/null 2>&1 || return 0
  owner=$(docker inspect -f '{{ index .Config.Labels "wharness.root" }}' "$LEGACY_CONTAINER" 2>/dev/null || true)
  [ "$owner" = "$ROOT" ] || { echo "Refusing unowned legacy PostgreSQL container: $LEGACY_CONTAINER" >&2; exit 1; }
  running=$(docker inspect -f '{{.State.Running}}' "$LEGACY_CONTAINER")
  if [ "$running" = true ]; then
    printf 'Stopping legacy Wharness PostgreSQL for one-time stack migration...\n'
    docker stop --time 30 "$LEGACY_CONTAINER" >/dev/null
  fi
}

migrate_legacy_tunnel_state_if_needed() {
  [ -f "$TUNNEL_MIGRATION_MARKER" ] && return 0
  docker volume inspect "$TUNNEL_VOLUME" >/dev/null 2>&1 || docker volume create "$TUNNEL_VOLUME" >/dev/null
  printf 'Migrating existing tunnel credentials/state into the dedicated tunnel volume when present...\n'
  docker run --rm --user 0 --entrypoint sh \
    -e TARGET_UID="$(id -u)" -e TARGET_GID="$(id -g)" \
    -v "$STATE_DIR:/legacy:ro" \
    -v "$TUNNEL_VOLUME:/target" \
    "$POSTGRES_IMAGE" -ec '
      mkdir -p /target
      if [ -d /legacy/tunnel-credentials ] && [ ! -e /target/credentials ]; then
        cp -a /legacy/tunnel-credentials /target/credentials
      fi
      if [ -d /legacy/tunnel-inputs ] && [ ! -e /target/tunnel-inputs ]; then
        cp -a /legacy/tunnel-inputs /target/tunnel-inputs
      fi
      if [ -f /legacy/tunnel-inputs.json ] && [ ! -e /target/usage.json ]; then
        cp -a /legacy/tunnel-inputs.json /target/usage.json
      fi
      chown -R "$TARGET_UID:$TARGET_GID" /target
    '
  umask 077
  printf 'tunnel-state-v1\n' >"$TUNNEL_MIGRATION_MARKER"
}

migrate_legacy_postgres_if_needed() {
  [ -f "$MIGRATION_MARKER" ] && return 0
  docker volume inspect "$POSTGRES_VOLUME" >/dev/null 2>&1 || docker volume create "$POSTGRES_VOLUME" >/dev/null

  if ! volume_empty "$POSTGRES_VOLUME"; then
    printf 'Compose PostgreSQL volume already contains data; preserving it.\n'
    return 0
  fi
  [ -f "$LEGACY_DATA/PG_VERSION" ] || return 0

  version=$(tr -d '[:space:]' <"$LEGACY_DATA/PG_VERSION")
  if [ "$version" != 17 ]; then
    printf 'Legacy PostgreSQL PGDATA uses major version %s; refusing unsafe physical copy into PostgreSQL 17.\n' "$version" >&2
    printf 'Migrate that database logically before starting this stack.\n' >&2
    exit 1
  fi
  stop_owned_legacy_database
  printf 'Migrating legacy PostgreSQL PGDATA into Compose volume %s...\n' "$POSTGRES_VOLUME"
  docker run --rm --user 0 --entrypoint sh \
    -v "$LEGACY_DATA:/source:ro" \
    -v "$POSTGRES_VOLUME:/target" \
    "$POSTGRES_IMAGE" -ec '
      test -f /source/PG_VERSION
      test "$(cat /source/PG_VERSION)" = 17
      test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)"
      cp -a /source/. /target/
    '
}

legacy_source_start() {
  LEGACY_SOURCE_CONTAINER=''
  LEGACY_SOURCE_TEMP=0
  [ -f "$LEGACY_DATA/PG_VERSION" ] || return 1

  version=$(tr -d '[:space:]' <"$LEGACY_DATA/PG_VERSION")
  [ "$version" = 17 ] || {
    printf 'Legacy PostgreSQL PGDATA uses major version %s; refusing logical reconciliation with PostgreSQL 17.\n' "$version" >&2
    return 1
  }

  if docker inspect "$LEGACY_CONTAINER" >/dev/null 2>&1; then
    owner=$(docker inspect -f '{{ index .Config.Labels "wharness.root" }}' "$LEGACY_CONTAINER" 2>/dev/null || true)
    [ "$owner" = "$ROOT" ] || { echo "Refusing unowned legacy PostgreSQL container: $LEGACY_CONTAINER" >&2; return 1; }
    docker start "$LEGACY_CONTAINER" >/dev/null
    LEGACY_SOURCE_CONTAINER=$LEGACY_CONTAINER
  else
    docker rm -f "$LEGACY_RECOVERY_CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$LEGACY_RECOVERY_CONTAINER" \
      --label "wharness.root=$ROOT" \
      --label 'wharness.role=legacy-postgres-recovery' \
      --env-file "$POSTGRES_ENV" \
      -v "$LEGACY_DATA:/var/lib/postgresql/data" \
      "$POSTGRES_IMAGE" >/dev/null
    LEGACY_SOURCE_CONTAINER=$LEGACY_RECOVERY_CONTAINER
    LEGACY_SOURCE_TEMP=1
  fi

  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if docker exec "$LEGACY_SOURCE_CONTAINER" pg_isready -U wharness -d wharness >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  echo 'Legacy PostgreSQL did not become ready for reconciliation.' >&2
  return 1
}

legacy_source_stop() {
  [ -n "${LEGACY_SOURCE_CONTAINER:-}" ] || return 0
  docker stop --time 30 "$LEGACY_SOURCE_CONTAINER" >/dev/null 2>&1 || true
  if [ "${LEGACY_SOURCE_TEMP:-0}" = 1 ]; then
    docker rm -f "$LEGACY_SOURCE_CONTAINER" >/dev/null 2>&1 || true
  fi
  LEGACY_SOURCE_CONTAINER=''
  LEGACY_SOURCE_TEMP=0
}

postgres_table_exists() {
  container=$1
  docker exec "$container" psql -Atq -U wharness -d wharness \
    -c "SELECT to_regclass('public.harness_sessions') IS NOT NULL" 2>/dev/null | grep -qx t
}

compose_session_count() {
  compose exec -T database psql -Atq -U wharness -d wharness -c 'SELECT count(*) FROM harness_sessions' 2>/dev/null
}

reconcile_legacy_postgres_if_needed() {
  [ -f "$POSTGRES_RECONCILE_MARKER" ] && return 0
  [ -f "$LEGACY_DATA/PG_VERSION" ] || return 0

  dump="$BRIDGE_DIR/tmp/legacy-postgres-reconcile-$PROJECT-$$.sql"
  rm -f "$dump"
  if ! legacy_source_start; then
    legacy_source_stop
    return 1
  fi

  if ! postgres_table_exists "$LEGACY_SOURCE_CONTAINER"; then
    printf 'Legacy PostgreSQL has no harness_sessions table; no session data to reconcile.\n'
    legacy_source_stop
    umask 077
    printf 'postgres17-reconciled-v2-empty-source\n' >"$POSTGRES_RECONCILE_MARKER"
    return 0
  fi

  source_count=$(docker exec "$LEGACY_SOURCE_CONTAINER" psql -Atq -U wharness -d wharness -c 'SELECT count(*) FROM harness_sessions')
  target_container=$(compose ps -q database)
  target_has_schema=0
  postgres_table_exists "$target_container" && target_has_schema=1

  printf 'Reconciling legacy PostgreSQL data into the Compose database (%s legacy sessions)...\n' "$source_count"
  if [ "$target_has_schema" = 1 ]; then
    if ! docker exec "$LEGACY_SOURCE_CONTAINER" pg_dump -U wharness -d wharness \
      --data-only --inserts --on-conflict-do-nothing --no-owner --no-privileges >"$dump"; then
      legacy_source_stop
      rm -f "$dump"
      echo 'Failed to dump legacy PostgreSQL data for reconciliation.' >&2
      return 1
    fi
  else
    if ! docker exec "$LEGACY_SOURCE_CONTAINER" pg_dump -U wharness -d wharness \
      --no-owner --no-privileges >"$dump"; then
      legacy_source_stop
      rm -f "$dump"
      echo 'Failed to dump legacy PostgreSQL database for recovery.' >&2
      return 1
    fi
  fi
  legacy_source_stop
  test -s "$dump" || { echo 'Legacy PostgreSQL reconciliation dump is empty.' >&2; rm -f "$dump"; return 1; }

  if ! compose exec -T database psql -v ON_ERROR_STOP=1 -U wharness -d wharness <"$dump" >/dev/null; then
    rm -f "$dump"
    echo 'Failed to import legacy PostgreSQL data into the Compose database.' >&2
    return 1
  fi
  rm -f "$dump"

  target_count=$(compose_session_count || true)
  if ! printf '%s\n' "$source_count" | grep -Eq '^[0-9]+$' || ! printf '%s\n' "$target_count" | grep -Eq '^[0-9]+$'; then
    echo 'Could not verify PostgreSQL session counts after reconciliation.' >&2
    return 1
  fi
  [ "$target_count" -ge "$source_count" ] || {
    printf 'PostgreSQL reconciliation verification failed: source=%s target=%s.\n' "$source_count" "$target_count" >&2
    return 1
  }

  umask 077
  printf 'postgres17-reconciled-v2 source_sessions=%s target_sessions=%s\n' "$source_count" "$target_count" >"$POSTGRES_RECONCILE_MARKER"
  printf 'PostgreSQL reconciliation complete: source=%s target=%s sessions.\n' "$source_count" "$target_count"
}

service_ready() {
  service=$1
  limit=${2:-120}
  attempts=0
  while [ "$attempts" -lt "$limit" ]; do
    container=$(compose ps -q "$service" 2>/dev/null || true)
    if [ -n "$container" ]; then
      state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)
      if [ "$state" = healthy ] || [ "$state" = running ]; then
        return 0
      fi
      if [ "$state" = unhealthy ] || [ "$state" = exited ] || [ "$state" = dead ]; then
        return 1
      fi
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

wait_service() {
  service=$1
  limit=${2:-120}
  if service_ready "$service" "$limit"; then
    return 0
  fi
  echo "Wharness stack service $service did not become healthy." >&2
  compose logs --tail=80 "$service" >&2 || true
  exit 1
}

images_ready() {
  docker image inspect "$BACKEND_IMAGE" "$FRONTEND_IMAGE" "$TUNNEL_IMAGE" >/dev/null 2>&1
}

build_images() {
  printf 'Building Wharness backend/frontend/tunnel images...\n'
  compose build backend frontend tunnel
}

ensure_durable_services() {
  migrate_legacy_postgres_if_needed
  migrate_legacy_tunnel_state_if_needed
  images_ready || build_images

  # Durable infrastructure is explicitly kept on its current container/image.
  # This is the URL-stability boundary: normal build/start may never recreate it.
  compose up -d --no-recreate database minio tunnel
  wait_service database 120
  wait_service minio 120
  reconcile_legacy_postgres_if_needed
  wait_service tunnel 180
  [ -f "$MIGRATION_MARKER" ] || { umask 077; printf 'postgres17-stack-v1\n' >"$MIGRATION_MARKER"; }
}

activate_application() {
  require_docker
  ensure_credentials
  ensure_durable_services
  docker image inspect "$BACKEND_IMAGE" "$FRONTEND_IMAGE" >/dev/null 2>&1 || {
    echo 'Wharness application images are missing; run make build-stage first.' >&2
    return 1
  }

  old_backend=''
  old_frontend=''
  backend_container=$(compose ps -q backend 2>/dev/null || true)
  frontend_container=$(compose ps -q frontend 2>/dev/null || true)
  [ -z "$backend_container" ] || old_backend=$(docker inspect -f '{{.Image}}' "$backend_container" 2>/dev/null || true)
  [ -z "$frontend_container" ] || old_frontend=$(docker inspect -f '{{.Image}}' "$frontend_container" 2>/dev/null || true)
  desired_backend=$(docker image inspect -f '{{.Id}}' "$BACKEND_IMAGE")
  desired_frontend=$(docker image inspect -f '{{.Id}}' "$FRONTEND_IMAGE")

  if compose up -d --force-recreate --no-deps backend frontend && service_ready backend 120 && service_ready frontend 120; then
    backend_container=$(compose ps -q backend 2>/dev/null || true)
    frontend_container=$(compose ps -q frontend 2>/dev/null || true)
    running_backend=$(docker inspect -f '{{.Image}}' "$backend_container" 2>/dev/null || true)
    running_frontend=$(docker inspect -f '{{.Image}}' "$frontend_container" 2>/dev/null || true)
    if [ "$running_backend" = "$desired_backend" ] && [ "$running_frontend" = "$desired_frontend" ]; then
      return 0
    fi
    printf 'Wharness application rollout selected stale image IDs: backend=%s/%s frontend=%s/%s.\n' \
      "$running_backend" "$desired_backend" "$running_frontend" "$desired_frontend" >&2
  fi

  echo 'Wharness application rollout failed; restoring previous backend/frontend images when available.' >&2
  compose logs --tail=80 backend frontend >&2 || true
  if [ -n "$old_backend" ] && [ -n "$old_frontend" ]; then
    docker image tag "$old_backend" "$BACKEND_IMAGE"
    docker image tag "$old_frontend" "$FRONTEND_IMAGE"
    if compose up -d --force-recreate --no-deps backend frontend && service_ready backend 120 && service_ready frontend 120; then
      echo 'Previous Wharness application containers restored after failed rollout.' >&2
    else
      echo 'Previous Wharness application containers could not be restored automatically.' >&2
      compose logs --tail=80 backend frontend >&2 || true
    fi
  fi
  return 1
}

ensure_stack() {
  activate_application
}

stack_status() {
  require_docker
  ensure_credentials
  compose ps
}

case ${1:-} in
  prepare)
    require_docker
    ensure_credentials
    migrate_legacy_postgres_if_needed
    ;;
  build)
    require_docker
    ensure_credentials
    build_images
    ;;
  ensure|up)
    ensure_stack
    ;;
  activate-app)
    activate_application
    ;;
  stop)
    require_docker
    ensure_credentials
    compose stop
    ;;
  down)
    require_docker
    ensure_credentials
    compose down --remove-orphans
    ;;
  status)
    stack_status
    ;;
  logs)
    require_docker
    ensure_credentials
    shift
    if [ "$#" -eq 0 ]; then compose logs --tail=120 -f
    else compose logs "$@"
    fi
    ;;
  *)
    echo 'usage: stack.sh prepare|build|ensure|up|activate-app|stop|down|status|logs' >&2
    exit 2
    ;;
esac
