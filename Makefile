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

.PHONY: help deps deps-status deps-refresh build-status build-refresh runner-deps build build-all build-backend build-frontend build-desktop build-runner build-plan \
	backend-check frontend-check desktop-check lifecycle-check check test start stop restart status logs \
	electron-runtime-check electron-runtime-install electron-runtime-status \
	electron-sandbox-check electron-sandbox-install electron-sandbox-restore \
	run-backend run-frontend run-desktop clean export export-check

help:
	@printf '%s\n' \
		'Wharness lifecycle:' \
		'  make build    Reuse dependency cache and build backend/frontend/desktop (does not touch Docker)' \
		'  make deps-status   Show dependency fingerprint cache state' \
		'  make deps-refresh  Force deterministic dependency re-hydration' \
		'  make build-status  Show compiled-artifact fingerprint cache state' \
		'  make build-refresh Force recompilation while preserving dependency caches' \
		'  make build-runner  Explicitly build the Protected Docker runner (Docker must already be active)' \
		'  make build-all     Build desktop lifecycle + runner explicitly' \
		'  make start    Start backend + frontend + Electron in background' \
		'  make stop     Stop services started by make start' \
		'  make restart  Restart the complete desktop stack' \
		'  make status   Show coordinator/services status' \
		'  make logs     Follow desktop stack logs' \
		'  make check    Run backend/frontend/desktop quality checks' \
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

build:
	@mkdir -p "$(dir $(BUILD_STAMP))"
	@if [ -f "$(BUILD_STAMP)" ]; then cp -p "$(BUILD_STAMP)" "$(BUILD_BASELINE_STAMP)"; fi
	@rm -f "$(BUILD_STAMP)"
	@$(MAKE) --no-print-directory deps
	@$(MAKE) --no-print-directory -j"$(BUILD_JOBS)" build-backend build-frontend build-desktop
	@touch "$(BUILD_STAMP)"
	@rm -f "$(BUILD_BASELINE_STAMP)"
	@printf '\nWharness build complete without Docker daemon access. Start with: make start\n'


build-all:
	@$(MAKE) --no-print-directory build
	@$(MAKE) --no-print-directory build-runner
	@printf '\nWharness application + Protected runner build complete.\n'

build-plan:
	@printf '%s\n' deps build-backend build-frontend build-desktop

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

logs:
	@WHARNESS_ROOT="$(ROOT_DIR)" "$(ROOT_DIR)/scripts/logs.sh"

run-backend:
	cd "$(ROOT_DIR)/services/backend" && go run ./cmd/harness

run-frontend:
	cd "$(ROOT_DIR)/services/frontend" && npm run dev

run-desktop:
	cd "$(ROOT_DIR)/services/desktop" && npm run dev

clean:
	@$(MAKE) --no-print-directory stop || true
	rm -rf "$(DIST_DIR)" "$(ROOT_DIR)/services/frontend/dist" "$(ROOT_DIR)/.harness/run" "$(ROOT_DIR)/.harness/logs" \
		"$(BUILD_CACHE_DIR)" "$(BUILD_STAMP)" "$(BUILD_BASELINE_STAMP)"

EXPORT_DIR ?= $(abspath $(ROOT_DIR)/../project-context/wharness)
EXPORT_ARCHIVE ?= $(EXPORT_DIR)/wharness.zip
export:
	@mkdir -p "$(dir $(EXPORT_ARCHIVE))"
	@set -eu; \
		tmp_dir=$$(mktemp -d); \
		trap 'rm -rf "$$tmp_dir"' EXIT; \
		cd "$(ROOT_DIR)/services/backend"; \
		go run ./cmd/exportmeta -root "$(ROOT_DIR)" -kind make-export -output "$$tmp_dir/EXPORTS.md"; \
		cd "$(ROOT_DIR)"; \
		zip -q -y -r "$$tmp_dir/wharness.zip" . \
			-x '.git/*' '.env' '.harness/*' 'EXPORTS.md' \
			'node_modules/*' '*/node_modules/*' 'dist/*' '*/dist/*' \
			'build/*' '*/build/*' 'coverage/*' '*/coverage/*' \
			'.next/*' '*/.next/*' '.vite/*' '*/.vite/*' \
			'vendor/*' '*/vendor/*' 'playwright-report/*' '*/playwright-report/*' \
			'test-results/*' '*/test-results/*' '.cache/*' '*/.cache/*' \
			'__pycache__/*' '*/__pycache__/*' '*.tsbuildinfo' '*.pyc' '*.log' '.DS_Store' \
			'*.pem' '*.key' '*.p12' '*.pfx' 'id_rsa' '*/id_rsa' 'id_ed25519' '*/id_ed25519' \
			'credentials.json' '*/credentials.json' 'secrets/*' '*/secrets/*' \
			'*.db' '*.sqlite' '*.sqlite3' '*.dump' '*.sql.gz'; \
		(cd "$$tmp_dir" && zip -q "wharness.zip" EXPORTS.md); \
		mv -f "$$tmp_dir/wharness.zip" "$(EXPORT_ARCHIVE)"; \
		test -f "$(EXPORT_ARCHIVE)"; \
		test -s "$(EXPORT_ARCHIVE)"; \
		unzip -tqq "$(EXPORT_ARCHIVE)"; \
		unzip -p "$(EXPORT_ARCHIVE)" EXPORTS.md | grep -Fq '## Git status'; \
		unzip -p "$(EXPORT_ARCHIVE)" EXPORTS.md | grep -Fq '## Git worktrees'; \
		unzip -p "$(EXPORT_ARCHIVE)" EXPORTS.md | grep -Fq '## Wharness status'; \
		unzip -p "$(EXPORT_ARCHIVE)" EXPORTS.md | grep -Fq '## Wharness recent logs'; \
		printf 'Project exported to %s\n' "$(EXPORT_ARCHIVE)"

export-check:
	@set -eu; \
		tmp_dir=$$(mktemp -d); \
		trap 'rm -rf "$$tmp_dir"' EXIT; \
		$(MAKE) --no-print-directory export EXPORT_ARCHIVE="$$tmp_dir/wharness.zip"; \
		test -s "$$tmp_dir/wharness.zip"; \
		unzip -tqq "$$tmp_dir/wharness.zip"; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORTS.md | grep -Fq 'Schema: `wharness.exports/v1`'; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORTS.md | grep -Fq '## Git status'; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORTS.md | grep -Fq '## Git worktrees'; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORTS.md | grep -Fq '## Wharness status'; \
		unzip -p "$$tmp_dir/wharness.zip" EXPORTS.md | grep -Fq '## Wharness recent logs'; \
		mkdir "$$tmp_dir/not-an-archive"; \
		if $(MAKE) --no-print-directory export EXPORT_ARCHIVE="$$tmp_dir/not-an-archive" >/dev/null 2>&1; then \
			echo 'export unexpectedly accepted a directory as its archive path' >&2; \
			exit 1; \
		fi; \
		printf 'Export archive checks passed.\n'
