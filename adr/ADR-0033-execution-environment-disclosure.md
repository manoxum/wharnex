# ADR-0033 — Execution environment disclosure and infrastructure-fault isolation

## Status

Accepted.

## Context

An audit of the persisted `harness_events` history across both local checkouts (roughly 3 400 recorded failure rows) showed that most lost requests were not model defects at all. Ranked by occurrence, the recurring terminal causes were:

1. an unresolvable offline Go build list (already classified, `offline_go_module_cache`);
2. a downloaded response bundle whose request/chat was no longer the surface's active one;
3. a plan proposing an executable that either does not exist in the runner image (`jq`, exit 127) or is denied by policy (`python3`);
4. `timeout_seconds` outside the accepted range, which rejected the whole bundle including a correct patch — twice consecutively in one session;
5. the sandbox exhausting a machine resource mid-verification (`go test -race ./...` overflowing the 512 MiB `/tmp` tmpfs with `no space left on device`), then consuming repair rounds that could never succeed;
6. auxiliary bookkeeping failures — the artifact object store reporting `XMinioStorageFull`, or a knowledge candidate whose `base_revision` a peer chat had superseded — rejecting an otherwise complete verified change;
7. replaying a pending Git-native candidate into a sandbox rebuilt from an immutable archived request base, which fails with `fatal: refusing to merge unrelated histories` because the two histories genuinely share no ancestor.

Causes 3, 4 and 5 have one shared root: **the planner cannot see the environment it is planning for.** It receives project source and a protocol contract, but nothing about which executables exist, which are denied, what the numeric budgets are, or how much memory and disk the verification it proposes may consume. Every such plan is a guess, and each wrong guess costs a full ChatGPT round trip.

Causes 5, 6 and 7 share a second root: **Wharness treated infrastructure and bookkeeping faults as model defects.** A device-full linker error, a full object store, and a catalog revision race were each surfaced as ordinary failures, so a bounded AI repair loop was spent on conditions no source patch can address — and in cases 6 and 7 the verified work itself was discarded.

## Decision

### 1. The request bundle discloses the measured execution environment

`internal/sandboxenv` measures and publishes a `wharness.environment/v1` document in every planner prompt, as a `LOCAL EXECUTION ENVIRONMENT` section with an accompanying usage contract in the system protocol. It carries:

- **host**: OS release, kernel, architecture, CPU count, total and available memory, and free/total space for both the project filesystem and the scratch filesystem sandbox workspaces are created on;
- **sandbox**: image, mode, workspace path, default network state, read-only root, and the container's real memory/CPU/pids/tmpfs limits and cache environment;
- **tools**: the runner image's own executable inventory with real versions, obtained by running a `kernl-toolchain` entrypoint baked into the image, so the image describes itself instead of Wharness maintaining a list that drifts from the Dockerfile;
- **policy**: the policy engine's own denied/elevated executable sets and git subcommand rules, read from the engine rather than restated;
- **budgets**: the protocol validator's own numeric limits, read from the validator's named constants.

The manifest is descriptive only. It grants nothing: policy, protocol validation and the runner remain the sole enforcement points. Measurement is best-effort and time-bounded — an unreachable Docker daemon degrades the section to a warning and never delays or fails a request.

### 2. Infrastructure faults are classified and never enter the repair loop

Two classifications join the existing set:

- `sandbox_resource_exhausted` — the container ran out of disk, memory or file descriptors, detected from real command output rather than from planner text;
- `artifact_storage_full` — the local object store refused a write for lack of space.

Both follow the rule already established for `offline_go_module_cache`: recovery is host-side, and no automatic ChatGPT source-repair round is spent on them.

A missing executable remains repairable — the planner genuinely can pick another tool — but the repair prompt now names it as the root cause explicitly, instead of handing over raw output that invites re-reading the source.

### 3. Auxiliary payloads never invalidate an executable one

Archiving the response bundle and staging its knowledge candidate are bookkeeping performed alongside a verified result. Neither may reject the bundle. Both now record a structured degradation event and continue. A knowledge candidate whose `base_revision` was superseded by a peer chat is refused as a distinguishable concurrency outcome (`concurrent_catalog_revision`), never as a protocol defect — applying a stale `replace` would delete entries the planner never saw, but discarding the change with it was strictly worse.

### 4. Transport mistakes in command budgets are normalized, not fatal

A `timeout_seconds` that is missing, zero, negative or above the ceiling is repaired to the documented default or clamped to the ceiling, and the adjustment is recorded. This stays inside the existing narrow manual-transport normalization rule: it touches no argv, path, exit code, network flag or any other security-relevant field, and the normalized plan still passes `protocol.Validate` unchanged. The accepted range is published in the environment manifest so the repair is a safety net rather than the primary mechanism.

### 5. Candidate replay without shared Git ancestry uses the commit's own diff

A verification sandbox rebuilt from an immutable archived request base has a synthetic root commit and no ancestor in common with the host, so merging a pending candidate's integration branch into it is impossible by construction. Such a candidate is replayed as the diff of its own verified commit (still present in the host's object database) through the normal patch strategy. A candidate whose commit the host no longer holds downgrades to the plan's recorded patches. The merge path is unchanged wherever real shared ancestry exists.

### 6. Host-facing serialization is narrowed to the host-facing write

Pushing a verified integration branch into the host's `.git` is the only host mutation in the verification phase; it is now taken under the project apply lock directly. Per-project execution concurrency becomes an operator knob (`WHARNESS_PROJECT_EXECUTION_CONCURRENCY`) that defaults to the historical value of 1, because each additional concurrent runner claims a full container memory allowance plus a complete project clone — and this ADR exists partly because exhausting those resources is itself an unrepairable failure.

### 7. The sandbox stops running out of scratch space

`GOCACHE` moves from the size-capped `/tmp` tmpfs to the workspace volume alongside `GOMODCACHE`, so a race-instrumented build is bounded by host disk rather than by tmpfs size. Default container limits rise to 4 GB memory, 512 pids and a 1 GB tmpfs, each overridable per machine. The runner image additionally ships `jq`, `ripgrep`, `patch`, `diffutils`, `unzip`, `zip`, `xz-utils`, `file`, `tree` and `pkg-config` — non-privileged utilities that real plans asked for. Network clients stay absent: the runner has no network by default and those executables are denied by policy regardless.

## Consequences

- Every planner request grows by a bounded structured document (single-digit kilobytes) and gains the information needed to avoid the three most common self-inflicted rejections.
- The runner image must be rebuilt (`make build-runner`) for the new toolchain and the self-describing inventory; until then the environment section degrades to a warning naming the safe assumption.
- Failure classification remains Wharness-derived. A planner-supplied `reason_code` may map onto the new kinds, but only through the existing hand-reviewed allowlist.
- `python3` stays denied for model plans. The change is that the denial is now discoverable in advance rather than only through a blocked plan; relaxing it would be a separate security decision.
