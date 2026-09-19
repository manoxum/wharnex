#!/usr/bin/env sh
set -eu

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
MAKEFILE="$ROOT/Makefile"
START="$ROOT/scripts/start.sh"
LAUNCHER="$ROOT/scripts/launcher.sh"
SPLASH_LIB="$ROOT/scripts/splash-lib.sh"
SOURCE_FINGERPRINT="$ROOT/scripts/source-fingerprint.sh"
SOURCE_FINGERPRINT_CHECK="$ROOT/scripts/source-fingerprint-check.sh"
LAUNCHER_CHECK="$ROOT/scripts/launcher-check.sh"
DOCKER_DAEMON_GUARD_CHECK="$ROOT/scripts/docker-daemon-guard-check.sh"
INSTALL_DEV="$ROOT/scripts/install-dev.sh"
INSTALL_DEV_CHECK="$ROOT/scripts/install-dev-check.sh"
STOP="$ROOT/scripts/stop.sh"
STACK="$ROOT/scripts/stack.sh"
LOGS="$ROOT/scripts/logs.sh"
STORAGE_PRUNE="$ROOT/scripts/storage-prune.sh"
BUILD_LOCK="$ROOT/scripts/build-lock.sh"
ELECTRON_RUNTIME="$ROOT/scripts/electron-runtime.sh"
DESKTOP_DEV="$ROOT/services/desktop/dev.mjs"
SELF_EVOLUTION="$ROOT/services/backend/internal/selfevolution/manager.go"
SELF_RESTART="$ROOT/scripts/self-restart.sh"
BACKEND_DOCKERFILE="$ROOT/services/backend/Dockerfile"
COMPOSE="$ROOT/compose.yml"
FRONTEND_NGINX="$ROOT/services/frontend/nginx.conf"

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
stop_block=$(section stop)

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
if ! grep -Fq 'activate-app' "$SELF_RESTART" || ! grep -Fq 'WHARNESS_SERVICES_MODE:-}" = stack' "$SELF_RESTART"; then
  echo 'lifecycle regression: self-restart worker must roll backend/frontend without restarting tunnel/database' >&2
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
if ! grep -Fq 'install-dev:' "$MAKEFILE" || ! grep -Fq 'scripts/install-dev.sh' "$MAKEFILE" || [ ! -x "$INSTALL_DEV" ]; then
  echo 'lifecycle regression: make install-dev must install the per-instance desktop launcher' >&2
  exit 1
fi
if [ ! -x "$INSTALL_DEV_CHECK" ]; then
  echo 'lifecycle regression: install-dev needs its Snap/XDG launcher regression check' >&2
  exit 1
fi
if [ ! -x "$LAUNCHER" ] || [ ! -x "$SOURCE_FINGERPRINT" ]; then
  echo 'lifecycle regression: desktop launcher needs splash and source-fingerprint helpers' >&2
  exit 1
fi
if [ ! -x "$SOURCE_FINGERPRINT_CHECK" ] || [ ! -x "$LAUNCHER_CHECK" ]; then
  echo 'lifecycle regression: launcher fingerprint/splash requires behavioral regression checks' >&2
  exit 1
fi
WHARNESS_ROOT="$ROOT" "$SOURCE_FINGERPRINT_CHECK"
WHARNESS_ROOT="$ROOT" "$LAUNCHER_CHECK"
# The splash mechanics themselves now live in the shared splash-lib.sh (see
# above), sourced by launcher.sh; what launcher.sh itself must still show is
# that it opens that splash before a source-change build/restart.
if ! grep -Fq 'launcher-splash.mjs' "$SPLASH_LIB" || ! grep -Fq 'WHARNESS_SPLASH_READY_FILE' "$SPLASH_LIB" || ! grep -Fq 'wharness_splash_open' "$LAUNCHER" || ! grep -Fq 'make stop && make build && make start' "$LAUNCHER"; then
  echo 'lifecycle regression: launcher must splash before a source-change build/restart' >&2
  exit 1
fi
WHARNESS_ROOT="$ROOT" "$INSTALL_DEV_CHECK"
if [ ! -x "$DOCKER_DAEMON_GUARD_CHECK" ]; then
  echo 'lifecycle regression: Docker lifecycle needs an isolated daemon-start regression check' >&2
  exit 1
fi
WHARNESS_ROOT="$ROOT" "$DOCKER_DAEMON_GUARD_CHECK"
if grep -Eq 'database\.sh.*stop|stack\.sh.*(stop|down)' "$STOP" || printf '%s\n' "$stop_block" | grep -Eq 'stack-(stop|down)'; then
  echo 'lifecycle regression: make stop must never stop the persistent Compose stack' >&2
  exit 1
fi
if ! grep -Fq "Wharnex build is required" "$START" || ! grep -Fq '(cd "$ROOT" && make build)' "$START" || ! grep -Fq 'source fingerprint changed' "$START"; then
  echo 'lifecycle regression: make start must rebuild a missing or stale application before startup' >&2
  exit 1
fi
# `make start` run directly from a terminal must show the same short splash
# as the installed OS launcher (see AGENTS.md's development-launcher splash
# invariant) — not only when reached through launcher.sh. It must also skip
# opening a second one when launcher.sh already owns one around this call.
if [ ! -f "$SPLASH_LIB" ] || ! grep -Fq 'wharness_splash_open' "$SPLASH_LIB" || ! grep -Fq 'wharness_splash_close' "$SPLASH_LIB"; then
  echo 'lifecycle regression: splash-lib.sh must exist and expose open/close helpers shared by launcher.sh and start.sh' >&2
  exit 1
fi
if ! grep -Fq 'splash-lib.sh' "$START" || ! grep -Fq 'wharness_splash_open' "$START"; then
  echo 'lifecycle regression: make start must drive its own splash, not only launcher.sh' >&2
  exit 1
fi
if ! grep -Fq 'WHARNESS_LAUNCHER_SPLASH_ACTIVE' "$START"; then
  echo 'lifecycle regression: make start must skip opening a second splash when launcher.sh already owns one' >&2
  exit 1
fi
if ! grep -Fq 'WHARNESS_LAUNCHER_SPLASH_ACTIVE=1' "$LAUNCHER"; then
  echo 'lifecycle regression: launcher.sh must tell make start a splash is already owned' >&2
  exit 1
fi
if ! grep -Fq -- '--no-recreate database minio tunnel' "$STACK"; then
  echo 'lifecycle regression: normal stack reconciliation must preserve tunnel/database/MinIO containers' >&2
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
if ! grep -Fq -- '--no-deps backend frontend' "$STACK"; then
  echo 'lifecycle regression: backend/frontend rollout must not recreate durable dependencies' >&2
  exit 1
fi
if ! grep -Fq -- '--force-recreate' "$STACK"; then
  echo 'lifecycle regression: application activation must force backend/frontend onto the freshly tagged images' >&2
  exit 1
fi
if ! grep -Fq 'desired_frontend=$(docker image inspect' "$STACK" || ! grep -Fq 'running_frontend=$(docker inspect' "$STACK"; then
  echo 'lifecycle regression: application activation must verify the running frontend image id' >&2
  exit 1
fi
if ! grep -Fq 'service_ready backend 1 && service_ready frontend 1' "$STACK"; then
  echo 'lifecycle regression: a healthy stack on requested images must skip an unnecessary application rollout' >&2
  exit 1
fi
if ! grep -Fq 'Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always' "$FRONTEND_NGINX"; then
  echo 'lifecycle regression: frontend index.html must not be served from a stale HTTP cache' >&2
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
for service in database tunnel backend frontend; do
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
if ! grep -Fq 'wharnex-host-pty' "$MAKEFILE" || ! grep -Fq "run('hostpty'" "$DESKTOP_DEV"; then
  echo 'lifecycle regression: stack Host PTY must be built and launched natively by the Desktop coordinator' >&2
  exit 1
fi
if ! grep -Fq 'HARNESS_HOST_PTY_SOCKET:' "$COMPOSE"; then
  echo 'lifecycle regression: Compose backend must proxy Host PTY sessions through the checkout bridge socket' >&2
  exit 1
fi
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
if ! grep -Fq 'build-previous-success' "$MAKEFILE"; then
  echo 'lifecycle regression: build adoption must preserve fail-closed active build stamp semantics' >&2
  exit 1
fi
printf 'Lifecycle compiled-artifact cache checks passed.\n'
