# ADR-0029 — Git-native sandbox→host integration

## Decision

Replace the CAS/`ChangeSet` mechanism (`internal/changeset`) as the primary way a verified Protected sandbox candidate is integrated into the host with real Git operations: the sandbox commits its verified patch onto a dedicated branch and Wharness merges that branch into the host with an actual `git merge`, instead of computing a canonical base/result `ChangeSet` and writing files back with per-file compare-and-swap.

This is now the primary integration and communication protocol between the sandbox and the host, superseding the description in the original v1.3 "Concurrent ChangeSet integration invariant".

## Context

`internal/sandbox/copy.go`'s `copyProject`/`cloneGitBaseline` already runs `git clone --local --no-hardlinks` from the host's own repository whenever the host is a Git repository — which is always true, since `internal/projectgit.Ensure` guarantees every opened project has `.git`. The sandbox therefore already contains the host's real commit history; the CAS/ChangeSet mechanism never used it, computing a synthetic base/result diff and writing it back to the host file-by-file with a manual compare-and-swap instead.

That CAS write is exactly what a real, live production failure kept exposing: `host changed repeatedly during ChangeSet integration: external write race on <path>` — the compare-and-swap failing because the host's on-disk value changed between the CAS read and the CAS write, under perfectly ordinary conditions (a human editor, a concurrent chat, self-evolution's own build artifacts). It was also the root cause of a separate, structural dead-end already logged (`TODO.md` §14, `stale_pending_baseline`): when a queued pending candidate's baseline could not be fast-forwarded, there was no operation to retire or rebase it — only new plans, with no path out of the impasse.

Git already solves both problems natively: a merge is atomic from Git's own perspective (no read/write race window equivalent to the CAS gap), and a stale candidate that no longer applies cleanly becomes an ordinary merge conflict — a case the protocol already had a bounded recovery path for (`harness.conflict/v1`), rather than a dead end.

## Flow

1. Sandbox verification succeeds for a `change` plan → Wharness commits the already-applied, already-verified working tree onto a new branch `whx/<request_id>`, inside that same sandbox clone. Author is fixed (`Wharness <wharness@localhost>`, `commit.gpgSign=false`), never the operator's own configured Git identity. The commit message is the plan's own `commit_message` field — now a mandatory part of the `change` plan wire contract, planner-authored, sanitized (control characters stripped, whitespace collapsed, length-capped) before use — with `Request-Id`/`Plan-Id` trailers appended.
2. That branch is pushed with a purely local `git push` (destination is always an absolute host filesystem path, never a URL, never the operator's own configured `origin`) into the host's own `.git`.
3. Apply merges it into whatever the host currently has checked out with `git merge --no-ff --no-edit`, using the same fixed author identity. Before capturing the pre-merge HEAD, any uncommitted/untracked host state is auto-committed as a "Wharness host snapshot before integration" — otherwise an ordinary untracked file (e.g. a `whaness.yml` created after the project's baseline commit but never staged) makes Git refuse the merge outright as a false-positive "untracked files would be overwritten", not a real conflict.
4. The plan's own verification commands are rerun against the merged result, now via the host runner. Success deletes the integration branch (the merge commit itself remains in the host's log regardless — only the now-redundant branch ref is cleaned up). Failure reverts the host with `git reset --hard` to the exact pre-merge commit and re-enters the normal repair loop with that concrete build/verification failure.
5. A genuine merge conflict is aborted (`git merge --abort`) before it touches the host working tree, and reported as a structured `*sandbox.MergeConflictError` (conflicting paths, the branch, the host SHA, the merge-base SHA). This is translated into the same `harness.conflict/v1` capsule the CAS path already used, with BASE/CURRENT/RESULT content now sourced via `git show <sha>:<path>` against those three references instead of `ChangeSet.Mutations`.

Multiple queued pending candidates are replayed in order onto a fresh verification sandbox by fetching and merging each earlier candidate's already-integrated branch before applying the next patch, so their commit history chains correctly instead of each being rooted independently at the original clone-time HEAD (which would otherwise produce spurious conflicts between sequential, compatible edits).

## Fallback: archive-reconciled candidates keep the legacy path

A candidate reconciled from an immutable archived request base (`reconcileFromArchive` — the host baseline advanced past what the candidate can fast-forward onto, but the plan's own request-scoped context archive is still retained and covers every path it needs) is reconstructed from a ZIP snapshot, not cloned from the live host. That reconstructed directory has no `.git` at all, and therefore no Git ancestry in common with the host to branch or merge onto. That case keeps materializing a canonical base/result `ChangeSet` and integrating it via the original per-file compare-and-swap — unchanged from before this ADR.

A batch of pending candidates is therefore all-Git or all-ChangeSet in practice: a candidate verified before this feature shipped never has `IntegrationBranch` set, one verified after it never has `ChangeSet` set, and a genuinely mixed batch (straddling the deploy of this feature) falls through to the legacy per-patch path, exactly as a mixed batch already did before this feature existed.

## Authority boundary

This is Wharness's own internal execution plumbing, mutating a host project it already owns as part of Apply — the same authority Apply already has to write files without per-file approval. It is a distinct authority from a `git` command the model requests inside a plan's own `command` operations (`add`, `commit`, `branch`, `merge`, etc.), which still requires explicit user approval under the Policy Engine's existing mutable-Git rule. Nothing here is model-requested; the model only supplies `commit_message` as plan metadata, never a Git command.

## Consequences

- Eliminates the `external write race` failure mode structurally: there is no read-then-write CAS gap on the host at all in the new path, only a single atomic Git merge.
- Resolves `TODO.md` §14's `stale_pending_baseline` dead-end by construction: an obsolete pending candidate becomes an ordinary merge conflict, handled by the pre-existing `harness.conflict/v1` recovery path, never a state with no recovery operation.
- The host project's real Git log now contains every Wharness-integrated change as an actual commit/merge, with a real, planner-authored commit message — a byproduct the CAS path never produced.
- `internal/changeset`'s CAS/three-way-text-merge machinery (`Prepare`, `ApplyToWorkspace`, `Commit`, `mergeValues`, `mergeText`) remains in the codebase, used only by the archive-reconciliation fallback; it was not deleted, since it still has a real, narrower caller.
