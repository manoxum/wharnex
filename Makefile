ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NPM_CACHE ?= $(HOME)/.cache/wharness-npm
RUNNER_IMAGE ?= kernl-runner:local
DIST_DIR ?= $(ROOT_DIR)/dist
BACKEND_BIN := $(DIST_DIR)/bin/wharness-backend

.PHONY: help deps build build-backend build-frontend build-desktop build-runner \
	backend-check frontend-check desktop-check check test start stop restart status logs \
	run-backend run-frontend run-desktop clean export

help:
	@printf '%s\n' \
		'Wharness lifecycle:' \
		'  make build    Install dependencies and build backend/frontend/desktop/runner' \
		'  make start    Start backend + frontend + Electron in background' \
		'  make stop     Stop services started by make start' \
		'  make restart  Restart the complete desktop stack' \
		'  make status   Show coordinator/services status' \
		'  make logs     Follow desktop stack logs' \
		'  make check    Run backend/frontend/desktop quality checks' \
		'' \
		'Linux graphics override:' \
		'  WHARNESS_OZONE_PLATFORM=wayland make start'

deps:
	@command -v go >/dev/null || { echo 'go is required' >&2; exit 1; }
	@command -v node >/dev/null || { echo 'node is required' >&2; exit 1; }
	@command -v npm >/dev/null || { echo 'npm is required' >&2; exit 1; }
	@command -v docker >/dev/null || { echo 'docker is required' >&2; exit 1; }
	@command -v curl >/dev/null || { echo 'curl is required' >&2; exit 1; }
	cd "$(ROOT_DIR)/services/backend" && go mod download
	cd "$(ROOT_DIR)/services/frontend" && npm install --cache "$(NPM_CACHE)"
	cd "$(ROOT_DIR)/services/desktop" && npm install --cache "$(NPM_CACHE)"

build-backend:
	@mkdir -p "$(dir $(BACKEND_BIN))"
	cd "$(ROOT_DIR)/services/backend" && CGO_ENABLED=0 go build -o "$(BACKEND_BIN)" ./cmd/harness

build-frontend:
	cd "$(ROOT_DIR)/services/frontend" && npm run build

build-desktop:
	cd "$(ROOT_DIR)/services/desktop" && npm run build

build-runner:
	docker build -t "$(RUNNER_IMAGE)" -f "$(ROOT_DIR)/docker/runner/Dockerfile" "$(ROOT_DIR)"

build:
	@$(MAKE) --no-print-directory deps
	@$(MAKE) --no-print-directory build-backend
	@$(MAKE) --no-print-directory build-frontend
	@$(MAKE) --no-print-directory build-desktop
	@$(MAKE) --no-print-directory build-runner
	@printf '\nWharness build complete. Start with: make start\n'

backend-check:
	cd "$(ROOT_DIR)/services/backend" && gofmt -w . && go vet ./... && go test ./... && go test -race ./...

frontend-check:
	cd "$(ROOT_DIR)/services/frontend" && npm run typecheck && npm run lint && npm test -- --run && npm run build

desktop-check:
	cd "$(ROOT_DIR)/services/desktop" && npm run check

check:
	@$(MAKE) --no-print-directory backend-check
	@$(MAKE) --no-print-directory frontend-check
	@$(MAKE) --no-print-directory desktop-check

test: check

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
	rm -rf "$(DIST_DIR)" "$(ROOT_DIR)/services/frontend/dist" "$(ROOT_DIR)/.harness/run" "$(ROOT_DIR)/.harness/logs"

EXPORT_ARCHIVE ?= $(DIST_DIR)/wharness.zip
export:
	@mkdir -p "$(dir $(EXPORT_ARCHIVE))"
	@tmp_dir=$$(mktemp -d); \
		trap 'rm -rf "$$tmp_dir"' EXIT; \
		cd "$(ROOT_DIR)"; \
		zip -q -y -r "$$tmp_dir/wharness.zip" . \
			-x '.git/*' '.env' '.harness/*' \
			'node_modules/*' '*/node_modules/*' 'dist/*' '*/dist/*' \
			'build/*' '*/build/*' 'coverage/*' '*/coverage/*' \
			'.next/*' '*/.next/*' '.vite/*' '*/.vite/*' \
			'vendor/*' '*/vendor/*' 'playwright-report/*' '*/playwright-report/*' \
			'test-results/*' '*/test-results/*' '.cache/*' '*/.cache/*' \
			'__pycache__/*' '*/__pycache__/*' '*.tsbuildinfo' '*.pyc' '*.log' '.DS_Store' \
			'*.pem' '*.key' '*.p12' '*.pfx' 'id_rsa' '*/id_rsa' 'id_ed25519' '*/id_ed25519' \
			'credentials.json' '*/credentials.json' 'secrets/*' '*/secrets/*' \
			'*.db' '*.sqlite' '*.sqlite3' '*.dump' '*.sql.gz'; \
		mv -f "$$tmp_dir/wharness.zip" "$(EXPORT_ARCHIVE)"; \
		printf 'Project exported to %s\n' "$(EXPORT_ARCHIVE)"
