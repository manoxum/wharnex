#!/usr/bin/env sh
# Sourced by the lifecycle gate with its existing root/service paths.

if ! grep -Fq -- '--no-recreate database minio' "$STACK"; then
  echo 'lifecycle regression: normal stack reconciliation must preserve database and MinIO containers' >&2
  exit 1
fi
if ! grep -Fq 'mktemp "$STATE_DIR/stack.env.tmp.XXXXXX"' "$STACK"; then
  echo 'lifecycle regression: concurrent stack readers must use unique credential temp files' >&2
  exit 1
fi
if grep -Eq 'flock[[:space:]]+-w' "$STACK" || ! grep -Fq 'flock -n 9' "$STACK" || ! grep -Fq 'stack-operation.lock' "$STACK"; then
  echo 'lifecycle regression: mutating Compose operations must use a portable bounded lock per checkout' >&2
  exit 1
fi
if ! grep -Fq -- '--no-deps backend frontend webapp gateway' "$STACK"; then
  echo 'lifecycle regression: application rollout must not recreate durable dependencies' >&2
  exit 1
fi
if ! grep -Fq -- '--force-recreate' "$STACK"; then
  echo 'lifecycle regression: application activation must force backend/frontend/webapp onto the freshly tagged images' >&2
  exit 1
fi
if ! grep -Fq 'desired_frontend=$(docker image inspect' "$STACK" || ! grep -Fq 'running_frontend=$(docker inspect' "$STACK" || \
   ! grep -Fq 'desired_webapp=$(docker image inspect' "$STACK" || ! grep -Fq 'running_webapp=$(docker inspect' "$STACK"; then
  echo 'lifecycle regression: application activation must verify frontend and webapp image ids' >&2
  exit 1
fi
stack_readiness_source=$(cat "$STACK" "$ROOT/scripts/stack/readiness.sh")
if ! printf '%s\n' "$stack_readiness_source" | grep -Fq 'service_ready backend 1 && service_ready frontend 1 && service_ready webapp 1 && service_ready gateway 1' || \
   ! grep -Fq 'application_runtime_ready "$backend_container"' "$STACK" || \
   ! grep -Fq '. "$ROOT/scripts/stack/readiness.sh"' "$STACK"; then
  echo 'lifecycle regression: a healthy stack on requested images must skip an unnecessary application rollout' >&2
  exit 1
fi
if ! grep -Fq 'Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always' "$FRONTEND_NGINX"; then
  echo 'lifecycle regression: frontend index.html must not be served from a stale HTTP cache' >&2
  exit 1
fi
if ! grep -Fq 'try_files $uri $uri/ /index.html' "$WEBAPP_NGINX"; then
  echo 'lifecycle regression: remote webapp must retain SPA fallback routing' >&2
  exit 1
fi
if ! grep -Fq 'activate_application' "$STACK" || ! grep -Fq 'docker image tag "$old_backend" "$BACKEND_IMAGE"' "$STACK"; then
  echo 'lifecycle regression: application rollout must retain an image-level rollback path' >&2
  exit 1
fi
if ! grep -Fq 'stack-postgres-migrated-v1' "$STACK" || ! grep -Fq 'PG_VERSION' "$STACK" || ! grep -Fq 'cp -a /source/. /target/' "$STACK"; then
  echo 'lifecycle regression: first-run PostgreSQL stack migration is missing or no longer fail-closed' >&2
  exit 1
fi
if ! grep -Fq 'stack-postgres-reconciled-v2' "$STACK" || ! grep -Fq -- '--on-conflict-do-nothing' "$STACK" || ! grep -Fq 'reconcile_legacy_postgres_if_needed' "$STACK"; then
  echo 'lifecycle regression: PostgreSQL logical reconciliation fence is missing' >&2
  exit 1
fi
for service in database tunnel backend frontend webapp gateway; do
  grep -Eq "^[[:space:]]{2}${service}:" "$COMPOSE" || { echo "lifecycle regression: Compose service $service is missing" >&2; exit 1; }
done
if grep -Eq '^[[:space:]]{2}desktop:' "$COMPOSE"; then
  echo 'lifecycle regression: Desktop must remain a host process, not a Compose service' >&2
  exit 1
fi
if ! grep -Fq 'HARNESS_TUNNEL_DAEMON_URL: "http://tunnel:8090"' "$COMPOSE"; then
  echo 'lifecycle regression: backend must use the dedicated tunnel daemon inside Compose' >&2
  exit 1
fi
if ! grep -Fq 'XDG_CONFIG_HOME=/var/lib/wharness-tunnel/config' "$TUNNEL_DOCKERFILE" || ! grep -Fq 'XDG_DATA_HOME=/var/lib/wharness-tunnel/data' "$TUNNEL_DOCKERFILE" || ! grep -Fq 'XDG_CACHE_HOME=/var/lib/wharness-tunnel/cache' "$TUNNEL_DOCKERFILE"; then
  echo 'lifecycle regression: tunnel-client configuration directories must live on the persistent tunnel volume' >&2
  exit 1
fi
if ! grep -Fq 'desired_tunnel=$(docker image inspect' "$STACK" || ! grep -Fq 'compose up -d --force-recreate --no-deps tunnel' "$STACK"; then
  echo 'lifecycle regression: an updated tunnel image must replace only its container while retaining the named state volume' >&2
  exit 1
fi
if ! grep -Fq '/var/run/docker.sock:/var/run/docker.sock' "$COMPOSE"; then
  echo 'lifecycle regression: containerized backend must retain host Docker executor access' >&2
  exit 1
fi
printf 'Lifecycle Compose isolation checks passed.\n'
