# ADR-0077: Candidates integrate three-way from their own request base

**Status:** Accepted (2026-09-25). Completes `adr/ADR-0035` and supersedes the base-continuation reconciliation it grew; amends the replay rule of `adr/ADR-0029` for sandboxes without shared history.

## Context

ADR-0035 roots every candidate at its request base: the host's `HEAD` **plus the operator's uncommitted work**, captured as a commit parented on `HEAD`. It states that this "gives the eventual host merge a meaningful merge-base". It does not. The host's own tree never descends from the request base, so `git merge` computes the merge-base as that bare `HEAD`, a tree that holds none of the operator's work. Every operator edit that was present when the request was taken then looks like a change the candidate made. Three failures follow:

1. **Spurious conflicts on operator work.** On 2026-09-25 two chats looped for hours. Candidate `10495d50` edited `live_stream.go` and `oplog/filter.go`, files the operator had created but not committed. The base `0407c88d` lacks them, so every replay hit an add/add conflict on files where nothing had diverged. Each capsule round was rebuilt from the operator's newer work and collided again. `BaseContinuationPaths` covered only the case where the host still held byte-identical content, so any further operator edit defeated it.
2. **Resurrected operator edits.** An edit the operator had uncommitted at request time and later discarded was restored by the merge: the candidate side "changed" that file relative to the bare `HEAD`, and the host side did not. No error was raised.
3. **Dead-end replays without shared history.** A sandbox rebuilt from an immutable archived base replayed a pending candidate as its raw commit diff. When operator work had touched the same context, `git apply` failed, including `--3way`, which has no preimage blobs in an unrelated repository. The failure was a generic error, so the repair loop sent it to a planner that cannot patch anything that runs before its own plan. Chat `7e463b09-…` ended in `planner_guidance_required` for exactly this reason.

## Decision

- A candidate MUST be integrated by a three-way merge whose base is **its own request base**. That base is the nearest Wharnex request-base commit on the candidate's first-parent chain, identified structurally by the fixed internal author email and the `Wharnex request base ` subject (`sandbox.CandidateMergeBase`). A caller-supplied `refs/wharnex/base/<request_id>` is used only when it is provably an ancestor of the candidate, because a branch re-anchored under ADR-0067 no longer descends from its plan's first base. Only a candidate that carries no request base falls back to Git's computed merge-base.
- The merge is computed offline with `git merge-tree --write-tree --merge-base=<base>`. Conflicts Wharnex may decide (managed knowledge, owned gitlinks) are settled in a private index. A two-parent merge commit (host, candidate) is then written with `commit-tree`, and the checkout is fast-forwarded onto it. A conflict never starts a merge in the operator's checkout, so there is nothing to abort. The resulting history is the same as with `git merge --no-ff`.
- The advisory preflight (`PreflightMergeIntoHostExcept`), the live-drift check (`extendConflictWithLiveDrift`) and every `MergeConflictError` use that same base. A capsule's BASE side is therefore what both sides really started from.
- A pending candidate replayed into a sandbox that shares no history with the host MUST be fetched into it and merged three-way from its own base onto the workspace's current tree (`sandbox.ThreeWayReplayPatch`). A collision there is a `pendingIntegrationReplayConflict` and reaches a `harness.conflict/v1` capsule, never the generic repair loop.
- A Git build without `merge-tree --merge-base` (Git < 2.40) keeps the previous working-tree `git merge` and raw-diff replay, including `BaseContinuationPaths`. It is a fallback, not a second supported mode.

## Consequences

- The host checkout may be dirty during every phase: while a request is planned, while it runs in the sandbox, and at Apply. Operator or agent edits made in parallel no longer conflict with a candidate unless they change the same lines the candidate changed.
- Operator edits discarded after a request was taken stay discarded.
- The pre-merge snapshot commit (`hostrepo.Preserve`) is unchanged. It remains the rollback boundary and still records operator work as a Wharnex bookkeeping commit.
- Merge commit messages read `Merge branch '<branch>' into <current>` even on `main`/`master`, where `git merge` would omit the target.
- No migration: existing candidate branches already carry their request-base commits. Legacy candidates without one merge exactly as before.
