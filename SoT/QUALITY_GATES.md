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

## G4 Concurrency

- `go test -race ./...`

## G5 Build

Canonical local build command: `make build`. It must:

- resolve/install service dependencies;
- build the Go backend binary under `dist/bin`;
- build the React production bundle and copy the versioned precompiled local Monaco runtime without rebundling Monaco's dependency source graph;
- validate the Electron desktop runtime and installed Electron binary;

The Docker runner is deliberately excluded from normal `make build`; `make build-runner` builds it explicitly from the repository root context.

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

- `make start`: start the tracked coordinator, backend/frontend as needed, and Electron.
- `make stop`: stop only processes owned by that coordinator.
- `make status`: report tracked PIDs plus backend/frontend health.
- `make logs`: follow the combined Desktop lifecycle log.

Runtime state belongs under `.harness/` and must never be committed.
