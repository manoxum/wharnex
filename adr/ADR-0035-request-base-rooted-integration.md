# ADR-0035 — Request-base-rooted integration and race escalation

## Decision

Anchor every planner request to the exact host tree its context was snapshotted
from, and root that request's integration branch at that tree instead of at
whatever the host has drifted to by execution time. Add Git's own dry-run merge
as the collision oracle, carry both sides' *intent* into a conflict capsule, and
escalate a compare-and-swap race that survives every restage into the same
bounded focused-resolution path a detected conflict already uses.

This completes ADR-0029: the Git-native flow committed a verified patch onto a
branch and merged it, but the patch was still *applied* to the host's current
tree, so the merge never got the chance to do the reconciliation it was chosen
for.

## Context

The recurring production failure was a plan dying at patch application:

```
patch does not apply cleanly:
git apply --check: error: patch failed: CHANGELOG.md:1
error: CHANGELOG.md: patch does not apply
git apply --recount --check: ...
git apply --3way --check: Applied patch to 'CHANGELOG.md' with conflicts.
error: SoT/AI_PROTOCOL.md: does not match index
```

`copyProject` clones the host repository — real history — then clears the
worktree and overlays the host's *current* files. The plan's patch, however, was
authored against the tree the model was shown when the request was created. Any
peer chat, human edit, or external agent that touched the same file in between
makes `git apply` fail outright. `--3way` cannot rescue it either: the overlay
leaves the sandbox's index inconsistent with its working tree, which is exactly
what "does not match index" reports.

Three properties made this particularly bad:

- It is **not** a concurrency bug. Per-project execution concurrency defaults to
  one, and the failure reproduces perfectly in a strictly serial queue: the
  collision is with work that has *already merged*, not with work running
  alongside. Scheduling changes cannot address it.
- It is **not recoverable by retrying**, because retrying replays the same patch
  against the same drifted tree.
- It consumed an automatic AI repair round for what is not a source defect at
  all.

`canFastForwardPlanBaseline` already implemented a file-level version of overlap
detection, and the failure persisted regardless, because file-set overlap is not
the question. Whether two changes can be combined is a question only a real
three-way merge can answer.

A second, related dead end was reported on the legacy compare-and-swap path:

```
host changed repeatedly during ChangeSet integration:
external write race on services/frontend/src/App.executionRecovery.test.ts
```

That was classified as `host_integration_race` — "host concurrency, not a
model/source defect; the candidate remains safe to retry" — which offered the
operator a retry whose only possible outcome was the identical failure, with no
path to planner resolution.

## Decision detail

### 1. Request base

At request creation, alongside the context snapshot, Wharness records the host's
current tree as a real commit parented on HEAD, anchored under
`refs/wharnex/base/<request_id>`.

Capture is non-invasive: staging happens in a private temporary index, so the
host's index, HEAD, branch and working tree are untouched, and an operator with
a half-staged change in progress is unaffected. Content is what `git add -A`
stages for planner-visible project state — tracked plus untracked, minus
`.gitignore` exclusions and Wharnex-managed `.wharnex/knowledge/**`. Project
knowledge is transported independently and cannot be planner-patched, so dirty
managed materialization must not become candidate ancestry; the request-base
tree retains the parent HEAD version of that subtree. The ref lives outside
`refs/heads`/`refs/tags`, so `git branch`, `git tag` and a default `git log` are
unchanged.

At execution, the verification sandbox fetches that ref by absolute path (a
local clone negotiates `refs/heads/*` only, so the ref does not arrive with the
clone even though the object does), checks out the integration branch there, and
applies the patch to the tree it was written for. `git clean -fd` runs without
`-x`, so lazily hydrated gitignored dependency trees survive.

The candidate's commit therefore descends from the request base, which is what
gives the eventual host merge a meaningful merge-base. Divergence becomes an
ordinary three-way merge that Git resolves with **no model turn** whenever the
changes are genuinely compatible.

Capture and rooting are both best effort: a repository with no commit, or any
Git refusal, degrades to the previous behavior rather than failing a request.

### 2. Merge preflight

`git merge-tree --write-tree` answers "would this conflict" against a real
merge, offline, in milliseconds, touching no working tree, index or ref. Apply
uses it before letting a merge reach the host, comparing against a throwaway
commit of the host's working tree rather than bare HEAD — the real merge commits
that dirty state first, so a HEAD-only preflight would miss a conflict with an
operator's uncommitted edit.

It is advisory. The host moves between check and merge, so the atomic merge
stays authoritative; the preflight exists so a merge already known to be doomed
on planner-resolvable paths never mutates the host and never leaves a pre-merge
snapshot commit behind for a merge that did not happen. Conflicts confined to
`.wharnex/knowledge/**` are filtered from planner reconciliation: the real merge
preserves the exact current host side locally, while mixed conflicts expose only
ordinary paths. An older Git that cannot answer degrades to "unknown", never to
"clean".

### 3. Conflict intent

A `harness.conflict/v1` capsule carried BASE/CURRENT/RESULT text but nothing
about *why* either side exists. Three versions of a file describe what differs;
they do not say which reconciliation is correct. A resolver given only text has
to infer purpose from the diff, which is where a textual fix that silently drops
the other side's behavior comes from.

Both purposes are already recorded and cost nothing to attach: the candidate's
own planner-authored `summary`/`commit_message`, and the commit subjects of the
already-integrated changes it collides with — which the protocol already obliges
every change plan to write as meaningful history. The capsule also carries the
attempt number, the bounded maximum, and what earlier rounds of the same
conflict already tried, so a resolver can see it is circling rather than
converging instead of every round looking like the first.

### 4. Race escalation

A compare-and-swap race that survives every restage attempt is escalated to
`prepareConflictResolution` with the racing path, attributed to the pending
ChangeSet that owns it, instead of being reported as a retryable race. Retrying
is right the first few times — an unrelated one-off write really can lose to a
restage — but once the same path has raced through every attempt the candidate
and the host have genuinely diverged there, and Apply is definitionally
non-convergent.

The race path is carried as a typed error rather than a message, because the
caller acts on it. Escalation reads the raw commit error: the existing
classification wrapping uses `%v`, which severs the `errors.As` chain, so
escalation must happen before classification.

An unattributable race keeps the previous classification rather than inventing a
conflict with no BASE/RESULT content to resolve against.

### 5. Concurrency as an operator knob

Per-project execution concurrency becomes adjustable at runtime and is surfaced
beside the FIFO queue it governs. Lowering it never interrupts running work: an
over-capacity project admits nothing new until it drains under the new limit.
Raising it admits plans that are *already* waiting, not only later submissions.

The ceiling stays deliberately small. Each concurrent runner claims a full
container memory allowance plus a complete project clone, so raising it trades
queueing delay — recoverable — for out-of-disk and out-of-memory failures, which
this codebase already classifies as unrepairable by any source patch.

## Alternatives rejected

- **Model-declared changed lines/columns, compared for overlap.** Hunk ranges
  are already derivable exactly and for free from the diff itself, so asking the
  planner to restate them adds an untrusted field that can drift from the patch
  it describes — and `impact_files` is already documented as a forecast whose
  authoritative counterpart Wharness derives from the validated patch. Columns
  are meaningless: Git merges by line.
- **Line-range intersection as the collision predicate.** Wrong in both
  directions. Identical or adjacent edits to the same range merge cleanly;
  disjoint ranges still conflict across a rename, a delete/edit pair, or enough
  context drift. `git merge-tree` answers the real question at no cost.
- **Model-mediated renegotiation as the primary mechanism.** It inverts the
  economics: with base-rooted merges the overwhelming majority of concurrent
  edits combine with no model turn at all. Invoking the planner on a *predicted*
  collision is both more frequent and less accurate than invoking it on a real
  one.
- **Reconciling against queued-but-unexecuted plans.** Their patches may fail, be
  repaired, or never execute; reconciling against them is reconciling against
  speculation. Only committed host state and verified pending candidates are
  real. Speculative plans may inform scheduling, never content.
- **An unbounded renegotiation budget.** Every other loop in this protocol is
  explicitly bounded (workflow rounds, repair attempts, conflict attempts).
  Conflict resolution keeps its own bounded budget, now with the attempt history
  attached so the bound informs rather than merely truncates.

## Consequences

- The reported apply failure is eliminated structurally rather than mitigated: a
  patch is applied to the tree it was authored against, so it applies.
- Concurrent edits to the same file, and even to adjacent regions, integrate
  with no model turn.
- Genuine collisions (two changes rewriting the same lines — the CHANGELOG.md
  shape every request reproduces) become real merge conflicts, which already had
  a bounded recovery path, and now carry intent.
- A persistent integration race has a way out instead of an endless retry.
- The host's object database gains one small commit per request, unreferenced
  once its anchor is released and reclaimed by ordinary Git garbage collection.
  Anchors are bounded per session and released as they age out.
