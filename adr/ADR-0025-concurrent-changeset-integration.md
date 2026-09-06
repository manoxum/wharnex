# ADR-0025: Concurrent ChangeSet integration

## Status

Accepted on 2026-09-05. Implemented as the normative concurrency model; the remaining cooperative external lease and crash-recovery persistence hardening are optional follow-up defenses, not prerequisites for ChangeSet integration.

## Context

Wharness can run several planning chats for the same project while humans and
external coding agents edit that project directly. The current concurrency
model uses the global managed-context fingerprint as both a context-cache key
and an execution freshness token. This is safe, but too coarse for a busy
workspace.

While a planner request is in flight, its actual write set is not yet known.
The current implementation therefore treats every project mutation as
relevant, creates a replacement baseline request, and may supersede useful work
before its bundle arrives. Once a bundle exists, fast-forward is still limited
to patch-only plans with a provably complete, path-disjoint delta. Command
operations, incomplete notification chains, restart gaps, and external edits
fall back to full-baseline invalidation. Two independent tasks can consequently
force one another into repeated replanning.

A unified diff is useful for transporting a model's proposed change, but it is
not a sufficient concurrency primitive. Applying a diff generated from an old
tree directly to a moving host conflates four different questions:

1. can the proposed result be reconstructed from its original base;
2. did another writer alter the same data;
3. can both results be merged mechanically;
4. is the merged project still semantically correct.

Those questions need separate decisions and error modes.

## Decision proposal

Introduce a deep `ChangeSet Integrator` module. Its external interface accepts
a verified candidate and returns one of `integrated`, `retryable_race`,
`semantic_recheck`, or `conflict`. Snapshot storage, patch reconstruction,
three-way merge, compare-and-swap writes, rollback journaling, and revision
tracking remain hidden in its implementation.

The target model is MVCC at file/blob granularity with an immutable task base
and a short serialized integration window. The global context SHA remains a
cache/provenance identity; it no longer invalidates a candidate merely because
an unrelated file changed.

### 1. Immutable task base

Every planner request references an immutable `base_revision`. Wharness retains
a bounded content-addressed snapshot of the eligible files needed to
reconstruct the request. A task continues against that base even when newer
host revisions appear. A baseline notification is informational while planning
and MUST NOT automatically supersede the request.

### 2. Canonical ChangeSet

The model may continue returning protocol-v1 patches during migration.
Wharness applies those patches only to the immutable base sandbox. After policy
validation and sandbox verification, it materializes a canonical ChangeSet:

- stable task, request, plan, and base revision identities;
- explicit create, modify, delete, and rename mutations;
- for every mutated path, the base blob hash and resulting blob hash;
- content-addressed resulting blobs, not a patch that must fit the moving host;
- an actual write set derived by Wharness, never trusted from `impact_files`;
- declared read dependencies and broad semantic/barrier dependencies;
- verification commands and their result against the task result tree.

`impact_files` remains an early scheduling hint only. It is not an authority for
safe integration.

### 3. Revision journal

For each canonical project root, Wharness maintains a monotonic revision
journal containing the parent revision, observed path/blob delta, source
(`wharness`, `human`, or `external`), completeness, and time. A filesystem
watcher may reduce detection latency, but an authoritative refresh immediately
before integration remains mandatory.

External edits are first-class observed revisions. They do not require a
Wharness session and they do not globally cancel pending tasks.

### 4. Compatibility classification

Under the project integration lock, compare the ChangeSet base with the latest
observed revision:

- No write-set path changed: transplant the result automatically.
- A written file changed: perform a three-way merge using task base, current
  host, and task result.
- The merge is clean: verify the merged tree; do not ask the model to replan.
- The merge conflicts: retain both candidates and produce a compact conflict
  capsule containing only affected paths, hunks, hashes, and relevant task
  intent.
- A declared read dependency changed without a write conflict: classify as a
  semantic recheck. Run targeted verification first and request focused model
  adaptation only if the evidence says it is needed.
- A barrier dependency changed, such as dependency metadata, schemas,
  protocol/SoT files, or build configuration: require the appropriate broader
  verification gate, but do not automatically discard the task.

Path comparison must understand directory deletion and rename ancestry; exact
string equality alone is insufficient. Text starts with Git-compatible
three-way merge semantics. Binary files and delete/modify conflicts require
explicit resolution.

### 5. Staged integration and host safety

Wharness builds the complete merged candidate in an isolated workspace and
runs policy plus verification there before touching the host. Host mutation
remains serialized per canonical project root.

Immediately before each host write, Wharness compares the current blob hash
with the hash observed when the candidate was staged. Writes use temporary
files and atomic rename where supported. The transaction journal records
preimages and produced hashes.

Writers outside Wharness cannot be made strictly serializable unless they
cooperate. Wharness therefore offers an advisory project lease for Codex,
Claude, IDE hooks, and other Wharness instances, while retaining compare-and-
swap protection for uncooperative writers. A race causes a bounded restage;
Wharness never overwrites an unexpected external value. Rollback restores a
preimage only when the current hash still equals the value written by
Wharness; otherwise it stops and reports the externally changed path.

### 6. Project execution and integration queues

Planning and ChatGPT transport remain parallel. All sandbox/host plan execution
is admitted through one FIFO scheduler per canonical project root, preventing
two plans from executing concurrently against the same moving project. The
scheduler re-reads and revalidates the session after admission so a waiting
plan cannot bypass a terminal/obsolete state created ahead of it. Independent
projects retain parallelism. The host integration phase remains protected by
its shorter per-project integration lock. Each project exposes queue lifecycle
events with:

- task and chat identity;
- base and current revisions;
- actual write set;
- advisory scope overlap;
- state (`planning`, `verified`, `merging`, `checking`, `integrated`, or
  `conflict`);
- reason for any user or model intervention.

The Agent projects those lifecycle events into a permanently discoverable FIFO
drawer. An empty queue is an explicit healthy state; queued and running entries
show their owning chat, plan and deterministic position. This view is not a
second scheduler and cannot mutate queue ordering.

An overlapping planning scope remains a warning, not a planning lock. Verified
tasks touching one file can still complete through three-way merge, but their
actual execution is deterministically ordered for operational stability.

### 7. Failure-domain separation

Concurrency, protocol, policy, transport, merge, and verification failures are
distinct terminal or retryable outcomes. A policy denial such as a sensitive
path MUST NOT be presented as a concurrency failure or trigger baseline
ping-pong. It receives a focused policy repair flow. Transport retry resends the
same request identity; it does not create a new baseline generation.

A conflict discovered while replaying an earlier retained ChangeSet into a
new execution sandbox is an integration conflict, even though it occurs before
the new plan's operations begin. The application preserves the integrator's
structured conflict details and opens the same focused BASE/CURRENT/RESULT
resolution path. Flattening that outcome into a generic execution error would
make every replacement plan replay the same blocker and is therefore forbidden.

## Module seam

The application orchestration depends on one interface conceptually equivalent
to:

```text
Stage(base_revision, verified_plan) -> ChangeSet
Integrate(project, changeset) -> IntegrationOutcome
Resolve(conflict_id, resolution) -> IntegrationOutcome
```

The interface does not expose Git commands, patch mechanics, filesystem watch
events, or storage paths. Protected and self-evolution flows call the same
interface with different policy and activation adapters. The AI/planner never
executes or integrates changes directly.

## Migration

### Phase 0: stop unnecessary supersession

- Keep in-flight requests alive when another chat changes the project.
- Record notices without creating a replacement request until the actual
  ChangeSet is known.
- At bundle arrival, classify compatibility from the actual write set.
- Separate policy-denied bundles from concurrency repair.

This removes the largest source of ping-pong without changing the external
bundle schema.

### Phase 1: internal ChangeSet materialization

- Add content-addressed snapshot/blob storage with retention limits.
- Convert existing protocol-v1 patches into ChangeSets by applying them to the
  exact request base.
- Replace global-hash fast-forward decisions with per-path blob comparison.
- Preserve protocol v1 as an input adapter.

### Phase 2: three-way integration

- Add deterministic text merge and structured conflict capsules.
- Restage and reverify clean merges on the current project revision.
- Add CAS writes, transaction journaling, and race-safe rollback.

### Phase 3: semantic dependencies and coordination

- Add read-set/barrier declarations to a versioned protocol extension.
- Add targeted versus full verification selection.
- Expose advisory scopes and the integration queue in the UI.
- Provide optional cooperative lease hooks for external coding agents.

### Phase 4: hardening

- Exercise crash recovery between every transaction step.
- Add retention/garbage collection for snapshots, blobs, journals, and conflict
  capsules.
- Measure avoidable replans, clean-merge rate, conflict rate, integration
  latency, CAS retries, and externally raced paths.

## Required tests

- Four or more tasks based on the same revision and writing disjoint files all
  integrate without replanning.
- Two tasks modifying disjoint hunks of one text file merge and verify.
- True same-hunk conflicts preserve both results and produce one focused
  conflict flow, not repeated global replanning.
- Human and external-agent changes are observed as revisions and do not cancel
  unrelated tasks.
- A dependency/barrier change selects the correct verification scope.
- A write racing after staging fails CAS and restages without data loss.
- Crash recovery never leaves a partially owned transaction silently applied.
- Rollback never overwrites a value changed externally after Wharness wrote.
- Sensitive-path denial stays a policy outcome and never enters concurrency
  adaptation.
- Existing protocol-v1 bundles remain compatible through the input adapter.

## Success criteria

- At least 95% of path-disjoint concurrent candidates integrate with zero
  additional model turns.
- Clean same-file merges require zero additional model turns when verification
  passes.
- No known external edit is overwritten by Apply or rollback.
- Baseline-update model turns fall substantially and cannot form an unbounded
  request loop.
- Integration decisions are reproducible from stored revisions, hashes,
  ChangeSets, and verification evidence.

## Rejected alternatives

### Global context hash as a write lock

Safe but unnecessarily serializes unrelated work and is the source of the
current replanning churn.

### Mandatory path leases before planning

Forecasts are incomplete, refactors expand scope, and external tools bypass the
lease. Leases are useful as advisory coordination only.

### Apply stale patches directly and rely on patch fuzz

Fuzz may place a hunk in the wrong semantic location and provides no durable
base/current/result evidence.

### One Git branch in the host repository per chat

This leaks orchestration into the user's repository, interacts badly with a
dirty worktree and external agents, and violates the desired separation from
host Git history. Internal temporary Git repositories may implement merge
mechanics behind the ChangeSet Integrator seam.

### CRDTs for source trees

They help concurrent text editing but do not model file operations, generated
artifacts, build semantics, or repository-wide invariants sufficiently for
agent-produced code changes.

## Compatibility and security

This proposal preserves Protected-by-default execution, isolated project
copies, argv-only commands, Policy Engine approval, root containment, secret
path denial, symlink denial, and explicit host Apply. It does not authorize
external tools to mutate through Wharness and does not grant planners access to
host Git or runtime internals.

The decision amends the execution, context, protocol, sandbox, security, UI,
and quality-gate Sources of Truth. Protocol-v1 remains wire-compatible through
optional dependency declarations; `harness.conflict/v1` is generated only by
Wharness for focused support turns.
