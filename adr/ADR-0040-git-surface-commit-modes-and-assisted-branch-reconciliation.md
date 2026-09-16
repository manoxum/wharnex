# ADR-0040 — Git surface: commit modes, a pending-commit queue, and assisted branch reconciliation

## Decision

Give a project two explicit modes for what Wharnex does with its Git history
after a verified change is applied, and a dedicated Git surface for the branch
operations a human drives.

- **Auto-commit** keeps the integration's commits, which is the historical
  behavior and stays the default.
- **No auto-commit** returns the branch to where the operator left it once
  verification passes, leaving the applied change in the working tree as
  uncommitted work — while durably recording the planner-authored commit
  message, the paths and the diff so the operator can commit it deliberately.

The Git surface adds the operations that mode makes necessary — commit the
queue in full or selectively, push, merge another branch, see the branches and
the history — and routes a push, pull or merge conflict into the same bounded
`harness.conflict/v1` resolution a Wharnex integration conflict already uses,
extended so the capsule says which reconciliation is being asked for.

## Context

The Git-native integration (ADR-0029/0035) always commits: the candidate is
committed on `whx/<request_id>`, that branch is merged into the host, and the
merge commit stays. There is no way to say "apply the change but let me commit
it myself", which is how many people want to work — reviewing a change in their
own editor and shaping the commit before it becomes history.

Removing the commits is not, however, a matter of skipping them. The commit
*is* the integration mechanism: the merge is what reconciles the change with
whatever the host has drifted to, and the pre-merge snapshot is what keeps the
operator's own uncommitted edits out of the candidate's diff. Both have to
happen for the change to be correct.

So the change lands committed and is then **unwound**, which raises the
question the mode exists to answer: the commit message the change protocol
obliges every planner to write — meaningful Conventional Commits history
derived from the actual patch — would be thrown away with the commit. That
message is the part the operator cannot reconstruct, and losing it would make
the mode a downgrade dressed as a feature.

## Decision detail

### 1. Unwind, don't skip

A manual-mode Apply runs exactly as before — snapshot, merge, re-verify — and
then moves the branch back to the commit the host was at before Wharnex touched
anything, with `git reset --mixed`. The working tree is untouched, so it holds
the verified result; the index and HEAD return to the operator's starting point,
so the change *and* their own prior edits read as ordinary uncommitted work.

The reset target is the HEAD captured before the first pre-merge snapshot, not
after it. Resetting only to the post-snapshot commit would leave the operator's
own uncommitted edits committed under a Wharnex bookkeeping message — the
opposite of what the mode is for.

### 2. The pending-commit queue

Each integrated candidate is recorded before the unwind, with its
planner-authored message, its declared paths, and its own diff — bracketed by
the commits immediately before and after *its* merge, so an operator's unrelated
edits (committed by the snapshot) fall outside it.

Recording happens before the branch moves, and a partial write is rolled back.
A crash in between therefore leaves the operator with committed history —
recoverable, visible in `git log` — rather than an unexplained dirty worktree
whose messages are gone.

The queue lives in Wharnex's state directory, keyed by canonical project path,
not in the project. Writing it into the repository would put Wharnex
bookkeeping into the operator's commits and, in this mode specifically, into
the very diff the mode exists to keep clean.

### 2a. Worktree visibility is independent of commit mode

The Git surface reports the repository's current worktree separately from the
pending-commit queue. Auto-commit decides what Wharnex does after a successful
Apply; it does not mean the worktree is assumed clean or that manual/editor
changes should disappear from the surface. The Changes view therefore derives
its file list from Git working state in both modes and exposes bounded per-file
diffs for tracked and untracked paths that Git currently reports as changed.

Submodules and embedded repositories stay visible as worktree state but do not
pretend to have an inline file diff: they are repository boundaries and keep
their dedicated status semantics.

### 3. Selective committing is validated, not just offered

Committing a path takes its current working-tree content, which already
contains every earlier change to that path. Committing a later record alone
would therefore silently fold an earlier, unselected change into it and label
the result with the wrong message — history that misattributes work, which is
worse than history that is merely incomplete.

A selection that would do this is refused with the blocking records named, so
the operator widens the selection instead of discovering the mislabelling in a
review weeks later.

A record whose paths no longer differ from HEAD — the operator handled them in
their own terminal — is retired rather than kept as a permanent phantom entry.
Discarding a record is only ever bookkeeping: the files are never touched.

### 4. Commits from this surface are the operator's

A pending record is committed under the operator's own Git identity and runs
their project's hooks, unlike every commit Wharnex makes internally (fixed
identity, hooks disabled). The distinction is the point: an integration
snapshot is Wharnex plumbing, while this commit is the operator's own
contribution, made because they asked for it. A repository with no configured
identity is reported rather than silently attributed to a bot.

### 5. Push integrates rather than failing

A rejected push is not a dead end: it means the remote holds commits this
branch does not, which is an ordinary merge. The surface fetches, merges, and
pushes again.

Force-push is deliberately absent. Nothing in this workflow needs it — a
rejection is a merge, not an overwrite — and offering it would make discarding
a colleague's commits one click in a surface whose purpose is safe history.

Pushing requires an explicit confirmation token at the API boundary, because it
is the only action here that reaches outside the operator's machine and cannot
be undone by a local reset.

### 5a. Selective push is ancestry-aware

Publishing a commit to a branch also publishes every ancestor needed to reach
that commit. A checkbox UI must not imply that an arbitrary middle commit can
be pushed independently without rewriting history. Selective push therefore
accepts only the oldest contiguous prefix of commits that are ahead of the
configured upstream and advances that upstream branch to the newest commit in
that prefix with an ordinary fast-forward push.

The selective path never force-pushes and does not automatically fetch/merge on
a rejection, because doing so could change which commits the operator selected.
The operator refreshes/reviews the new upstream state or uses the existing full
push flow when branch reconciliation is intended. A branch with no valid
upstream has no safe definition of unpublished history, so the surface requires
a full push to establish that reference before selective publishing is offered.

### 6. A conflicting merge is aborted, then replayed

Both push integration and an explicit branch merge abort on conflict, recording
the three merge sides first. Leaving the merge in place would be the more
"natural" Git behavior and is the wrong choice: Wharnex's own integration
refuses to act on a repository with unresolved paths (ADR-0039), so a
conflicted merge left sitting would block every Agent request on the project
until a human intervened.

Nothing is lost by aborting. The same two commits merged again produce the same
conflict, so the resolution is replayed on demand: merge again, check out
*our* clean version of each conflicting path, apply the planner's patch, commit.

Checking out `--ours` is what keeps the resolution an ordinary patch. A
conflicted file contains Git's `<<<<<<<` markers, which no patch can be
authored against; our own clean version is exactly the CURRENT content the
capsule showed the resolver.

### 7. Protocol evolution: one capsule, two destinations

`harness.conflict/v1` gains `origin` (`integration` | `push` | `pull` | `branch_merge`)
and, for the Git origins, a `git` block naming the merge to replay. The
question a resolver answers is identical in both cases — three versions of a
file plus the intent behind each side — so a second conflict protocol would
have been duplication. What differs is where the answer goes, and the capsule
now says so.

For Git-origin conflicts, `intent` additionally carries bounded BASE→LOCAL and BASE→INCOMING diffs and richer commit provenance for both sides. Commit bodies and `Request-Id` trailers are retained; when that request id can be matched to the durable workspace transcript, the original user prompt is attached as optional provenance. A missing transcript or request trailer is represented by omission, never by reconstructing or guessing a prompt. This gives an automatic resolver the same semantic evidence a human would gather from the graph, diffs and commit history while keeping the capsule bounded.

A Git-origin resolution does **not** route through the Protected sandbox. Its
product is a merge commit the operator explicitly asked for, on their own
branch; the planner's authority is narrowed to the conflicting paths alone
(`validateConflictResolutionPlan` refuses anything outside the capsule); and
the result is one commit they can inspect and reset. Sandbox-verifying it would
mean reconstructing a half-merged tree in a container to run commands nobody
requested, and would not make the merge safer.

Wharnex never pushes again on its own after an AI-assisted resolution.
Publishing reconciled code is the operator's call, made once they have seen the
merge commit.

### 8. Self-evolution always commits

Its transaction rollback, activation and lineage all anchor on real commits, so
an uncommitted self-evolution has nothing to roll back to. The mode is
overridden with an event, and the surface presents the toggle as fixed rather
than offering a control Apply would silently ignore.

## Alternatives rejected

- **Skipping the merge entirely in manual mode and writing files directly.**
  The merge is what reconciles the change with host drift; without it the mode
  would reintroduce the whole class of failure ADR-0035 removed.
- **`git stash` instead of reset --mixed.** Stash does not cover untracked
  files or submodule content by default and adds a restore step that can itself
  conflict. The files are already where they belong; only the branch pointer
  needs to move.
- **Storing pending records in `whaness.yml` or another project file.** It
  would place Wharnex bookkeeping inside the operator's own diff, in the one
  mode whose purpose is a clean diff.
- **Letting selective commits proceed with a warning.** A warning does not
  un-mislabel a commit. The only useful moment to refuse is before the commit.
- **Keeping a conflicted merge in the working tree while the planner answers.**
  It would block all Agent work on the project for the duration, and Wharnex's
  own integration would refuse to run.
- **A separate `harness.merge-conflict/v1` protocol.** The capsule's content is
  identical; only the destination differs, which one field expresses.
- **Auto-pushing after an assisted resolution.** Publishing reconciled code
  without the operator seeing it inverts who is responsible for what reaches a
  shared branch.

## Consequences

- A project can apply verified changes without committing them, and still keep
  the history the change protocol produced.
- Selective committing cannot silently produce a commit labelled with the wrong
  change.
- A rejected push resolves itself whenever the remote's work merges cleanly,
  and becomes a bounded, intent-carrying planner request when it does not.
- Branch merges gain the same assisted reconciliation, and neither path can
  leave the repository in a state that blocks Agent work.
- The host's Git state remains fully inspectable and reversible by ordinary Git
  commands at every step: nothing here is a hidden mechanism.
