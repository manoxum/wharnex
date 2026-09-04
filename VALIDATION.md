# V1 Validation Record

Validated in the build environment on 2026-09-02.

## Passed

- `gofmt` on backend source.
- `go test ./...`.
- `go test -race ./...`.
- `go vet ./...`.
- `go build ./cmd/harness` (binary removed from release tree afterward).
- OpenAI adapter contract test with `httptest` for `/files` + `/responses`.
- Context secret filtering tests.
- Protocol/path traversal tests.
- Policy dangerous-command tests.
- Sandbox/host separation integration test.
- HTTP smoke flow: create session -> manual prompt -> submit plan -> sandbox execute -> verify host unchanged -> explicit apply -> host changed.
- JSON schema files parse successfully.
- `compose.yml` parses as YAML.
- shell scripts pass `sh -n`.
- React/TypeScript source passed a compiler syntax/type-shape scan using the available global TypeScript compiler and temporary external-module stubs.

## Not executable in this build environment

- Full `npm install`, ESLint, Vitest, Playwright, and Vite production build: package registry/network access was unavailable and dependencies were not preinstalled.
- Docker runner build/execution: Docker CLI/daemon was unavailable in the build environment.
- Live OpenAI API request: no user API key was used. The HTTP adapter is covered by a local contract test instead.

These limitations are environmental, not silently treated as passing gates.
## v1.2.5 focused validation

- Project Git bootstrap initializes `.git` when a selected project root has no repository and is idempotent afterward.
- A project nested inside a parent repository receives its own repository boundary.
- Sandbox copies initialize a fresh Git baseline without copying host `.git`.
- `git diff --check` succeeds inside the sandbox after a tracked change.
- Manual ChatGPT output using `schema`, wrapped verification commands, missing conservative command defaults, and the safe `*** Add File` dialect normalizes into strict `harness.execution/v1`.
- End-to-end test: manual ChatGPT-like JSON -> normalize -> policy -> sandbox patch -> `git diff --check` -> host remains unchanged -> explicit host apply.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, and backend build pass after the change.


## v1.2.6 multi-chat validation

Validated after adding per-workspace multi-chat and ChatGPT conversation affinity:

- `go test ./...` — PASS.
- `go vet ./...` — PASS.
- Electron syntax checks (`main.mjs`, `preload.cjs`, `security.mjs`) — PASS.
- `node --test services/desktop/security.test.mjs` — PASS, 10/10 including trusted-only ChatGPT navigation.
- TypeScript 5.8.3 source scan with temporary external React/Vite type stubs — PASS. This checks the changed frontend source when registry dependencies are unavailable in the validation environment.
- Standalone persistence smoke — PASS: two Harness chats retain separate session metadata, transcripts, and ChatGPT URLs; ChatGPT URL canonicalization strips query/fragment data and rejects untrusted origins.

A full `npm ci`/Vitest/Vite run could not be completed in this environment because the package registry dependency cache was incomplete and the network install did not complete. The patch introduces no new npm dependency.

## v1.2.7 manual JSON transport validation

- `go test ./...` — PASS.
- `go test -race ./...` — PASS.
- `go vet ./...` — PASS.
- Backend build — PASS.
- Regression: invalid JSON caused by CSS `content: "";` inside a unified-diff patch is repaired without changing the patch content, then passes strict v1 validation — PASS.
- Regression: fenced `json` manual output is accepted — PASS.
- Regression: malformed JSON outside a recognized patch string is not repaired and returns an actionable syntax error — PASS.
- No policy, path, command, or protocol validation is bypassed by the repair step.


## v1.2.8 — Per-project execution modes + resilient patch apply

Validated for this update:

- `go test ./...` — PASS
- `go test -race ./...` — PASS
- `go vet ./...` — PASS
- `go build ./cmd/harness` — PASS
- new backend tests verify default Protected mode, per-session mode switching, mandatory confirmation for Unprotected execution, direct host mutation, and absence of a second Apply step;
- new sandbox tests verify `git apply --recount` fallback for malformed hunk counts and useful Git stderr diagnostics when a patch genuinely does not match;
- `npm run typecheck` in `services/frontend` — PASS;
- `npm run check` in `services/desktop` — PASS (10/10 security/runtime tests).

The frontend Vitest/Vite build suite was not re-run in this container because a fresh `npm install` did not complete within the available registry/network window; no new frontend dependency was added. TypeScript compilation succeeded against the available toolchain.


## v1.2.33 - Dedicated ChatGPT renderer per Harness chat

- Desktop regression coverage verifies one `WebContentsView` owner per Harness chat id, no renderer eviction/reassignment path, keyed DOM/input/navigation IPC, and explicit renderer release on permanent chat deletion.
- Frontend regression coverage verifies that state events tagged for another Harness chat are ignored by the active ChatGPT pane.
- `npm run check` in `services/desktop` — PASS, 67/67 tests.
- `npm run typecheck` in `services/frontend` — NOT EXECUTABLE in the supplied export because `node_modules` is absent; the compiler reports missing Vite/Playwright/Vitest type packages before project source checking. The bundle keeps the normal frontend typecheck and focused Vitest gates for Wharness Protected verification, where project dependencies are hydrated. No npm dependency is added by this change.

## v1.2.32 automatic-repair reconciliation

- The current host snapshot already contains the complete v1.2.32 auto-growing composer implementation, documentation, styles and focused regressions, so the failed repair patch must not replay those hunks.
- The preceding Protected execution established `git diff --check`, 14 focused `ChatPanel` tests and frontend lint as passing for this implementation.
- The preceding `npm run build` failure was environmental: Vite reached the Node heap ceiling near 1 GiB during transform and exited 134. The repaired Protected gate set therefore uses focused tests, lint and TypeScript typecheck, while the transactional self-evolution flow retains ownership of the real host build/restart.
