# Sandbox Model SoT

`Protected` is the default per-project Agent execution mode and uses Docker.

Required controls:

- no original project bind mount;
- isolated copied workspace mounted read-write;
- root filesystem read-only;
- `/tmp` tmpfs with explicit `exec` (plus `nosuid,nodev`) so language test runners such as `go test` can execute binaries compiled into the temporary filesystem;
- `--cap-drop ALL`;
- `no-new-privileges`;
- pids/memory/CPU limits, exported as `sandbox.RunnerLimits` and overridable per machine through `WHARNESS_RUNNER_MEMORY`, `WHARNESS_RUNNER_CPUS`, `WHARNESS_RUNNER_PIDS` and `WHARNESS_RUNNER_TMPFS` (defaults 4g / 2 / 512 / 1g);
- `GOCACHE` MUST live on the workspace volume (`/workspace/.kernl/go-build`) alongside `GOMODCACHE`, never on the `/tmp` tmpfs: a race-instrumented build of a large module writes far more object cache than any reasonable tmpfs size, and overflowing it fails the request with `no space left on device` — an infrastructure fault the repair loop cannot fix (see `SoT/ERROR_MODEL.md`, `sandbox_resource_exhausted`);
- network `none` by default;
- no Docker socket;
- non-root host UID/GID when possible.
- the canonical application lifecycle is Docker-backed: `make build-stage` MAY build backend/frontend/tunnel service images without replacing the running stack; `make build` MAY reconcile application service containers after staging. The Protected runner image remains a separate explicit `make build-runner` action and MUST NOT be implicitly rebuilt by either target.
- the containerized backend MAY mount the host Docker socket because it owns the trusted sandbox adapter, but it MUST preserve host-visible canonical workspace/bridge paths when asking the host daemon to create runner containers. The runner itself MUST NEVER receive the Docker socket.
- `make stop` MUST stop only the host Desktop/coordinator. PostgreSQL and tunnel infrastructure are persistent stack services and may be stopped only by explicit stack lifecycle commands.
- on Linux/systemd, Protected execution MUST fail closed when `docker.socket` is active but `docker.service` is stopped, rather than triggering socket activation that can recreate host bridges/routes while the desktop browser is online.
- on Linux, the Electron desktop MUST NOT depend on privileged metadata inside project `node_modules`. The primary SUID launch path is a versioned, root-owned, non-user-writable Electron runtime outside the workspace (default `/opt/wharness/electron/<version>-linux-<arch>/`) whose complete distribution and root-owned checksum manifest are validated before launch; only that runtime's adjacent `chrome-sandbox` may be mode `4755`. `npm install`, `npm ci`, normal builds and worktree changes MUST NOT mutate that privileged runtime. A version change requires explicit runtime synchronization. If no matching runtime exists, Wharness MAY use the workspace Electron only after an actual unprivileged user-namespace probe succeeds and only with `--disable-setuid-sandbox`; `--no-sandbox` remains forbidden.

Local sandbox exists only for tests/development and must require explicit opt-in.

## Verification workspace baseline (v1.3.2)

A verification sandbox is a real local clone of the host repository, so it
carries the host's actual commit history. Populating its working tree from the
host's *current* files leaves that tree ahead of the base a pending plan's patch
was written against — and leaves the sandbox's index inconsistent with its
working tree, which also disables `git apply --3way`.

For a Protected `change` plan with an anchored request base (see
`SoT/EXECUTION_MODEL.md`), the workspace is therefore repointed at that base
before any operation runs: the request's base ref is fetched from the host by
absolute path — a local clone negotiates `refs/heads/*` only, so the ref does
not arrive with the clone even though its object does — and the integration
branch is checked out there. `git clean` runs without `-x`, so lazily hydrated
gitignored dependency trees (`node_modules`, the private Go module cache)
survive and are not copied again.

Pending candidates replayed into that workspace are merged onto the same base
branch, so a sequential build of compatible changes chains correctly instead of
each candidate being rooted independently.

A workspace rebuilt from an immutable archived request base has a synthetic root
commit and no ancestry in common with the host. It keeps the legacy
`ChangeSet` path unchanged, because there is nothing to branch or merge onto.

## Host repository shape and dirty-worktree integration (v1.3.3)

The host project's repository shape is measured, never assumed (see
`adr/ADR-0039`). `internal/hostrepo` resolves the repository's real Git
directory — `.git` is a *file* in a linked worktree and in a project root that
is itself a submodule — reads the submodule inventory from the index, detects
an in-progress merge/rebase/cherry-pick/am from Git's own marker files, and
classifies uncommitted state by what Git can actually capture.

That classification is the contract. `git status` reporting a path as modified
does not mean `git add -A` will stage it: dirty submodule content belongs to
another repository, and an untracked embedded repository stages only as a bare
gitlink. Consequently:

- Preserving the operator's uncommitted work before an integration succeeds
  when there is nothing a superproject commit can hold, rather than failing on
  `no changes added to commit`.
- Embedded repositories are excluded from every Wharnex-authored commit and
  reported as left in place, so no commit claims to preserve files it holds
  only a pointer to.
- Unresolved paths, an in-progress Git operation, and an integration that would
  move a dirty submodule's recorded commit are **refused**, carrying the reason,
  the paths and the operator's remedy (`host_working_state_blocked`, see
  `SoT/ERROR_MODEL.md`). The verified candidate is retained and no repair round
  is consumed.
- Commits and merges Wharnex makes on a host use the fixed non-human identity
  with signing and project hooks disabled; a project's own `pre-commit` gate
  has no authority over Wharnex plumbing.
- A merge or revert that moves a submodule's recorded commit realigns that
  submodule's checkout, which Git does not do. Realignment is offline and never
  touches a submodule holding uncommitted work; skips are reported.

A patch writing inside a registered submodule is rejected at ingestion: the
superproject's index holds a single gitlink there, so the path cannot be
staged, committed or merged, and no planner repair can change that. A project
Wharnex cannot inspect is admitted unchanged — a measurement failure never
rejects a legitimate change.

## Runner toolchain and environment disclosure

The runner image ships the language toolchains (Go, Node with corepack), build drivers (`make`, `build-essential`, `pkg-config`), source control and patching (`git`, `patch`, `diffutils`), structured-data and search utilities (`jq`, `ripgrep`), and archive/inspection utilities (`unzip`, `zip`, `xz-utils`, `file`, `tree`). Network clients (`curl`, `wget`, `ssh`, `nc`) MUST remain absent: the runner has no network by default and those executables are denied by policy regardless.

The image MUST describe its own inventory through a `kernl-toolchain` entrypoint that prints `{"tools":[{"name","version","path"}]}`. Wharness MUST read the inventory from the image rather than maintaining a parallel list, so adding a tool to the Dockerfile is the only step needed to make it visible to the planner.

Every planner request MUST carry a Wharness-measured `wharness.environment/v1` manifest (`internal/sandboxenv`) describing the host (OS, kernel, arch, CPUs, total/available memory, free space on the project and sandbox-scratch filesystems), the container's real limits and cache environment, the runner image's tool inventory, the policy engine's own denied/elevated/git decision sets, and the protocol validator's own numeric budgets. Policy and budget values MUST be read from the engine and validator, never restated, so the published contract cannot drift from the enforced one.

The manifest is descriptive only: it grants no capability, and policy, protocol validation and the runner remain the enforcement points. Measurement is best-effort and time-bounded — an unreachable Docker daemon or unreadable `/proc` MUST degrade the section to a warning and MUST NOT delay or fail the request.

When the host project is an existing Git repository, sandbox project copies are a real local clone of it (`git clone --local --no-hardlinks`), sharing the host's actual commit history rather than a synthetic baseline; only when no repository exists yet does the copy initialize a fresh temporary Git repository with a synthetic baseline commit. Either way the host's own `.git` directory itself is never copied byte-for-byte into the workspace. A source is treated as an existing Git repository only when that exact source directory is the repository top-level. Git discovery through an ancestor MUST NOT cause an extracted immutable base or other internal directory beneath `.harness/bridge` to be cloned as though it owned the ancestor repository. A freshly cloned sandbox's remotes are reconciled to mirror the real project's configured remotes; fetching a specific branch back out of the host later MUST address the host path explicitly rather than relying on a remote-tracking ref that reconciliation may have removed.

Concurrent Protected work integrates the verified sandbox candidate into the host with real Git, not a virtual merge: once a plan's sandbox verification succeeds, WHX commits the applied patch onto a dedicated branch (`whx/<request_id>`, fixed non-human author, message = the plan's `commit_message` plus `Request-Id`/`Plan-Id` trailers) inside that same cloned sandbox, then pushes that branch locally (never a network remote, never the operator's own `origin`) into the host's own `.git`. Apply performs an actual `git merge --no-ff --no-edit` of that branch into whatever the host currently has checked out — Git's own three-way merge, not a custom text merge — reruns the plan's verification commands against the merged result, and on failure reverts the host with `git reset --hard` to its exact pre-merge commit. A planner-resolvable merge conflict aborts and is routed to the `harness.conflict/v1` capsule (see `AI_PROTOCOL.md`), sourced via `git show` against the conflict's merge-base/host/branch commits. The exception is `.wharnex/knowledge/**`: it is Wharnex-managed state transported outside planner patches, so a managed-only collision is resolved locally by preserving the exact pre-merge host version; mixed conflicts retain only ordinary paths for planner reconciliation. The integration branch is deleted after a successful merge + verification; the merge commit itself remains in the host's log regardless. Neither stage mutates the original project ahead of that final, serialized host merge.

One case falls back to the pre-Git-native mechanism: a candidate reconciled from an immutable archived request base (the host baseline advanced past what the candidate can fast-forward onto, but its exact archived context is still retained) has no Git ancestry in common with the live host at all — there is nothing to branch or merge onto. That case is still materialized as a canonical base/result `ChangeSet` and integrated via per-file compare-and-swap exactly as before.

That same absence of shared ancestry also governs how earlier pending candidates are *replayed* into such a sandbox. Fetching a pending candidate's integration branch into a workspace whose root commit is synthetic and merging it fails with `fatal: refusing to merge unrelated histories`, which is not a conflict and cannot be resolved. When the verification sandbox does not share Git ancestry with the host, a pending Git-native candidate MUST be replayed as the diff of its own verified commit — still present in the host's object database from its original push — applied through the normal patch strategy. A candidate whose commit the host no longer holds downgrades to the plan's recorded patches and publishes `integration.branch_replay_downgraded`. Wherever real shared ancestry exists, the branch merge remains the required path, because only a real merge lets the new candidate's commit descend from the earlier one.

Pushing a verified integration branch into the host's `.git` is the only host-facing mutation in the verification phase, and it alone is serialized per project under the project apply lock. Per-project execution concurrency is an operator knob (`WHARNESS_PROJECT_EXECUTION_CONCURRENCY`, default 1, maximum 8): each additional concurrent runner claims a full container memory allowance plus a complete project clone, so raising it on a small machine trades queueing delay for the resource-exhaustion failures this model classifies as unrepairable.

Node dependency hydration is execution-only. `node_modules` MUST remain excluded from context/model payloads and from the initial sandbox snapshot. For Protected Node package scripts that require local dependencies, the runner MAY lazily copy an existing project-local `node_modules` tree into the temporary sandbox. A sandbox reconstructed from an immutable request base MUST retain the original project root solely as this dependency source; it MUST NOT search for dependencies inside the partial historical archive. It MUST NOT mount the host project or dependency tree into the container. Internal dependency symlinks may be rewritten to their copied sandbox targets; any dependency symlink that escapes the project root MUST be rejected.

Go dependency hydration is likewise execution-only and offline by default. Before a Protected `go build`, `go test`, `go vet`, `go run`, `go list`, or `go install`, Wharness inventories the exact module versions already present first in its Wharness-owned, per-project persistent module cache and then, as a compatibility source, in the host Go module cache, always with `GOPROXY=off`. It copies only those module directories plus their authenticated cache metadata into private sandbox storage and runs the container against that copied cache with `GOPROXY=off`. Missing modules fail before verification as `offline sandbox dependencies unavailable`. They MUST NOT be misclassified as patch/ChangeSet failure or trigger an automatic ChatGPT repair request.

That local failure MAY expose a prominent human approval action. Approval grants network only to the eligible Go build/dependency/verification argv commands retained in that failed Protected plan. The approved command resolves modules into `.kernl/go-mod` inside the isolated copied workspace; successful hydration marks that execution cache ready and copies its immutable module/cache entries into Wharness-owned application storage keyed by canonical project. Later executions validate their current build list against that persistent cache before copying it into a fresh sandbox, so one approval is not lost when the temporary workspace is cleaned. Later non-approved commands continue with `GOPROXY=off`. It MUST NOT enable arbitrary shell/package commands, mutate or mount the host module cache, mount the original project, expose the Docker socket, or weaken the runner's capabilities, user, resource and `no-new-privileges` controls.

### Host dependency state repair (npm optional-dependency defect)

A distinct host-only failure class (`domain.FailureKindHostDependencyState`) occurs after a candidate already passed Protected verification: the post-merge host build fails because a platform-specific npm optional/native binding never installed correctly under the host's own `node_modules` (the npm optional-dependencies bug tracked as npm/cli#4828, first observed with `rolldown`'s native binding). No source patch can repair host package-manager state, so — exactly like the Go case above — this MUST NOT spend an automatic ChatGPT repair round.

Unlike the Go case, Wharness does not grant network to a plan-supplied command; it offers a fixed, hand-reviewed recovery recipe (`RetryHostDependencyRepair`) that is never planner-supplied and never accepts planner-proposed commands:

1. `rm -rf node_modules`
2. `rm -f package-lock.json`
3. `npm install` (the only command in the recipe with network access — this is exactly what human approval grants)

Each command runs directly against the host project directory (never the sandbox) through the same host runner and policy profile as the interactive Host terminal (`Engine.EvaluateInteractiveCommand`, AGENTS.md §7) — argv-only, no shell, no `sudo`/privilege escalation, no host-management primitives. The recipe's working directory is derived only from Wharness's own verified pending plan data (the failing `npm`/`npx`/`node` verification command's `cwd`), never from planner text. After the recipe succeeds, Wharness reruns the exact verification commands that failed post-merge; if they now pass, the failure classification is cleared and Apply is retried automatically. If they still fail, the (now-inapplicable) `host_dependency_state` label is cleared and the concrete new error is surfaced instead of re-blocking under a stale reason — this recovery never loops or spends more than one attempt per approval.

This recipe is closed and specific to the diagnosed npm optional-dependency defect. A host-only failure that Wharness cannot recognize still blocks with only a manual notice, exactly as before.

## Unprotected exception

A workspace may be explicitly switched to `Unprotected` in the UI. This is not a sandbox variant: Agent plan operations execute directly in the real project directory. The Policy Engine remains mandatory and each direct execution requires user confirmation. The UI must display a persistent host-direct warning while the mode is active. This choice is stored per project and must never become the global/default mode.

The Editor interactive terminal is independent of Agent execution mode. Its default target is the sandbox. A human may explicitly select `Host`; that target executes argv directly in the real project through the same host runner used for controlled host execution, requires an explicit UI confirmation, remains Policy Engine constrained, and must show a persistent host-direct warning. Selecting Agent Unprotected MUST NOT switch the terminal target automatically.
