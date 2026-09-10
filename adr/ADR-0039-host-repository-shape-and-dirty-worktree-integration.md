# ADR-0039 — Host repository shape and dirty-worktree integration

## Decision

Treat the host project's Git repository as a **shape to be measured** rather
than a shape to be assumed. A new `internal/hostrepo` package measures the
repository's topology (real Git directory, worktree kind, submodules, embedded
repositories) and classifies its uncommitted state by what Git can actually do
with each kind of dirt. Every host-facing operation — the request-base capture,
the merge preflight, the pre-merge snapshot, the integration merge and the
post-failure revert — consumes that measurement instead of assuming one
canonical layout.

Where the operator's uncommitted work cannot be preserved safely, Wharnex now
**refuses and says why**, as a classified non-repairable failure, instead of
proceeding and damaging it.

## Context

Every host-facing Git operation was written against one implicit repository
shape: a normal checkout whose `.git` is a directory, containing no submodules
and no embedded repositories, with no operation in progress and no commit
hooks. Real projects violate each of those assumptions, and each violation
produced a different late, opaque Apply failure. All of the following were
reproduced against real repositories with Git 2.43 before being fixed.

### 1. A dirty submodule blocked host integration permanently

`snapshotUncommittedHostState` asked one question — is `git status --porcelain`
non-empty — and then required `git add -A && git commit` to succeed. When a
host's *only* uncommitted state lives inside a submodule, status reports
` M <submodule>` while `git add -A` stages nothing: submodule content belongs
to another repository and the superproject holds only a gitlink. The commit
then exits 1 with `no changes added to commit`, the snapshot returns an error,
and the merge aborts before it starts.

This was not transient. `git reset --hard` does not clean a submodule worktree
either, and no Wharnex operation ever did, so the condition persisted across
every subsequent request: once a host had a dirty submodule, *every* Apply
failed identically until a human cleaned it by hand. This is the reported
failure.

### 2. `.git` is not always a directory

`CaptureWorkingTreeCommit` created its private index at `<root>/.git/…`. In a
linked worktree (`git worktree add`) and in a project root that is itself a
submodule, `.git` is a **file**. The call failed with "not a directory" — and
because both callers treat capture as best effort, the failure was silent. It
disabled request-base rooting (all of ADR-0035, returning those projects to the
`patch does not apply cleanly` dead end) and disabled the merge preflight
(`preflightErr == nil && conflict != nil` simply skipped it), on exactly the
repository shapes that need them most.

### 3. `git add -A` silently converts an embedded repository into a pointer

An untracked nested repository — a cloned dependency, a scratch checkout, an
unregistered submodule directory — is staged by `git add -A` as a gitlink
(mode 160000), with a warning on stderr that nothing read. The snapshot commit
that exists to preserve the operator's uncommitted work therefore recorded a
pointer instead of their files, and the revert built on that snapshot could not
restore them.

### 4. A host mid-merge had its conflict markers committed as resolved

`git add -A` stages unmerged (`UU`) entries. A host stopped mid-merge or
mid-rebase had the operator's unresolved conflict markers committed into their
own project history as though they were a resolution, with the operation's
state left dangling.

### 5. Project commit hooks blocked Wharnex's internal bookkeeping

Neither the snapshot commit nor the merge disabled hooks, so any project with a
failing `pre-commit` (a lint hook, a Husky gate) blocked every host
integration. The sandbox clone already disables `core.hooksPath`; the host path
did not.

### 6. A gitlink merge leaves the submodule checkout stale

`git merge` and `git reset --hard` update a gitlink in the index and HEAD and
deliberately leave the submodule's own checkout where it was. Post-merge
verification then built against submodule content matching neither tree — a
correct change failing its own gates — and the superproject was left reporting
` M <submodule>`, which is failure 1 again, now caused by Wharnex itself.

### 7. A patch inside a submodule destroyed a fully verified candidate

The sandbox is a `git clone --local` of the superproject, which does not carry
submodule content; `copyProject` then overlays the host's files, so the
submodule's files exist on disk but are invisible to Git, shadowed by the
gitlink. A plan patching such a path applied, verified, and then died at
`git add -- <path>` with `fatal: Pathspec … is in submodule` — after the model
turn, the container run and the whole verification suite had been spent, on a
defect no source patch can address.

### 8. A conflicting gitlink was handed to a planner

`git show <ref>:<submodule>` fails; `ReadFileAtRef` reports an exit error as
"path does not exist". A `harness.conflict/v1` capsule for a submodule path
therefore told the planner the file exists on no side and asked for a patch
there — which the patch validator rejects on arrival, every round, until the
bounded budget is exhausted.

## Decision detail

### Measurement

`hostrepo.Inspect` resolves the real Git directory (`--absolute-git-dir`), the
common directory, worktree kind, HEAD state, any in-progress operation (read
from Git's own marker files), and the submodule inventory **from the index**
rather than from `.gitmodules` — the index is what merge, status and `git add`
act on, and the two disagree in both directions.

`hostrepo.Working` classifies uncommitted state with
`git status --porcelain=v2 -z --untracked-files=all`, whose per-entry submodule
field (`S<c><m><u>`) distinguishes a moved gitlink from dirty submodule
content — a distinction porcelain v1 collapses into an indistinguishable
` M <path>`. Four classes result: `Stageable`, `GitlinkChanges` (stageable),
`DirtySubmodules` (not stageable), `EmbeddedRepositories` (stageable only as a
destructive pointer) and `Unmerged` (stageable only as a false resolution).

### Preservation, and refusal

`hostrepo.Preserve` commits what a superproject commit can genuinely hold,
excluding embedded repositories by pathspec, with hooks and signing disabled
and the fixed non-human identity. Two behaviors are load bearing:

- **Nothing to commit is a success.** A worktree whose entire dirt lives inside
  a submodule has nothing to snapshot, and that is a normal outcome, not an
  error. This alone retires failure 1.
- **Some states are refused.** An in-progress merge/rebase/cherry-pick/am, or
  unresolved paths, produce a typed `*hostrepo.BlockedError` carrying the
  reason, the paths and the operator action that clears it. So does an
  integration that would move the recorded commit of a submodule holding
  uncommitted work.

Refusal is the deliberate inverse of the previous behavior. Each refused
condition was previously handled by proceeding, and proceeding cost the
operator work they never agreed to risk; refusing costs them one explicit
action, named precisely.

### Reconciliation

After a merge and after a revert, `hostrepo.SyncSubmodules` realigns submodule
checkouts whose recorded commit moved. It is strictly offline (it never
fetches; a commit absent from the submodule's own object store is reported as
skipped) and strictly non-destructive (a submodule holding uncommitted work is
never checked out over). Skips are published rather than hidden, because the
superproject is then knowingly ahead of a checkout the operator must update.

### Early rejection of submodule writes

A `change` bundle whose patch writes inside a submodule is rejected **at
ingestion**, at the same seam and for the same reason as the `commit_message`
contract: it cannot be integrated at all, so every step between ingestion and
that discovery is wasted. Measurement failure never rejects: a project Wharnex
cannot inspect is admitted exactly as before.

Writing *inside* a submodule remains unsupported by design in this decision. A
submodule is a different repository with its own remote, history and review
process; Wharnex committing into it is a distinct authority question, not an
extension of the superproject Apply it already owns. The refusal states the
real constraint instead of failing late with a Git pathspec error.

### Containment fix found on the way

`contextbundle.ShouldIgnore` excluded `.git` only when it was a directory. A
submodule's and a linked worktree's `.git` is a **file** containing
`gitdir: <absolute host path>`, so it was copied into sandboxes and into model
context — a pointer into the host's own repository metadata inside a workspace
that must not reach it. `.git` is now excluded whichever it is.

## Alternatives rejected

- **Committing inside dirty submodules to make the snapshot total.** It would
  rewrite the operator's own submodule history to serve Wharnex bookkeeping,
  in a repository Wharnex does not own. Leaving them untouched and reporting
  them is both safer and truthful.
- **`git stash` instead of a snapshot commit.** Stash is worse at exactly this
  problem: by default it does not cover untracked files, does not cover
  submodule content either, and adds a restore step that can itself conflict.
  A commit is already the mechanism the revert path understands.
- **Continuing to proceed on unmerged/in-progress states, with a warning.** A
  warning does not un-commit conflict markers. The only useful moment to stop
  is before the mutation.
- **Auto-fetching submodule commits during reconciliation.** Integration is a
  local, offline step; a network fetch inside it would be a new and surprising
  authority. Reporting the skip leaves the decision with the operator.
- **Detecting submodule writes at commit time with a better error.** The cost
  is not the error text, it is the model turn, container run and verification
  suite spent before reaching it.

## Consequences

- A host with uncommitted work — including work inside submodules, embedded
  repositories, or both — no longer blocks host integration, and no longer
  degrades into a state that blocks every subsequent one.
- Request-base rooting and the merge preflight work on linked worktrees and
  submodule-rooted projects instead of silently degrading there.
- The operator's uncommitted work is either genuinely preserved or explicitly
  reported as outside Wharnex's custody. It is never silently reduced to a
  pointer, and never committed as a false conflict resolution.
- A refused host state is classified `host_working_state_blocked`: the verified
  candidate is retained, no repair round is consumed, and the UI offers the
  operator's own remedy rather than a GPT repair.
- Submodule checkouts follow the superproject through both merge and revert, so
  post-merge verification runs against the tree it is verifying.
- A patch inside a submodule costs one re-request instead of a full verified
  candidate.
