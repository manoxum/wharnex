# ADR-0051: Local reconciliation ladder and autonomous escalation

## Status

Accepted on 2026-09-14. Amends `adr/ADR-0025` (concurrent ChangeSet
integration) and `adr/ADR-0029` (Git-native sandbox/host integration) on the
merge tier and the escalation boundary. Amends `SoT/EXECUTION_MODEL.md` and
`SoT/ERROR_MODEL.md`.

## Context

A verified candidate for `services/frontend/src/components/WorkspaceShell.tsx`
failed its host Apply with:

```text
stage ChangeSet integration: merge services/frontend/src/components/WorkspaceShell.tsx: exit status 2
```

Three separate defects produced that one line, and each of them would have been
enough on its own to strand a change that had already passed sandbox
verification.

### 1. The exit status of `git merge-file` was read as a success flag

`git merge-file` exits with the *number of conflicts*; Git documents the value
as "negative on error, and the number of conflicts otherwise (truncated to
127)". The integrator treated status 1 as a conflict and every other non-zero
status as a crash of the merge tool. A file with two conflicting hunks exits 2,
so it became a hard integration failure. Nothing in the file was unusual: two
conflicts is an ordinary number of conflicts.

### 2. Line granularity manufactured a conflict that did not exist

Both collisions were single-line, and inside the line the two sides did not
touch. The host had appended a prop to a component call; the candidate had
changed a different prop's signature in the same call:

```text
BASE     onUnbind: () => void; onBind: () => void; onNewWindow: () => void
HOST     onUnbind: () => void; onBind: () => void; onBindPath: (p: string) => void; onNewWindow: () => void
RESULT   onUnbind: (p: string) => void; onBind: () => void; onNewWindow: () => void
```

The edits are disjoint. Only the decision to compare whole lines made them
overlap. Escalating this to a planner — or to a human — spends a round on a
collision that the machine can see is not one.

### 3. A staging failure had no owner

`SoT/ERROR_MODEL.md` makes host Apply fail-closed: an Apply error escalates to
the planner only when the integration engine explicitly marks it as a candidate
defect. The rule is right, and its intent — plumbing bugs must not burn planner
rounds — is worth keeping. But the staging error was returned unmarked, so it
matched no recovery path at all. `TriggerApplyFailureRepair` published
`automation.local_recovery_retained` and returned the session untouched. The
chat printed the error once. The request then waited indefinitely for a human
who had no signal that anything was waiting, with `effort=high`, `auto` mode,
and five of six attempts unspent.

## Decision

### Ladder before conflict

Reconciliation is a ladder, exhausted locally before any collision is called a
conflict:

1. **identical** — one side did not move; no merge is required;
2. **line** — Git's line-granular three-way merge;
3. **token** — for each hunk the line tier conflicted on, *and for that hunk
   alone*, the same three-way merge re-run with one token per line.

The token tier reuses the same merge engine rather than reimplementing diff3:
the hunk is rewritten with one token per line, merged, and joined back. A token
is a maximal run of identifier bytes or a single byte, escaped so the transform
is lossless — a clean merge round-trips to exact bytes and can neither invent
nor drop content.

Two properties bound its blast radius. It never reaches outside a conflicting
hunk, so everything the line tier merged cleanly is passed through verbatim.
And it accepts only a fully clean token merge; a hunk where both sides rewrote
the same tokens stays a conflict, because that is a genuine disagreement about
intent and no finer granularity can decide it.

Content that looks like conflict output is handled by raising the marker width
above any marker-like run the inputs contain. When that is impossible the file
stays a conflict rather than being merged from a misread parse.

The merged candidate is still staged in an isolated workspace and re-verified
before any host write, so the ladder adds a merge tier without weakening the
gate that follows it.

### Complexity is recorded, not guessed

Every unresolved conflict carries the integrator's own assessment:

- `mechanical` — the ladder reconciled it, or a restage plausibly will. Never
  escalates.
- `semantic` — a bounded textual collision, or a create/delete disagreement. A
  planner that sees both intents can resolve it, and a patch can express the
  answer.
- `structural` — binary content or a file mode disagreement. There is no text
  to reconcile and no patch can express the answer, so a planner round would be
  spent only to prove that.

The assessment travels into the `harness.conflict/v1` capsule with its hunk
counts. Without it the resolver's first instinct is to propose the mechanical
union of both sides — the exact merge the engine already attempted and refused
before asking.

### Escalation is autonomous within the effort budget

A staging failure is marked as a candidate defect. This is a deliberate, narrow
exception to the fail-closed boundary, and it is safe for a structural reason
rather than a hopeful one: staging runs entirely inside an isolated workspace
and ends before the first host write, so it cannot have damaged the host or
left a transaction half-owned. What it reports is a divergence between the
candidate and the project, which is what a planner round is for.

Within that, Wharnex dispatches the correction request itself. It does not wait
for a human confirmation, because the confirmation carries no information the
engine does not already have. It stops and waits for a human at exactly two
points:

- the session's effort budget is spent — the operator chose that number when
  they chose the effort level, and it is the right place for the decision to
  return to them;
- the collision is `structural`, where another round cannot help.

No separate escalation budget is introduced. Spending the effort level's
attempts is what the effort level means.

## Consequences

The reported Apply integrates with zero planner rounds:
`WorkspaceShell.test.tsx` and `styles.css` merge at the line tier,
`WorkspaceShell.tsx` at the token tier with both hunks resolved, and the merged
file keeps the host's `onBindPath` prop alongside the candidate's `onUnbind`
signature change.

More broadly, the class of collision that made this fail — concurrent edits to
different parts of one long line — stops reaching either the planner or the
operator. The cases that still reach them are the ones where two writers
genuinely disagreed, and they arrive with the engine's own account of what it
already tried.

The risk accepted is that token-granular merging can combine two edits into a
line that is syntactically valid and semantically wrong. It is bounded by the
per-hunk scope, by requiring a fully clean token merge, and by the post-merge
verification that every staged candidate already runs. A wrong combination that
compiles and passes the suite is possible; so is one from the line tier, which
has always been trusted on the same terms.

## Required tests

- A file with two conflicting hunks integrates instead of failing Apply.
- Disjoint intra-line edits merge and keep both sides.
- A hunk where both sides rewrote the same tokens stays a conflict, classified
  `semantic`, with its hunk counts.
- The token tier does not alter anything outside a conflicting hunk.
- Tokenization round-trips arbitrary text, including CRLF, backslashes,
  non-ASCII, and marker-like content.
- Marker-like file content is never parsed as conflict output.
- A staging failure opens an automatic correction rather than retaining the
  candidate silently.
- Escalation is automatic while effort attempts remain and stops when spent.
- A structural collision does not spend a planner round.
- The conflict prompt carries the local reconciliation evidence, and carries
  none when there is none.
