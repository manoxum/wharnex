# Quality Gates SoT

## G0 Repository integrity

No credentials, generated context bundles, or temporary workspaces committed.

## G1 Formatting

- Go: `gofmt`
- Frontend: formatter/linter policy

## G2 Static analysis

- `go vet ./...`
- TypeScript typecheck
- ESLint

## G3 Unit/integration

- `go test ./...`
- frontend tests
- PostgreSQL Session Store migration and CRUD integration tests when the
  Docker-managed test database is available.

## G4 Concurrency

- `go test -race ./...`
- Four disjoint candidates from one revision integrate without replanning.
- Disjoint hunks in one file merge; the same hunk creates one focused conflict request.
- A human/external edit does not supersede an in-flight planner request.
- CAS races and conditional rollback preserve the external writer's value.
- Read/barrier changes select integration re-verification without global baseline repair.
- Frontend tests prove that a conflict uses a persisted cache key distinct from its owning chat's primary ChatGPT view.

## G5 Build

Canonical operator build command: `make build`. It must:

- resolve/install development dependencies needed by quality gates/Desktop;
- build the compatibility Go/frontend artifacts and validate the Electron desktop runtime;
- build backend, frontend and tunnel Compose images;
- reconcile backend/frontend containers while preserving existing PostgreSQL/tunnel containers.

`make build-stage` performs the same artifact/image staging but MUST NOT replace running services and is the only build target used by transactional self-evolution. The Protected Docker runner is deliberately excluded from both targets; `make build-runner` remains explicit.

## G6 Security

Recommended CI additions: `gosec`, `govulncheck`, `npm audit`, Trivy, secret scanning.

## G7 E2E

Playwright session/bootstrap/manual-plan workflow plus Docker executor tests where Docker is available.


## G8 Desktop shell

- `node --check` for Electron main/preload/dev launcher.
- `node --test services/desktop/security.test.mjs`.
- Validate remote view sandbox/context-isolation/Node-integration invariants in review.
- Validate clipboard session/URL/bounds guards.
- Where Electron runtime is available, smoke: launch Desktop -> ChatGPT tab -> login/session persistence -> copy context ZIP -> paste attachment.

## G9 Local lifecycle

The canonical Desktop lifecycle is rooted at the repository Makefile:

- `make build-stage`: stage artifacts and service images without replacing running services.
- `make build`: stage then reconcile backend/frontend while preserving PostgreSQL/tunnel identity.
- `make start`: ensure the persistent Compose stack is healthy and start only the host Electron/Desktop coordinator.
- `make stop`: stop Desktop only; it MUST NOT stop/recreate backend, frontend, PostgreSQL or tunnel services.
- `make stack-stop`: explicitly stop every Compose service while retaining containers and named volumes.
- `make stack-down`: remove Compose containers/network while retaining named data volumes.
- `make status`: report Desktop plus Compose health.

Normal `make build`/`make start` MUST use `--no-recreate` for PostgreSQL and tunnel containers. Backend/frontend may roll independently with `--no-deps`; this preserves active temporary tunnel base URLs across application restart/self-evolution. First stack initialization migrates compatible PostgreSQL 17 data from the former checkout-owned PGDATA into the named volume before the new database starts. A distinct logical reconciliation marker MUST repair skipped/partial first migrations by idempotently merging the legacy PostgreSQL rows after the Compose database becomes healthy and verifying session counts before backend activation.
Stack self-evolution MUST NOT execute its restart worker inside the backend container that will be replaced. The backend image MUST contain the local build/control toolchain required by `make build-stage`, and activation MUST be delegated to a detached supervisor container. Application rollout MUST retain the previous backend/frontend image IDs long enough to restore them on failed health checks; tunnel/database containers remain excluded from that rollback boundary.

Runtime state belongs under `.harness/` and must never be committed.

## G10 Orchestrator

- Unit tests MUST cover proposal/DAG validation, cycle rejection and readiness across plan approval/dependency completion.
- Backend transitions MUST reject unknown states, direct entry into `DOING`, and manual movement of a task whose Agent run is active.
- Project integration tests SHOULD cover durable Plan/Task/dependency/TaskRun round-trips against PostgreSQL when the Docker-managed test database is available.
- Frontend tests MUST keep Orchestrator available as a first-class workspace mode and SHOULD cover draft approval, manual planner import, task creation and the four task projections.
- A task Start regression MUST prove it delegates to the normal Agent execution path and that a second `DOING` task in the same project is refused; it MUST NOT introduce a direct command-execution seam.
