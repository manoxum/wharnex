# ADR-0050 — Submodule-native integration (repository units)

Supersedes the "writing inside a submodule is unsupported by design" position of
`adr/ADR-0039`. Everything else in ADR-0039 — shape measurement, dirty-worktree
classification, refusal conditions, offline realignment — is retained and
extended.

## Decision

A Wharnex project is **a tree of repository units**, not one repository. The
superproject is the root unit; every initialized Git submodule reachable from
the index is a nested unit, recursively.

Every host-facing Git operation Wharnex already performs — request-base capture,
sandbox baseline, verified commit, local push, merge preflight, integration
merge, post-failure revert, submodule realignment — is performed **per unit**
instead of only on the superproject.

Routing is implicit and therefore **passive**: the planner keeps writing
ordinary project-relative paths, and Wharnex resolves each path to the unit that
actually owns it. No plan field selects a repository, and no planner behavior
document has to change for an existing project to acquire a submodule.

A `change` bundle whose patch writes inside an initialized submodule is
therefore **accepted and integrated**, not rejected.

## Context

`adr/ADR-0039` closed a real and expensive failure: a patch inside a submodule
applied to disk, passed every verification gate, and then died at
`git add -- <path>` with `fatal: Pathspec … is in submodule`, after the model
turn, the container run and the whole verification suite had been spent. Its fix
— reject at ingestion — was correct for the failure it addressed, and it stated
the true constraint of the mechanism as it existed.

It was the wrong contract for the projects Wharnex actually hosts. The reported
case is a deployment superproject (`flowKey-deploy`) whose *entire* source lives
in submodules: `services/app`, `services/be`, `services/store`. The operator
asked Wharnex to fix an `npm install` failure in `services/app/Dockerfile`. The
planner produced a correct, minimal change. Wharnex refused it, classified the
session `submodule_write`, and told the operator to open the submodule as a
separate project — which for a multi-service deployment repository means
abandoning the only view in which the change makes sense, repeating the request
in another Wharnex project, and then updating the pointer by hand.

Refusal is the right answer to "Wharnex cannot do this safely". It is the wrong
answer to "Wharnex has not been taught to do this". Submodules are ordinary Git,
and every mechanism the superproject integration already owns — an isolated
clone, a base-rooted branch, a verified commit, a local push, a real three-way
merge, a precise revert — composes over them without inventing anything new.

### What actually blocked it

Four mechanical gaps, none of them fundamental:

1. **The sandbox had no submodule repositories.** `copyProject` clones the
   superproject (`git clone --local`), which does not carry submodule content,
   then overlays the host's files. The submodule's files exist on disk but are
   invisible to Git, shadowed by a gitlink.
2. **The request base was superproject-only.** `refs/wharnex/base/<request_id>`
   recorded one commit in one repository, so a patch inside a submodule had no
   tree to be rooted at.
3. **The verified commit was superproject-only.** One branch, one `git add`, one
   repository.
4. **The host merge was superproject-only**, and so were preservation, the
   dirty-submodule guard, the revert and the conflict capsule.

## Decision detail

### Units and routing

`hostrepo.InspectUnits` measures the unit tree: the superproject plus every
gitlink in each unit's index, recursively, bounded in depth. Each unit carries
its own full `Topology`, so a unit that is itself a linked worktree or holds an
in-progress operation is measured exactly like the root.

`Units.Route(path)` resolves a project-relative path to the unit that owns it
and the path relative to that unit, by longest matching prefix. `Units.Group`
partitions a plan's whole write set into per-unit write sets ordered
**deepest-first**, which is the only order in which a commit chain is valid: a
nested submodule must be committed before the parent can record its new pointer.

Routing is a measurement like every other in `hostrepo`. A project Wharnex
cannot inspect resolves entirely to the root unit, which is exactly the
pre-submodule behavior.

### Sandbox

After the superproject clone and worktree clear, each initialized submodule is
cloned locally (`git clone --local --no-hardlinks`) from the host's own
submodule checkout into its gitlink path, and detached at the commit the
superproject records. The file overlay then runs unchanged — `.git` is already
excluded from it — so the submodule's working tree reproduces the host's,
including the operator's uncommitted content, on top of real history.

A submodule that cannot be cloned (uninitialized, unreadable, no commit) is
reported as a degraded unit and left to the file overlay, which is the previous
behavior. Degradation never fails workspace preparation.

### Request base

Each unit anchors its own base under `refs/wharnex/base/<request_id>` in its own
repository, captured through the same private-temporary-index mechanism, with
the same non-invasiveness guarantee. Protected execution checks each unit out at
its own base and opens the integration branch there.

Per-unit capture and rooting remain best effort per unit: a unit that cannot be
captured degrades to executing against its current content, and does not
disqualify the units that could be.

### Verified commit and push

For each unit in the write set, deepest-first, Wharnex commits that unit's own
paths onto `whx/<request_id>` with the plan's own `commit_message` plus
`Request-Id`/`Plan-Id` trailers and a `Unit:` trailer naming the unit. The root
unit's commit additionally stages the gitlink of every submodule whose commit
moved, so the superproject always records the pointer for the content it
verified — the root unit participates even when the patch never wrote a file
there. Its message body gains one generated line naming those pointers, because
a pointer-only commit whose subject describes a source change would otherwise be
unreadable history.

Each unit's branch is pushed into that unit's own `.git` by absolute filesystem
path. Never a network remote, never the operator's `origin`, exactly as the
superproject push already works.

### Host integration

Units merge deepest-first. Each unit gets the full ADR-0039 treatment in its own
repository: shape measurement, refusal on an in-progress operation or unresolved
paths, preservation of the operator's uncommitted work as a snapshot commit,
the merge, and its own recorded pre-merge commit. The root unit merges last, so
its gitlinks land on submodules that already hold the commits they name, and the
offline realignment pass then finds nothing to move.

The advisory superproject preflight is unit-aware. It excludes the exact
gitlinks of units this same candidate will merge, because a request-base commit
and the host's current working-tree snapshot can otherwise make two legitimate
child commits appear as a superproject pointer conflict before the child merge
has run. The exclusion is deliberately exact: a file below the unit and a
gitlink belonging to any other unit remain conflicts. The real deepest-first
merge is still authoritative and records the child commit that actually lands;
the preflight merely stops a locally decidable pointer from being mislabeled as
Wharnex-managed terminal state and sent through an impossible planner-repair
loop.

`GuardDirtySubmodules` is narrowed rather than removed: it still refuses to move
the pointer of a dirty submodule Wharnex is **not** integrating, and no longer
refuses one Wharnex is, because that submodule's own preservation commit now
holds the operator's work. Preserving inside a submodule is a deliberate
reversal of ADR-0039's "never commit in a repository Wharnex does not own": once
Wharnex commits the change there, declining to preserve the work it is about to
merge over would be strictly worse than preserving it.

Revert unwinds every unit it moved, root first and then each submodule to its
own recorded pre-merge commit, so a failed post-merge verification leaves no
unit ahead of where it started.

### Commit modes

In no-auto-commit mode the superproject unwinds with `git reset --mixed` exactly
as before, and **submodule commits are kept**. A gitlink can only point at a
commit, so unwinding the submodule would either lose the change or leave the
superproject naming a commit that does not exist. The change surfaces as an
uncommitted gitlink move in the superproject, and the pending-commit record
names the submodule commits it depends on.

### Conflicts

A merge conflict inside a unit carries that unit's identity. The capsule is
built by reading the three sides from that unit's repository while presenting
project-relative paths, so the planner sees the same paths it wrote and never
learns that a repository boundary exists. Gitlink conflicts remain unpatchable
and are still partitioned out: a conflicting pointer is a commit id, not three
versions of a file.

### Protocol

Every planner request carries a Wharnex-measured `wharness.repository/v1`
manifest: the unit tree, each unit's HEAD, branch or detached state, whether it
is initialized, and the pointer the parent records. It is descriptive, like
`wharness.environment/v1`: it grants nothing and enforces nothing.

It exists for one reason. The planner must be able to write a commit message and
an impact set that make sense for a change spanning repositories, and must know
that a path inside `services/app/` is real, patchable source rather than an
opaque pointer. Without it the planner either avoids those paths or explains
them wrongly; with it, the passive routing underneath is legible.

Uninitialized submodules stay rejected at ingestion, with their own classified
condition. There is no checkout to patch and no repository to commit into, and
no planner repair can change that — this is the narrow residue of ADR-0039's
refusal, kept for the case where it is still true.

### Reporting

Submodule commits are **local**. Wharnex never pushes to a submodule's remote,
because push is an explicit human action and always has been. The terminal
`host.applied` event and the Git surface name every unit Wharnex committed into,
so the operator knows precisely which repositories have unpushed work.

## Alternatives rejected

- **Keep rejecting, and tell the operator to open the submodule as a project.**
  This is the behavior being replaced. It is correct only if the change is
  genuinely about the submodule alone; for a deployment superproject the request
  spans services, and splitting it across Wharnex projects loses the context
  that made the change answerable.
- **An explicit per-operation `repository` field in the plan.** It makes every
  planner responsible for a repository topology it cannot verify, breaks every
  existing behavior document, and adds a way for a plan to be wrong about
  something Wharnex can simply measure. Routing by measurement cannot disagree
  with the index.
- **Committing submodule changes into the superproject as ordinary files.**
  Impossible: the index holds one gitlink there. This is the failure being
  fixed.
- **Recursing with `git submodule foreach`.** It hides which repository an
  operation ran in, cannot express deepest-first ordering with per-unit refusal,
  and gives no structured result to revert precisely.
- **Pushing submodule commits to their remotes so the pointer is resolvable
  elsewhere.** Push stays an explicit human action (`AGENTS.md`, Git surface
  invariant). Reporting the unpushed units is the honest alternative.
- **Auto-fetching a submodule commit during realignment.** Unchanged from
  ADR-0039: integration is offline; a skip is reported and the operator decides.

## Consequences

- A change inside an initialized submodule is planned, verified, committed,
  merged, verified again on host and reverted on failure, with no operator
  intervention and no second Wharnex project.
- The superproject's gitlink follows the content automatically, so a project
  whose source lives entirely in submodules stops reporting itself permanently
  modified after every change.
- The operator's uncommitted work inside a submodule Wharnex integrates is now
  preserved by a snapshot commit in that submodule, instead of blocking the
  integration.
- Submodule commits exist only locally until the operator pushes them. This is
  named explicitly in the applied event, the Git surface and the terminal chat
  message; it is the one thing about this feature an operator must not discover
  by accident.
- `submodule_write` narrows from "any write inside a submodule" to "a write
  inside a submodule with no usable checkout", and keeps its non-repairable
  classification.
