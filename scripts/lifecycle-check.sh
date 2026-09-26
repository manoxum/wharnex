#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
MAKEFILE="$ROOT/Makefile"
START="$ROOT/scripts/start.sh"
TERMINAL_SERVICE_CHECK="$ROOT/scripts/terminal-service-check.sh"
STACK="$ROOT/scripts/stack.sh"
LOGS="$ROOT/scripts/logs.sh"
STORAGE_PRUNE="$ROOT/scripts/storage-prune.sh"
STORAGE_RECLAIM="$ROOT/scripts/storage-reclaim.sh"
BUILD_LOCK="$ROOT/scripts/build-lock.sh"
ELECTRON_RUNTIME="$ROOT/scripts/electron-runtime.sh"
DESKTOP_DEV="$ROOT/services/desktop/dev.mjs"
HOST_GIT_BRIDGE="$ROOT/services/desktop/host-git-bridge.mjs"
DESKTOP_RELAUNCH="$ROOT/scripts/desktop-relaunch.sh"
UP_LINK_HOST_CHECK="$ROOT/scripts/up-whx-link-host-check.sh"
SELF_EVOLUTION="$ROOT/services/backend/internal/selfevolution/manager.go"
SELF_RESTART="$ROOT/scripts/self-restart.sh"
BACKEND_DOCKERFILE="$ROOT/services/backend/Dockerfile"
TUNNEL_DOCKERFILE="$ROOT/services/tunnel/Dockerfile"
COMPOSE="$ROOT/compose.yml"
FRONTEND_NGINX="$ROOT/services/frontend/nginx.conf"
WEBAPP_NGINX="$ROOT/services/webapp/nginx.conf"

section() {
  target=$1
  awk -v target="$target" '
    $0 ~ ("^" target ":") { inside=1; next }
    inside && /^[A-Za-z0-9_.-]+:/ { exit }
    inside { print }
  ' "$MAKEFILE"
}

build_block=$(section build)
build_stage_block=$(section build-stage)
build_stage_unlocked_block=$(section build-stage-unlocked)
deps_block=$(section deps)
deps_unlocked_block=$(section deps-unlocked)
deps_refresh_block=$(section deps-refresh)

runner_probe_image='kernl-runner:lifecycle-check'
build_dry_run=$(make --no-print-directory -n -f "$MAKEFILE" build RUNNER_IMAGE="$runner_probe_image")
if ! printf '%s\n' "$build_dry_run" | grep -Fq "docker build -t \"$runner_probe_image\""; then
  echo 'lifecycle regression: make build must materialize the configured Protected runner image' >&2
  exit 1
fi

if ! printf '%s\n' "$build_block" | grep -Fq 'stack.sh" ensure'; then
  echo 'lifecycle regression: make build must reconcile the Compose application stack' >&2
  exit 1
fi
if ! printf '%s\n' "$build_block" | grep -Fq 'storage-prune'; then
  echo 'lifecycle regression: make build must prune obsolete Wharnex caches after reconciliation' >&2
  exit 1
fi
if [ ! -x "$STORAGE_PRUNE" ] || ! grep -Fq '/api/storage/prune' "$STORAGE_PRUNE"; then
  echo 'lifecycle regression: storage prune helper must use the backend ownership-aware cleanup' >&2
  exit 1
fi
if ! printf '%s\n' "$build_block" | grep -Fq 'storage-reclaim'; then
  echo 'lifecycle regression: make build must reclaim the host storage the backend cannot see' >&2
  exit 1
fi
if [ ! -x "$STORAGE_RECLAIM" ]; then
  echo 'lifecycle regression: host storage reclamation helper is missing or not executable' >&2
  exit 1
fi
# Reclamation is housekeeping. A build that produced healthy services and then
# failed to delete a stale directory has still built; making the lifecycle
# command fail on it is what previously left `make build` broken permanently.
if ! grep -A2 '^storage-reclaim:' "$MAKEFILE" | grep -Fq 'build unaffected'; then
  echo 'lifecycle regression: host reclamation must never fail the lifecycle command that ran it' >&2
  exit 1
fi
# Only untagged layers unused for the whole retention window are eligible, so
# the previous generation the rollout rolls back to is never the one reclaimed.
if ! grep -Fq 'docker image prune --force --filter "until=${KEEP_HOURS}h"' "$STORAGE_RECLAIM" || \
   grep -Eq 'docker image prune[^|]*(--all|[[:space:]]-a[[:space:]])' "$STORAGE_RECLAIM"; then
  echo 'lifecycle regression: Docker reclamation must keep the image-level rollback generation' >&2
  exit 1
fi
# A named volume holds this checkout's PostgreSQL/MinIO state. The sweep must be
# opt-in and reach only anonymous volumes Docker reports as attached to nothing.
if grep -Fq 'docker volume prune' "$STORAGE_RECLAIM" || ! grep -Fq 'WHARNESS_RECLAIM_VOLUMES:-0' "$STORAGE_RECLAIM"; then
  echo 'lifecycle regression: anonymous-volume reclamation must stay opt-in and never use a blanket volume prune' >&2
  exit 1
fi
# The self-evolution transaction a recovery still depends on is the one the
# status file names; it must survive every retention window.
if ! grep -Fq 's/^transaction=//p' "$STORAGE_RECLAIM"; then
  echo 'lifecycle regression: reclamation must retain the self-evolution transaction still named by status' >&2
  exit 1
fi
if [ ! -x "$BUILD_LOCK" ] || ! printf '%s\n' "$build_stage_block" | grep -Fq 'build-lock.sh'; then
  echo 'lifecycle regression: build-stage must serialize dependency mutation and staging' >&2
  exit 1
fi
if ! printf '%s\n' "$build_stage_unlocked_block" | grep -Fq 'stack-build'; then
  echo 'lifecycle regression: locked build-stage must build Compose images without activating them' >&2
  exit 1
fi
if ! grep -A2 '^stack-build:' "$MAKEFILE" | grep -Fq 'stack.sh" build'; then
  echo 'lifecycle regression: stack-build must delegate to the Compose image builder' >&2
  exit 1
fi
if ! grep -Fq 'exec.CommandContext(ctx, "make", "build-stage")' "$SELF_EVOLUTION"; then
  echo 'lifecycle regression: self-evolution must stage images without replacing the active runtime' >&2
  exit 1
fi
if ! grep -Fq 'scheduleStackRestart' "$SELF_EVOLUTION" || ! grep -Fq '"docker", args...' "$SELF_EVOLUTION"; then
  echo 'lifecycle regression: stack self-evolution must hand restart supervision to a detached Docker container' >&2
  exit 1
fi
if ! grep -Fq 'activate-services' "$SELF_RESTART" || ! grep -Fq 'WHARNESS_SERVICES_MODE:-}" = stack' "$SELF_RESTART"; then
  echo 'lifecycle regression: self-restart worker must activate only the transaction impact manifest' >&2
  exit 1
fi
if [ ! -x "$DESKTOP_RELAUNCH" ] || ! grep -Fq 'exec env WHARNESS_ROOT="$ROOT" "$ROOT/scripts/start.sh"' "$DESKTOP_RELAUNCH"; then
  echo 'lifecycle regression: Desktop self-evolution relaunch must restart the full coordinator through start.sh' >&2
  exit 1
fi
if ! grep -Fq 'RecordBuiltSourceFingerprint' "$SELF_EVOLUTION" || ! grep -Fq 'source-fingerprint.sh' "$SELF_EVOLUTION"; then
  echo 'lifecycle regression: completed self-evolution builds must record their source fingerprint' >&2
  exit 1
fi
if ! grep -Fq 'docker-cli-compose' "$BACKEND_DOCKERFILE" || ! grep -Fq 'nodejs npm' "$BACKEND_DOCKERFILE" || ! grep -Fq 'make' "$BACKEND_DOCKERFILE"; then
  echo 'lifecycle regression: containerized backend must carry the control/build toolchain required by self-evolution' >&2
  exit 1
fi
if printf '%s\n' "$deps_unlocked_block" | grep -Eq 'command -v docker|docker[[:space:]]'; then
  echo 'lifecycle regression: dependency hydration must remain Docker-independent' >&2
  exit 1
fi
if ! grep -Fq 'build-runner: runner-deps' "$MAKEFILE"; then
  echo 'lifecycle regression: the direct Protected runner recovery target must remain available' >&2
  exit 1
fi
WHARNESS_ROOT="$ROOT" "$ROOT/scripts/lifecycle-launcher-check.sh"
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
if ! grep -Fq 'service_ready backend 1 && service_ready frontend 1 && service_ready webapp 1 && service_ready gateway 1' "$STACK"; then
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

if [ ! -x "$ELECTRON_RUNTIME" ]; then
  echo 'lifecycle regression: immutable Electron runtime manager is missing or not executable' >&2
  exit 1
fi
if ! grep -Fq '/opt/wharness/electron' "$ELECTRON_RUNTIME"; then
  echo 'lifecycle regression: Linux Electron runtime must live outside the npm workspace' >&2
  exit 1
fi
if grep -Eq 'sudo[[:space:]]+(chown|chmod).*SOURCE_(HELPER|DIST)' "$ELECTRON_RUNTIME"; then
  echo 'lifecycle regression: node_modules Electron files must never be made privileged in place' >&2
  exit 1
fi
if ! grep -Fq 'WHARNESS_ELECTRON_BINARY' "$START" || ! grep -Fq 'electron-runtime.sh' "$START"; then
  echo 'lifecycle regression: start must resolve the immutable Electron runtime before launch' >&2
  exit 1
fi
if ! grep -Fq 'session_launcher=setsid' "$START"; then
  echo 'lifecycle regression: detached coordinator must own a new OS session when setsid is available' >&2
  exit 1
fi
if ! grep -Fq 'WHARNESS_SERVICES_MODE=stack' "$START" || ! grep -Fq "servicesMode === 'stack'" "$DESKTOP_DEV"; then
  echo 'lifecycle regression: Desktop coordinator must attach only to the validated Compose application services in stack mode' >&2
  exit 1
fi
if ! grep -Fq 'resolveElectronBinary' "$DESKTOP_DEV" || ! grep -Fq 'electron-runtime.sh' "$DESKTOP_DEV"; then
  echo 'lifecycle regression: Desktop coordinator must resolve and honor the immutable Electron binary' >&2
  exit 1
fi
if ! grep -Fq 'coordinatorKeepAlive' "$DESKTOP_DEV"; then
  echo 'lifecycle regression: detached Electron must retain a tracked coordinator owner' >&2
  exit 1
fi
if ! grep -Fq 'wharnex-host-pty' "$MAKEFILE" || ! grep -Fq "run('hostpty'" "$HOST_GIT_BRIDGE" || ! grep -Fq -- "--git-socket" "$HOST_GIT_BRIDGE"; then
  echo 'lifecycle regression: Desktop must keep the restricted native Host Git bridge' >&2
  exit 1
fi
if grep -Fq 'hostPTYSocket' "$DESKTOP_DEV"; then
  echo 'lifecycle regression: Desktop reload must not own the durable Host PTY socket' >&2
  exit 1
fi
if grep -Fq '  terminal:' "$COMPOSE" || ! grep -Fq 'HARNESS_HOST_PTY_SOCKET' "$COMPOSE" || ! grep -Fq 'ensure_terminal_service' "$STACK" || ! grep -Fq 'wharnex-host-pty' "$ROOT/scripts/terminal-service.sh"; then
  echo 'lifecycle regression: Host PTYs must run in the durable native host terminal service' >&2
  exit 1
fi
if ! grep -Fq 'terminald.pid' "$ROOT/scripts/terminal-service.sh" || ! grep -Fq 'host terminal bridge' "$DESKTOP_DEV"; then
  echo 'lifecycle regression: native Host PTY ownership must survive app restarts and gate Desktop readiness' >&2
  exit 1
fi
if [ ! -x "$TERMINAL_SERVICE_CHECK" ]; then
  echo 'lifecycle regression: the durable host terminal service needs an isolated fd-leak regression check' >&2
  exit 1
fi
WHARNESS_ROOT="$ROOT" "$TERMINAL_SERVICE_CHECK"
printf 'Lifecycle immutable Electron runtime checks passed.\n'

if [ ! -x "$LOGS" ]; then
  echo 'lifecycle regression: categorized lifecycle log reader is missing or not executable' >&2
  exit 1
fi
for source in frontend electron chatgpt self; do
  "$LOGS" --list | grep -qx "$source" || { echo "lifecycle regression: log source $source is missing" >&2; exit 1; }
done
if ! grep -Fq 'logs: export WHARNESS_LOG_SOURCE = $(or $(SOURCE),all)' "$MAKEFILE" || \
   ! grep -Fq 'logs: export WHARNESS_LOG_FOLLOW = $(or $(FOLLOW),0)' "$MAKEFILE" || \
   ! grep -Fq 'logs: export WHARNESS_LOG_FILTER = $(FILTER)' "$MAKEFILE"; then
  echo 'lifecycle regression: make logs must expose source, follow and text filtering' >&2
  exit 1
fi
if ! grep -Fq 'compose logs "$@"' "$STACK"; then
  echo 'lifecycle regression: stack logs must forward bounded frontend log options' >&2
  exit 1
fi
printf 'Lifecycle categorized log checks passed.\n'
WHARNESS_ROOT="$ROOT" "$ROOT/scripts/logs-check.sh"

DEPS_CACHE="$ROOT/scripts/deps-cache.sh"
if [ ! -x "$DEPS_CACHE" ]; then
  echo 'lifecycle regression: dependency fingerprint cache helper is missing' >&2
  exit 1
fi
if ! printf '%s\n' "$deps_block" | grep -Fq 'build-lock.sh' || ! printf '%s\n' "$deps_refresh_block" | grep -Fq 'build-lock.sh'; then
  echo 'lifecycle regression: dependency hydration and refresh must share the build lock' >&2
  exit 1
fi
if ! printf '%s\n' "$deps_unlocked_block" | grep -Fq 'deps-cache.sh" sync'; then
  echo 'lifecycle regression: locked make deps must use dependency fingerprint cache' >&2
  exit 1
fi
if ! grep -Fq 'flock -n 9' "$BUILD_LOCK" || grep -Eq 'flock[[:space:]].*-w' "$BUILD_LOCK"; then
  echo 'lifecycle regression: build lock must use BusyBox-compatible bounded non-blocking flock' >&2
  exit 1
fi
if ! grep -Fq -- '--prefer-offline' "$DEPS_CACHE" || ! grep -Fq -- '--no-audit' "$DEPS_CACHE" || ! grep -Fq -- '--no-fund' "$DEPS_CACHE"; then
  echo 'lifecycle regression: npm hydration must reuse cache without audit/funding network work' >&2
  exit 1
fi
if ! grep -Fq 'GOPROXY=off GOFLAGS=-mod=readonly go mod download -json' "$DEPS_CACHE"; then
  echo 'lifecycle regression: a Go dependency fingerprint hit must still prove the module cache is complete offline' >&2
  exit 1
fi
if printf '%s\n' "$deps_unlocked_block" | grep -Eq 'npm[[:space:]]+install'; then
  echo 'lifecycle regression: make deps must not unconditionally run npm install' >&2
  exit 1
fi
if ! printf '%s\n' "$build_stage_unlocked_block" | grep -Fq '$(BUILD_JOBS)'; then
  echo 'lifecycle regression: local application artifacts must retain bounded parallel build support' >&2
  exit 1
fi
printf 'Lifecycle fast rebuild checks passed.\n'

BUILD_CACHE="$ROOT/scripts/build-cache.sh"
if [ ! -x "$BUILD_CACHE" ]; then
  echo 'lifecycle regression: compiled-artifact cache helper is missing' >&2
  exit 1
fi
if ! grep -Fq 'build-cache.sh" run frontend' "$MAKEFILE"; then
  echo 'lifecycle regression: frontend production build must use the artifact fingerprint cache' >&2
  exit 1
fi
if ! grep -Fq 'services/frontend/dist/index.html' "$BUILD_CACHE"; then
  echo 'lifecycle regression: frontend cache hit must require the production artifact' >&2
  exit 1
fi
if ! grep -Fq 'services/frontend/dist/monaco/vs/loader.js' "$BUILD_CACHE"; then
  echo 'lifecycle regression: frontend cache hit must require the precompiled Monaco runtime' >&2
  exit 1
fi
if ! grep -Fq 'build-cache.sh" run webapp' "$MAKEFILE"; then
  echo 'lifecycle regression: webapp production build must use the artifact fingerprint cache' >&2
  exit 1
fi
if ! grep -Fq 'services/webapp/dist/index.html' "$BUILD_CACHE"; then
  echo 'lifecycle regression: webapp cache hit must require the production artifact' >&2
  exit 1
fi
if ! grep -Fq 'build-previous-success' "$MAKEFILE"; then
  echo 'lifecycle regression: build adoption must preserve fail-closed active build stamp semantics' >&2
  exit 1
fi
printf 'Lifecycle compiled-artifact cache checks passed.\n'

if ! printf '%s\n' "$build_block" | grep -Fq 'up-link-host-install'; then
  echo 'lifecycle regression: make build must install the up-whx-link host profile' >&2
  exit 1
fi
[ -x "$UP_LINK_HOST_CHECK" ] || { echo 'lifecycle regression: up-whx-link host installer check is missing' >&2; exit 1; }
WHARNESS_ROOT="$ROOT" "$UP_LINK_HOST_CHECK"
# Lifecycle helper scripts written in Node carry their own node:test suites.
set -- "$ROOT"/scripts/*.test.mjs
if [ -e "$1" ]; then
  node --test "$@" >/dev/null || { echo 'lifecycle regression: a scripts/*.test.mjs suite failed (run node --test scripts/*.test.mjs)' >&2; exit 1; }
  echo 'Lifecycle script unit tests passed.'
fi
