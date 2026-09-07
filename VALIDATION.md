## v1.2.46.1 legacy integration-race classifier hotfix

- Regression extends `TestLegacyFailureKindRecognizesPersistedPingPongCauses` across both legacy persistence surfaces: `LastRepairError` and `LastExecution.Error`.
- The classifier lowercases both the persisted detail and the `ErrHostIntegrationRace` sentinel before matching, so the mixed-case `ChangeSet` token cannot silently disable `host_integration_race` recovery after reload.
- Patch-construction environment: `gofmt` and `git diff --check` pass. The focused Go test cannot start here because the supplied source export omits `github.com/jackc/pgx/v5` from the module cache and outbound access to `proxy.golang.org` is blocked; the operator batch runs the canonical backend/frontend gates in the hydrated workspace.

## v1.2.46 concurrency recovery + fixed chat header

- `service_recovery_hardening_test.go` covers verification-only pending-plan filtering, local failure classification (`self_evolution_transaction_busy`, `stale_host_baseline`, `host_integration_race`, `execution_context_canceled`), planner reason-code classification and ChangeSet race restaging and stale-candidate revalidation where a verification failure is unchanged from the current host baseline, plus canceled exit -1 propagation so renderer/request cancellation cannot fabricate a source repair.
- `requestDispatch.test.ts` verifies persisted request ids block automatic re-dispatch after a renderer reload; repair/conflict/workflow notices now carry durable request iteration metadata.
- `AgentWorkspace.test.tsx` verifies **Exportar chat** is rendered in the chat header rather than the Agent activity rail; `styles.test.ts` verifies that header remains sticky while `.chat-stream` owns scrolling.
- The apply path aborts and releases a prepared self-evolution transaction on pre-mutation ChangeSet race/restage failure, never rolling back an external writer's host state.

## v1.2.45 chat audit export

- `services/backend/internal/app/chat_export_test.go` verifies that the audit ZIP preserves the exact original bytes for main request/response and correction request/response bundles, exports execution and approval events, and correlates ChatGPT transcript responses to their request ids.
- `services/frontend/src/components/AgentWorkspace.test.tsx` verifies the Agent activity rail exposes the **Exportar chat** action and dispatches the export callback.
- The HTTP export endpoint is bounded to a 32 MiB JSON description, writes the potentially large ZIP through a temporary file instead of buffering the whole archive in the HTTP handler, and fails the export when a persisted artifact listed by the session cannot be read.
- In this source-only validation environment the Go gate cannot start because `github.com/jackc/pgx/v5` is absent from the module cache and outbound access to `proxy.golang.org` is blocked. The operator apply batch therefore runs the canonical backend/frontend gates after `git apply --check` in the real workspace.

## v1.2.43.2.5 retained-patches export rebase regression

- Reproduced from the operator run: v1.2.43.2.4 fails at `git apply --check` on `scripts/export.sh:21`, so none of that patch is applied and the checkout remains on the working v1.2.43.2.3 exporter.
- The replacement patch is generated directly against the 2026-09-05 18:59 exported checkout and removes only the stale `patches/*` exclusion while preserving the clean-export SIGPIPE fixes and forbidden runtime/generated filters.
- `make export` must retain repository `patches/*.patch`, continue excluding runtime/generated payloads, and print path/size/entries/patch-count/SHA-256 metadata.
- `make export-check` must verify all top-level repository `.patch` files are present in the archive and must still reject `.harness`, `.idea`, `.orig/.rej`, `kernl-context-*`, `wharness-input-*` and `wharness-bundle-*` entries.

## v1.2.43.2.3 clean export patches exclusion regression

- Reproduced from the operator run after v1.2.43.2.2: application/frontend/Desktop gates pass, `make export` produces an archive, then `export-check` rejects it because `patches/` is still present.
- Root cause: `scripts/export.sh` documented `patches/` as excluded but its `zip -x` pattern list omitted both `patches/` and `patches/*`.
- The exporter now excludes the whole historical patch tree and performs the forbidden-entry scan itself before publishing the archive, with bounded offending-path diagnostics.
- Required regressions: `make export` must produce no `^patches/`, `.harness`, `.idea`, `.orig/.rej`, `kernl-context-*`, `wharness-input-*` or `wharness-bundle-*` entries; `make export-check` must pass; final export must retain path/size/entries/SHA-256 logging.

## v1.2.43.2.2 project explorer async regression

- `AgentWorkspace` project-explorer coverage waits for the `README.md` file button returned by the mocked asynchronous `api.listFiles()` call before clicking it.
- This removes the false race where the test used the refresh button as a readiness signal even though that control is rendered before file loading completes.
- `make export` / `export-check` behavior is unchanged from v1.2.43.2.1.

## v1.2.43.2.1 clean export SIGPIPE hotfix regression

- Reproduced from the operator run: all backend/frontend/Desktop gates passed, then `make export` terminated with status 141 before printing export metadata.
- Root cause: `unzip -l | awk | sort -nr | head -15` runs under `set -o pipefail`; `head` closes early after 15 lines and the upstream `sort` receives `SIGPIPE`, making the otherwise successful exporter fail with 141.
- The inventory now uses an EOF-consuming final `awk` instead of `head`; `export-check` likewise replaces early-exit `grep -q` consumers so `unzip` cannot be spuriously SIGPIPE'd.
- `make export` — PASS on the patched post-v1.2.43.2 tree: 788K / 805984 bytes, 401 entries, archive integrity valid, size/entry/SHA-256 metadata printed.
- `make export-check` — PASS, including forbidden-entry policy and invalid destination-path regression.

## v1.2.43.2 embedded ChatGPT auth + clean export regression

- Reproduced from the supplied 2026-09-05 18:10 export: `EXPORTS.md` records `ERR_ABORTED (-3)` while loading `https://chatgpt.com/auth/login`, an automatic managed-browser start, another aborted embedded load, and external-auth cancellation. This explains why the native view was hidden while the local pane remained on “A carregar ChatGPT…”.
- Same-origin `/auth/*` redirects now stay embedded, newly-created views default to Embedded mode, and explicit renderer loads use one per-view serialization helper that treats redirect `ERR_ABORTED` as benign while preserving other failures.
- Frontend regression verifies an unauthenticated `/auth/login` state becomes an actionable login notice; Desktop static regression verifies the embedded auth boundary and serialized load path.
- Repository export now excludes `patches/`, nested `.harness`, `.idea`, `.orig/.rej`, and generated Wharness transport/context payloads; `EXPORT_INDEX.md` records inventory/policy and `make export` prints size, entries and SHA-256.
- Required gates: Desktop checks, frontend checks, `make export-check`, full `make check`, build/start/status, then final `make export`.

## v1.2.43 persistent Compose stack / tunnel daemon validation

- Rebased against the supplied post-hotfix export where v1.2.42.5.1 already exists; the distribution therefore does not recreate `SourceProbe`, its regression, or `trycloudflare_archive.go`.
- Go tunnel-daemon client regression verifies decoded provider/publication responses are returned after the authenticated HTTP request and backend shutdown does not send a daemon stop request.
- Backend retains the local tunnel-manager fallback when no daemon URL is configured, while Compose configures the private `http://tunnel:8090` daemon API.
- Lifecycle static gates require `make build-stage` for self-evolution, `--no-recreate database tunnel`, independent backend/frontend rollout, Desktop-only `make stop`, and the one-time PostgreSQL 17 physical migration guard.
- Stack self-evolution regression verifies restart scheduling uses a detached Docker supervisor container; lifecycle checks also require the backend image to carry Make/Go/Node/npm/Docker Compose tooling and require image-level backend/frontend rollback in `stack.sh`.
- Stack migration reuses the existing `.harness/state/postgres.env`, accepts physical PGDATA copy only for PostgreSQL major 17, stops only the checkout-owned legacy database container, and refuses incompatible versions.
- `sh -n` must pass for stack/start/stop/status/orphan/lifecycle scripts; `node --check services/desktop/dev.mjs` must pass.
- `docker compose config`, image builds and actual first-run migration/start remain host gates when a Docker daemon/provider-image network are unavailable in the patch-construction environment.
- Full `make check`, `make build`, `make start`, `make status`, then `make export` remain mandatory in the operator batch.

## v1.2.42.5.1 live-context completeness hotfix validation

- Failure reproduced from the supplied post-apply export: `make check` stopped at `internal/app/service_remote_channel.go` because `contextbundle.SourceProbe` was referenced but its source file was absent.
- Distribution audit against the original v1.2.42.5 change found exactly three omitted new files: `internal/contextbundle/probe.go`, `internal/contextbundle/probe_test.go`, and `internal/remoteinput/trycloudflare_archive.go`.
- The hotfix restores only those missing implementations/tests plus this validation record; no fast-path semantics are changed.
- Required local batch runs focused backend tests, the full `make check`, build/start/status, then finishes with `make export`.

## v1.2.42.5 live-context fast-path validation

- Root cause confirmed in the supplied 2026-09-05 export: the global transport default was still both-on, so Desktop published the live channel and then built/uploaded a ~1.74 MiB request ZIP; the exported desktop log records `attachments=1 ... bytes=1740486`.
- The TryCloudflare provider previously skipped `StartSession` for ephemeral Quick Tunnels, placing tunnel process startup plus public readiness inside the first `PublishChannel` call and therefore inside the visible remote-preparation state.
- Initial live publication previously opened the authoritative context ZIP, decompressed every context entry, wrote one temporary file per content hash, then the provider copied every temporary file again into its private channel directory. Context routes are now snapshot-backed and materialize no per-file copy before the consumer requests one.
- The active-channel 2-second monitor previously called the full context builder unconditionally. It now uses a filesystem-metadata dirty probe and performs a full authoritative rebuild only on detected change or after the bounded 30-second verification interval.
- Local benchmark against the supplied Wharness tree: context snapshot generation fell from 178–184 ms (Deflate, 416 files) to 64–101 ms (Store, 419 files including this patch's new sources). This benchmark isolates snapshot generation; tunnel-start latency is additionally removed from request preparation by session prewarm.
- `GOPROXY=off go test ./internal/contextbundle` — PASS.
- With local compile-only stubs for the two unavailable external modules (`go-qrcode` and the blank-imported pgx stdlib), `go test ./internal/remoteinput ./internal/app ./internal/contextbundle`, `go test -race` for the same packages, and `go vet` for the same packages — PASS. These stubs were used only in a disposable validation copy and are not part of the patch.
- `services/desktop: npm run check` — PASS, 105/105.
- Full backend/frontend gates remain in the application batch and must run on the user's hydrated Wharness checkout before restart.

## v1.2.42.4 Protected host-apply correction-context hotfix validation

- Regression target: `TestFailedCumulativeHostApplyRollsBackPatchesFromThatAttempt` now reaches the intended retained-error assertion when a touched host file diverges before Apply.
- Expected invariant: the stale baseline still blocks before host mutation; the first file remains unchanged and the externally modified file remains untouched.
- Expected correction context: the pending Protected candidate remains queued and `LastRepairError` contains `host apply failed`, so the following planner request includes both `HOST-PENDING PROTECTED CANDIDATE` and `LAST HOST APPLY ERROR`.
- Expected audit behavior: the pre-mutation stale-baseline path emits `host.apply_failed` with `rolled_back_patch_count=0`.
- Full backend `go test` could not be executed in the patch-construction container because the supplied export did not include the `github.com/jackc/pgx/v5` module cache and outbound module download is unavailable there; the application batch below retains `make check` as the authoritative local gate.

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

## v1.2.38.1 — ChatGPT request re-hydration + definitive affinity

Focused validation for this update:

- `npm run check` in `services/desktop` — PASS, 85/85 Node/Electron transport regressions on the current v1.2.38 multi-window baseline.
- New recovery-state tests cover recoverable socket/internet failures, completion-without-bundle reload, silent/stalled reload-then-prompt behavior, bounded transport retries, narrow URL/error classification, and same-request prompt preservation.
- Desktop source regressions verify post-submit conversation binding waits for a stable loaded concrete `/c/...` URL and that expected-bundle polling wires transport/renderer faults into bounded reload/recovery actions.
- Frontend regression `App.affinity.test.ts` verifies definitive affinity candidates are consumed at application level and persisted/confirmed independently of ChatGPT Inspector visibility.
- `git diff --check` — PASS.
- The exported context intentionally excludes frontend `node_modules`, so frontend Vitest/typecheck/lint are retained as Protected verification commands in the execution plan rather than claimed as locally executed here.

## v1.2.39 - Unified Agent workspace validation

- The replacement patch is rebased against the exact host snapshot exported for request `req_20260904T195033_a85a5d52b30d585a`, preserving the concurrently landed multi-window and ChatGPT recovery work.
- Local bundle construction validates the unified diff with `git apply --check` against that exact snapshot and runs `git diff --check` on the generated target.
- The three AgentWorkspace regressions are retained and the ChatPanel auto-scroll feature-detects `scrollIntoView`, addressing the jsdom failure observed in the first repair.
- Focused Vitest, frontend typecheck and lint remain Protected verification gates in the delivery plan.
- No new npm dependency is introduced and no Wharness lifecycle command is part of the plan.

## v1.2.42.3 recovery liveness hotfix validation

- `npm run check` in `services/desktop` — PASS, 105/105 tests.
- Regression: an empty/fault-only recovery probe cannot manufacture `reason=silent` after the silence threshold — PASS.
- Regression: a live allowlisted ChatGPT conversation request suppresses heuristic silent recovery even when a DOM sample briefly reports idle — PASS.
- Regression: `net::ERR_FAILED` remains ignored for unrelated resources but is recoverable for the narrow ChatGPT conversation transport — PASS.
- Static regression: expected-bundle polling uses `faultOnly: true`, tracks per-view conversation request start/end, and passes `transportActive` into the full recovery snapshot — PASS.
## v1.2.43.1 stack session/ChatGPT restore regression

- `scripts/lifecycle-check.sh` requires a v2 PostgreSQL reconciliation fence with conflict-safe logical import.
- Desktop regression coverage forbids eager `CHATGPT_URL` navigation from `createChatGPTView` and requires `show` to tolerate the initial `about:blank` surface while the explicit conversation navigation starts.
- Apply/runtime validation must confirm old session ids remain loadable after `make build`/`make start` and the bound ChatGPT conversation is restored without an initial home-navigation race.
## v1.2.43 operational evidence and bounded terminal recovery

- Reproduced request `req_20260906T105134_885b02fdcfbd2563`: strict stale-base rejection previously escaped `SubmitExecutionBundle` and the subsequent failure endpoint stopped at `failed`; Auto now creates exactly one fresh immutable request and returns it for owning-chat dispatch.
- Reproduced request `req_20260906T110341_b798ad5aa120ecb3`: a valid bundle with retryable `pending_changeset_replay_conflict` previously remained terminal; Auto now records the outcome and prepares one fresh request without executing the failed plan.
- `go vet ./...`, `go test ./...`, `go test -race ./...` — PASS.
- Frontend typecheck, lint, 41 files / 166 tests and production build — PASS.
- Desktop syntax/security/regression suite, 121 tests — PASS.
- Full `make check`, including lifecycle and export isolation checks — PASS.
- `make build && make start` — PASS; backend/frontend images reconciled while PostgreSQL, MinIO and tunnel stayed durable.
- Runtime verification — PASS: coordinator, Electron, backend, frontend, PostgreSQL, MinIO and tunnel healthy; `harness_events` exists and receives records; canonical self-evolution evidence returns HTTP 200 and an ordinary project returns HTTP 403.

## Retained ChangeSet conflict routing and request lineage

- Reproduced the reported `chg_20260906T100741_03c072e89c8ce02a` failure mode with `TestRetainedChangeSetReplayConflictCreatesDedicatedConflictResolutionRequest`: before the fix the session entered generic repair with no `IntegrationConflict`; after the fix it enters `conflict_resolution_pending` with a focused capsule.
- `TestCancelPendingRequestReleasesConversationAndPreservesVerifiedCandidate` verifies cancellation clears the active transport/request while retaining an already verified Protected candidate.
- Frontend regressions verify WHX notification timestamps/request links/cancellation and Main Request grouping across standard, repair, evidence, and conflict iterations.
- `go vet ./...`, `go test ./...`, `go test -race ./...` — PASS.
- Frontend typecheck/lint, 41 files / 168 tests and production build — PASS.
- Desktop syntax/security/regression suite, 121 tests — PASS.
- `git diff --check` — PASS.
- `make build && make start` — PASS; the rebuilt backend is healthy and the frontend container serves the new `index-BOWRExdx.js` / `index-CNA52fZn.css` artifacts.
