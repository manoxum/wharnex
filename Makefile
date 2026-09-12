ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NPM_CACHE ?= $(HOME)/.cache/wharness-npm
DEPS_CACHE_DIR ?= $(ROOT_DIR)/.harness/cache/dependencies
BUILD_CACHE_DIR ?= $(ROOT_DIR)/.harness/cache/builds
BUILD_JOBS ?= 2
RUNNER_IMAGE ?= kernl-runner:local
DIST_DIR ?= $(ROOT_DIR)/dist
BACKEND_BIN := $(DIST_DIR)/bin/wharness-backend
BUILD_STAMP := $(ROOT_DIR)/.harness/build-success
BUILD_BASELINE_STAMP := $(ROOT_DIR)/.harness/build-previous-success

.PHONY: reset-data clean-all help deps deps-status deps-refresh build-status build-refresh runner-deps build build-stage build-all build-backend build-frontend build-desktop build-runner build-plan stack-build \
	stack-up stack-stop stack-down stack-status stack-logs backend-check frontend-check desktop-check lifecycle-check check test start stop restart status logs \
	electron-runtime-check electron-runtime-install electron-runtime-status \
	electron-sandbox-check electron-sandbox-install electron-sandbox-restore \
	run-backend run-frontend run-desktop clean export export-check

help:
	@printf '%s\n' \
		'Wharnex lifecycle:' \
		'  make build    Build application/stack images and reconcile backend/frontend services' \
		'  make build-stage  Build artifacts/images without replacing running services (self-evolution)' \
		'  make deps-status   Show dependency fingerprint cache state' \
		'  make deps-refresh  Force deterministic dependency re-hydration' \
		'  make build-status  Show compiled-artifact fingerprint cache state' \
		'  make build-refresh Force recompilation while preserving dependency caches' \
		'  make build-runner  Explicitly build the Protected Docker runner (Docker must already be active)' \
		'  make build-all     Build desktop lifecycle + runner explicitly' \
		'  make start    Reconcile Compose services and start Desktop on the host' \
		'  make stop     Stop Desktop only; Compose services and tunnel URLs stay alive' \
		'  make restart  Restart Desktop/application containers while preserving tunnel/database' \
		'  make stack-up     Ensure the persistent Compose stack is running' \
		'  make stack-stop   Stop all Compose services, preserving containers/volumes' \
		'  make stack-down   Remove Compose containers/network, preserving named volumes' \
		'  make stack-status Show Compose service state' \
		'  make stack-logs   Follow Compose service logs' \
		'  make status   Show Desktop + Compose service status' \
		'  make logs     Show categorized frontend, Electron, ChatGPT and self-evolution logs' \
		'                SOURCE=chatgpt FILTER=error FOLLOW=1 TAIL=200' \
		'  make check    Run backend/frontend/desktop quality checks' \
		'' \
		'Data reset (destructive):' \
		'  make reset-data   Drop every Wharnex table, empty the artifact bucket and reset' \
		'                    the Electron userData. Keeps the authenticated ChatGPT session' \
		'                    and backs PostgreSQL up first. Requires typing RESET WHARNEX.' \
		'                    RESET_BROWSER_SESSION=1 also destroys the ChatGPT login' \
		'                    RESET_BACKUP=0 skips the PostgreSQL backup' \
		'  make clean        Remove build output only; runtime data is untouched' \
		'  make clean-all    clean + reset-data' \
		'' \
		'Linux Electron runtime:' \
		'  make electron-runtime-check     Verify immutable runtime / user-namespace fallback' \
		'  make electron-runtime-install   Install versioned root-owned runtime under /opt/wharness' \
		'  make electron-runtime-status    Show current runtime metadata' \
		'  electron-sandbox-* targets remain compatibility aliases' \
		'' \
		'Linux graphics override:' \
		'  WHARNESS_OZONE_PLATFORM=wayland make start'

deps:
	@command -v git >/dev/null || { echo 'git is required' >&2; exit 1; }
	@command -v curl >/dev/null || { echo 'curl is required' >&2; exit 1; }
	@WHARNESS_ROOT="$(ROOT_DIR)" \
		WHARNESS_NPM_CACHE="$(NPM_CACHE)" \
		WHARNESS_DEPS_CACHE_DIR="$(DEPS_CACHE_DIR)" \
		"$(ROOT_DIR)/scripts/deps-cache.sh" sync


deps-status:
	@WHARNESS_ROOT="$(ROOT_DIR)" \
		WHARNESS_NPM_CACHE="$(NPM_CACHE)" \
		WHARNESS_DEPS_CACHE_DIR="$(DEPS_CACHE_DIR)" \
		"$(ROOT_DIR)/scripts/deps-cache.sh" status


deps-refresh:
	@WHARNESS_ROOT="$(ROOT_DIR)" \
		WHARNESS_NPM_CACHE="$(NPM_CACHE)" \
		WHARNESS_DEPS_CACHE_DIR="$(DEPS_CACHE_DIR)" \
		"$(ROOT_DIR)/scripts/deps-cache.sh" refresh

build-status:
	@WHARNESS_ROOT="$(ROOT_DIR)" \
		WHARNESS_BUILD_CACHE_DIR="$(BUILD_CACHE_DIR)" \
		WHARNESS_BUILD_BASELINE_STAMP="$(BUILD_BASELINE_STAMP)" \
		"$(ROOT_DIR)/scripts/build-cache.sh" status

build-refresh:
	@WHARNESS_BUILD_FORCE=1 $(MAKE) --no-print-directory build

runner-deps:
	@command -v docker >/dev/null || { echo 'docker is required to build the Protected runner' >&2; exit 1; }
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/docker-daemon-guard.sh"

build-backend:
	@mkdir -p "$(dir $(BACKEND_BIN))"
	@WHARNESS_ROOT="$(ROOT_DIR)" WHARNESS_BUILD_CACHE_DIR="$(BUILD_CACHE_DIR)" \
		WHARNESS_BUILD_BASELINE_STAMP="$(BUILD_BASELINE_STAMP)" WHARNESS_BUILD_FORCE="$(WHARNESS_BUILD_FORCE)" \
		"$(ROOT_DIR)/scripts/build-cache.sh" run backend sh -c \
		'cd "$(ROOT_DIR)/services/backend" && CGO_ENABLED=0 go build -o "$(BACKEND_BIN)" ./cmd/harness'

build-frontend:
	@WHARNESS_ROOT="$(ROOT_DIR)" WHARNESS_BUILD_CACHE_DIR="$(BUILD_CACHE_DIR)" \
		WHARNESS_BUILD_BASELINE_STAMP="$(BUILD_BASELINE_STAMP)" WHARNESS_BUILD_FORCE="$(WHARNESS_BUILD_FORCE)" \
		"$(ROOT_DIR)/scripts/build-cache.sh" run frontend sh -c \
		'cd "$(ROOT_DIR)/services/frontend" && npm run build'

build-desktop:
	@WHARNESS_ROOT="$(ROOT_DIR)" WHARNESS_BUILD_CACHE_DIR="$(BUILD_CACHE_DIR)" \
		WHARNESS_BUILD_BASELINE_STAMP="$(BUILD_BASELINE_STAMP)" WHARNESS_BUILD_FORCE="$(WHARNESS_BUILD_FORCE)" \
		"$(ROOT_DIR)/scripts/build-cache.sh" run desktop sh -c \
		'cd "$(ROOT_DIR)/services/desktop" && npm run build'

build-runner: runner-deps
	docker build -t "$(RUNNER_IMAGE)" -f "$(ROOT_DIR)/docker/runner/Dockerfile" "$(ROOT_DIR)"

build-stage:
	@mkdir -p "$(dir $(BUILD_STAMP))"
	@if [ -f "$(BUILD_STAMP)" ]; then cp -p "$(BUILD_STAMP)" "$(BUILD_BASELINE_STAMP)"; fi
	@rm -f "$(BUILD_STAMP)"
	@$(MAKE) --no-print-directory deps
	@$(MAKE) --no-print-directory -j"$(BUILD_JOBS)" build-backend build-frontend build-desktop
	@$(MAKE) --no-print-directory stack-build
	@touch "$(BUILD_STAMP)"
	@rm -f "$(BUILD_BASELINE_STAMP)"
	@printf '\nWharness build stage complete; running stack services were not replaced.\n'

build: build-stage
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stack.sh" ensure
	@printf '\nWharness build complete; backend/frontend reconciled and durable tunnel/database preserved.\n'


build-all:
	@$(MAKE) --no-print-directory build
	@$(MAKE) --no-print-directory build-runner
	@printf '\nWharness application + Protected runner build complete.\n'

build-plan:
	@printf '%s\n' deps build-backend build-frontend build-desktop stack-build

stack-build:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stack.sh" build

stack-up:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stack.sh" ensure

stack-stop:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stack.sh" stop

stack-down:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stack.sh" down

stack-status:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stack.sh" status

stack-logs:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stack.sh" logs

backend-check:
	cd "$(ROOT_DIR)/services/backend" && gofmt -w . && go vet ./... && go test ./... && go test -race ./...

frontend-check:
	cd "$(ROOT_DIR)/services/frontend" && npm run typecheck && npm run lint && npm test -- --run && npm run build

desktop-check:
	cd "$(ROOT_DIR)/services/desktop" && npm run check

lifecycle-check:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/lifecycle-check.sh"

check:
	@$(MAKE) --no-print-directory backend-check
	@$(MAKE) --no-print-directory frontend-check
	@$(MAKE) --no-print-directory desktop-check
	@$(MAKE) --no-print-directory lifecycle-check
	@$(MAKE) --no-print-directory export-check

test: check

electron-runtime-check:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/electron-runtime.sh" check

electron-runtime-install:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/electron-runtime.sh" install

electron-runtime-status:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/electron-runtime.sh" status

# Compatibility aliases retained for operators/scripts from v1.2.23.x.
electron-sandbox-check: electron-runtime-check

electron-sandbox-install: electron-runtime-install

electron-sandbox-restore: electron-runtime-install

start:
	@WHARNESS_ROOT="$(ROOT_DIR)" WHARNESS_RUNNER_IMAGE="$(RUNNER_IMAGE)" "$(ROOT_DIR)/scripts/start.sh"

stop:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/stop.sh"

restart: stop start

status:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/status.sh"

logs: export WHARNESS_ROOT := $(ROOT_DIR)
logs: export WHARNESS_LOG_SOURCE = $(or $(SOURCE),all)
logs: export WHARNESS_LOG_FILTER = $(FILTER)
logs: export WHARNESS_LOG_FOLLOW = $(or $(FOLLOW),0)
logs: export WHARNESS_LOG_TAIL = $(or $(TAIL),120)
logs:
	@"$(ROOT_DIR)/scripts/logs.sh"

run-backend:
	cd "$(ROOT_DIR)/services/backend" && go run ./cmd/harness

run-frontend:
	cd "$(ROOT_DIR)/services/frontend" && npm run dev

run-desktop:
	cd "$(ROOT_DIR)/services/desktop" && npm run dev

# clean removes build output only. Runtime data lives in PostgreSQL, MinIO and
# the Electron userData, and is destroyed by `make reset-data` — a separate,
# explicitly confirmed target, so rebuilding never costs anyone their sessions.
clean:
	@$(MAKE) --no-print-directory stop || true
	rm -rf "$(DIST_DIR)" "$(ROOT_DIR)/services/frontend/dist" "$(ROOT_DIR)/.harness/run" "$(ROOT_DIR)/.harness/logs" \
		"$(BUILD_CACHE_DIR)" "$(BUILD_STAMP)" "$(BUILD_BASELINE_STAMP)"

# Destroys this checkout's runtime data: every Wharnex table, every artifact
# object, and the Electron userData. Preserves the authenticated ChatGPT
# browser partition unless RESET_BROWSER_SESSION=1. Backs PostgreSQL up first
# unless RESET_BACKUP=0.
reset-data: export WHARNESS_ROOT := $(ROOT_DIR)
reset-data:
	@"$(ROOT_DIR)/scripts/reset-data.sh" \
		$(if $(filter 1,$(RESET_BROWSER_SESSION)),--include-browser-session,) \
		$(if $(filter 0,$(RESET_BACKUP)),--no-backup,)

# clean-all is the full wipe: build output and runtime data together.
clean-all: clean reset-data

EXPORT_DIR ?= $(abspath $(ROOT_DIR)/../project-context/wharness)
EXPORT_ARCHIVE ?= $(EXPORT_DIR)/wharness.zip
export:
	@"$(ROOT_DIR)/scripts/export.sh" "$(ROOT_DIR)" "$(EXPORT_ARCHIVE)"

export-check:
	@set -eu; \
		tmp_dir=$$(mktemp -d); \
		trap 'rm -rf "$$tmp_dir"' EXIT; \
		$(MAKE) --no-print-directory export EXPORT_ARCHIVE="$$tmp_dir/wharness.zip"; \
		test -s "$$tmp_dir/wharness.zip"; \
		unzip -tqq "$$tmp_dir/wharness.zip"; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORTS.md | grep -F 'Schema: `wharness.exports/v1`' >/dev/null; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORTS.md | grep -F '## Wharnex recent logs' >/dev/null; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORT_INDEX.md | grep -F 'Schema: `wharness.export-index/v1`' >/dev/null; \
		unzip -Z1 "$$tmp_dir/wharness.zip" > "$$tmp_dir/entries.txt"; \
		if grep -E '(^|/)\.harness/|(^|/)\.idea/|\.(orig|rej)$$|(^|/)(kernl-context-|wharness-input-|wharness-bundle-)' "$$tmp_dir/entries.txt" >/dev/null; then \
			echo 'export contains a forbidden runtime/generated entry' >&2; \
			exit 1; \
		fi; \
		if test -d "$(ROOT_DIR)/patches"; then \
			find "$(ROOT_DIR)/patches" -maxdepth 1 -type f -name '*.patch' -printf 'patches/%f\n' | sort > "$$tmp_dir/expected-patches.txt"; \
			while IFS= read -r patch_entry; do \
				test -z "$$patch_entry" || grep -F -x "$$patch_entry" "$$tmp_dir/entries.txt" >/dev/null || { \
					echo "export omitted repository patch: $$patch_entry" >&2; \
					exit 1; \
				}; \
			done < "$$tmp_dir/expected-patches.txt"; \
		fi; \
		mkdir "$$tmp_dir/not-an-archive"; \
		if $(MAKE) --no-print-directory export EXPORT_ARCHIVE="$$tmp_dir/not-an-archive" >/dev/null 2>&1; then \
			echo 'export unexpectedly accepted a directory as its archive path' >&2; \
			exit 1; \
		fi; \
		printf 'Export archive checks passed.\n'
