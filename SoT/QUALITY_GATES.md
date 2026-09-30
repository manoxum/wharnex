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
- Browser-agent project scoping MUST be proven at the store, not only in the UI: enqueue resolves the canonical project path from a supplied absolute path, from the task's own workspace chat and from its session, and discards a non-path value; a scoped claim refuses a closed project's request-bound work, admits an open project's, admits unattributed work, and still admits account-lifecycle work whatever is open; an unscoped claim keeps its previous behavior; and an unusable project filter fails closed on both the list and the aggregate rather than widening to the whole account.
- Frontend tests MUST prove both project-scoped reads carry the project, that the task panel reports other projects only as a count, and that the agents panel marks and names an agent occupied with another project's task while leaving this project's own work unmarked.

## G5 Build

Canonical operator build command: `make build`. It must:

- resolve/install development dependencies needed by quality gates/Desktop;
- build the compatibility Go/frontend artifacts and validate the Electron desktop runtime;
- build backend, frontend and tunnel Compose images;
- build the configured local Protected runner image;
- install or byte-verify the Linux `up-whx-link` dedicated namespace helper
  and exact-path AppArmor profile when the host enables AppArmor's
  unprivileged-user-namespace restriction; check that the required host `pasta`,
  `ip` and `mount` tools are available with actionable package guidance; never
  disable that restriction;
- reconcile backend/frontend containers while preserving existing PostgreSQL/tunnel containers.
- after the replacement backend is healthy, reclaim only ownership-proven obsolete
  temporary workspaces, context directories and unreachable project dependency
  caches; persisted sessions, request history, current context bases, artifacts
  and live sandboxes MUST remain untouched.
- then reclaim, on the host, what the backend cannot see: settled self-evolution
  transaction directories beyond the retention window, oversized lifecycle logs,
  and Docker layers/build cache unused for that same window. Valid fingerprinted
  dependency and compiled-artifact caches MUST survive — reclamation is
  obsolescence-proven, never a cache wipe — and the immediately previous image
  generation MUST survive so the rollout keeps its image-level rollback path.
  This stage is housekeeping: it reports what it could not reclaim and MUST NOT
  fail the build.

`make install-dev` and the `make start` path that rebuilds a stale checkout reach
the same reclamation because they run `make build`. `WHARNESS_RECLAIM_KEEP_HOURS`
sets the retention window, `WHARNESS_RECLAIM_DOCKER=0` disables the Docker stage,
and `WHARNESS_RECLAIM_VOLUMES=1` opts into reclaiming orphaned anonymous volumes;
named volumes are unreachable from that sweep by construction.

`make build-stage` performs application artifact/image staging but MUST NOT replace running services or rebuild the Protected runner, and it is the only build target used by transactional self-evolution. The operator-facing `make build` MUST invoke the runner build with the configured `RUNNER_IMAGE`; `make build-runner` remains available as a direct recovery target.

The checkout-scoped lifecycle lock used by build, activation, rollback and teardown MUST remain bounded and MUST work in both the host util-linux environment and the Alpine/BusyBox backend container that executes self-evolution staging. Portable non-blocking acquisition with a bounded retry loop is required; util-linux-only `flock` flags are forbidden on this path.

## G6 Security

Recommended CI additions: `gosec`, `govulncheck`, `npm audit`, Trivy, secret scanning.

## G7 E2E

Playwright session/bootstrap/manual-plan workflow plus Docker executor tests where Docker is available.


## G8 Desktop shell

- `node --check` for Electron main/preload/dev launcher.
- `node --test services/desktop/security/security.test.mjs`.
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

The OS launcher MUST stage a source-change build before stopping the current Desktop. A failed build MUST leave the previous Desktop and Compose services available. If a successful build was previously recorded, the launcher MAY start that available runtime without marking the changed source as built; the next launch must retry the update. First installs without a previous successful build fail with the build error. Direct `make start` for a stopped Desktop still requires a current build unless the launcher explicitly selects this recovery path.

Normal `make build`/`make start` MUST use `--no-recreate` for PostgreSQL and tunnel containers. Backend/frontend may roll independently with `--no-deps`; this preserves active temporary tunnel base URLs across application restart/self-evolution. First stack initialization migrates compatible PostgreSQL 17 data from the former checkout-owned PGDATA into the named volume before the new database starts. A distinct logical reconciliation marker MUST repair skipped/partial first migrations by idempotently merging the legacy PostgreSQL rows after the Compose database becomes healthy and verifying session counts before backend activation.
Stack self-evolution MUST NOT execute its restart worker inside the backend container that will be replaced. The backend image MUST contain the local build/control toolchain required by `make build-stage`, and activation MUST be delegated to a detached supervisor container. Application rollout MUST retain the previous backend/frontend image IDs long enough to restore them on failed health checks; tunnel/database containers remain excluded from that rollback boundary.

Runtime state belongs under `.harness/` and must never be committed. Creating,
cloning, or opening a project MUST ensure its root `.gitignore` contains
`/.harness/` before any Wharnex baseline commit. If runtime files are already
tracked, Wharnex MUST remove them from the Git index without deleting their
working-tree copies; the staged removal then travels with the project's next
commit. Ignore repair MUST preserve existing rules and be idempotent.

## G10 Orchestrator

- Unit tests MUST cover proposal/DAG validation, cycle rejection and readiness across plan approval/dependency completion.
- Backend transitions MUST reject unknown states, direct entry into `DOING`, and manual movement of a task whose Agent run is active.
- Project integration tests SHOULD cover durable Plan/Task/dependency/TaskRun round-trips against PostgreSQL when the Docker-managed test database is available.
- Frontend tests MUST keep Orchestrator available as a first-class workspace mode and SHOULD cover draft approval, manual planner import, task creation and the four task projections.
- Manual-adapter proposal tests MUST prove the objective becomes a durable highest-priority Worker request, remains visible in Overview across remount/restart, and imports only an exact bounded `harness.orchestrator-plan/v1` JSON artifact.
- A task Start regression MUST prove it delegates to the normal Agent execution path and that a second `DOING` task in the same project is refused; it MUST NOT introduce a direct command-execution seam.

## G11 File size and module boundaries

- `scripts/check-file-size.sh` (`make file-size-check`) reports every new,
  extension-matched, non-exempt file over 200 lines against a base ref, per
  `SoT/CODE_QUALITY.md` and `adr/ADR-0066`.
- Not currently invoked by `scripts/quality-gates.sh` or CI — run manually
  until deliberately promoted to a blocking gate. Reviewers enforce the
  extract-on-touch rule for legacy oversized files by inspection, since that
  rule is not mechanically checkable.

## G12 Database identities and migration

- Run `go test ./internal/dbidentity -count=1` from `services/backend` with
  `WHARNESS_TEST_DATABASE_URL` set to a disposable PostgreSQL 17 database.
  `scripts/quality-gates.sh` executes this gate when that URL is configured;
  set `WHARNEX_REQUIRE_DATABASE_GATE=1` to make an absent URL fail, as required
  in CI and release jobs that change this contract.
- With a PostgreSQL test database configured, a catalog integration test MUST
  initialize the legacy schema, apply the shared identity migration twice, and
  assert every project-owned base table has `id bigint` as its sole identity
  primary key, and non-null unique `sid text` and `uid uuid` columns. Every
  declared relational foreign key MUST use `bigint` and target an `id` key.
- Seeded legacy data MUST keep its former string key as `sid`; repeated migration
  MUST preserve `id`, `sid`, `uid`, row counts and numeric relationships. The
  gate MUST reject collisions, missing required references and incomplete prior upgrades
  rather than repairing them through data loss or weakened assertions.
- Persistence tests MUST prove relationship lookup and joins use numeric IDs;
  transport tests MUST prove callers can use `sid` or `uid` and cannot supply a
  numeric database ID as a record identifier. Newly introduced reference columns
  and endpoints MUST add focused regression tests at those boundaries.
- CI and releases that modify schema, persistence or backend identity contracts
  MUST run this gate against PostgreSQL. A local run without a configured test
  database MAY report the integration portion as skipped, but that skipped run
  does not satisfy the release gate.

## G13 Domain-owned source layout

- `make domain-layout-check` validates every newly added implementation and
  test file since the parent of the ADR-0085 adoption commit (or
  `WHARNEX_DOMAIN_LAYOUT_BASE`),
  staged addition, and untracked file against
  `SoT/PROJECT_STRUCTURE.md`. It runs as part of `make check` and
  `scripts/quality-gates.sh`.
- The gate permits only named service domains and documented runtime entry
  points. It also rejects a new or relocated source/test file when its owning
  directory would exceed 20 such files; `SoT/PROJECT_STRUCTURE.md` requires a
  semantic subdomain then. Reviewers verify actual ownership and
  extract-on-touch for legacy flat files, which path checks alone cannot
  determine.
