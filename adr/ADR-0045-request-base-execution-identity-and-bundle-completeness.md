# ADR-0045 — Request-base execution identity and bundle completeness

- Status: accepted
- Amends: `adr/ADR-0029`, `adr/ADR-0033`, `adr/ADR-0035`
- Evidence: exported chats `42112b59`, `df852d70`, `fabfe50b`, `e6829d45` (2026-09-11 → 2026-09-13)

## Context

Six exported chats were analysed event by event. One Main Request consumed **15
rounds over 14 h 13 min**; another consumed 7 over 3 h 48 min. Roughly two
thirds of those repair rounds were spent on conditions that were not defective
planner logic. Three engine defects account for almost all of them, and all
three share one shape: **an identity Wharnex derives from the wrong thing.**

### 1. The execution tree is not the project

`ADR-0035` made rooting a request at its own immutable base the normal path. The
base is materialised by extracting the context archive into a temporary
directory, and that directory was then passed to `Runner.Prepare`, which derives
the private Go module cache key from the tree it is handed.

So every base-rooted execution invented a brand-new cache key. The project's own
populated cache became unreachable, hydration fell back to `go env GOMODCACHE`
of the process — which in the normal stack is the control container, where
`/go/pkg/mod` does not exist — and the run failed with `offline sandbox
dependencies unavailable`, requiring a human network approval that then wrote
~144 MB under a key nothing would ever read again.

Measured on the instance: **8 cache directories, only one matching a real
project root**; the other seven ≈ 144 MB each, keyed by temporary paths, created
at the exact timestamps of the observed stalls. Four separate chats hit this,
the last at `2026-09-13T00:00:11Z`, with its retry 24 s later failing
identically — the failure is deterministic and non-convergent.

An earlier fix attempt exists in the code (`bindExecutionDependencySource`,
which rewrites `SourcePath` to the project after preparation). It could never
work: the cache key is computed *inside* preparation, before it runs.

### 2. A created file cannot be in the archive it predates

`canReconcilePlanFromArchive` required every patch path — including paths the
patch **creates** — to be present in the immutable context archive. A created
file is by definition absent from a snapshot of the project taken before it
existed, so reconciliation was structurally impossible for any change that adds
a file: a new ADR, a new Go file, a new test.

The fallthrough differed by plan shape and both branches were harmful:

- **patch-only** fell to the legacy rebase, which retargets the plan onto the
  drifted current tree. All three `patch does not apply cleanly` failures in the
  corpus were preceded within seconds by `changeset.execution_legacy_rebase`
  with reason *"immutable context archive is not execution-complete"* — a 3/3
  correlation, and precisely the dead end `ADR-0035` forbids from consuming a
  repair round.
- **command-bearing** was rejected outright at ingestion with `stale command
  plan cannot be reconciled without its immutable request base`, discarding
  three complete bundles.

Six wasted rounds from one predicate.

### 3. A bundle can promise a file it never ships

Two bundles declared `impact_files` they did not deliver, and both failed in the
sandbox with undefined-symbol compile errors:

| Plan | Declared | Delivered | Failure |
| --- | --- | --- | --- |
| `…redaction_assertion_repair` | 44 | 40 | `undefined: DebugRun`, `undefined: DebugEvidence` |
| `…203628_…_worker` | 23 | 22 | `undefined: normalizeChatAgentWorkerID` |

The five undelivered paths never existed in the repository before or after: each
was a promised new file that never arrived. Across every archived bundle this
signature produced **two detections and no false positives**.

The cost is not only the wasted round. The diagnostic that reaches the planner
is a compiler error about a symbol, which invites re-reading source that was
never at fault — and in one case the previous round's `harness.attempts/v1`
ledger had already named those exact four files as a hard exclusion, and the
next round omitted them anyway.

## Decision

**1. Preparation is told the canonical project, not asked to infer it.**
`sandbox.ProjectScopedRunner.PrepareFromProject(ctx, executionRoot, projectPath)`
takes the two paths separately; `Workspace` records `ProjectPath` alongside
`SourcePath`. Every project-scoped resource — the private dependency cache above
all — is keyed on the project. `PrepareExecutionWorkspace` is the seam the
application layer uses, and rooting a request at its immutable base therefore
shares the project's own cache instead of inventing a new one.

**2. Wharnex names the machine it actually measured.** The compatibility
fallback reads the GOMODCACHE of the Wharnex runtime, which is the operator's
machine only in development mode. Its diagnostics say so, and say when the path
does not exist, so a control-container gap stops reading as a statement about
the operator's host.

**3. Created paths are exempt from archive completeness.** Reconciliation
requires the archive to hold what the patch *modifies*, reads and declares as a
barrier — never what it creates. Those paths are also withheld from base
hydration, so the base stays faithful to the tree the patch was authored
against; a peer that created the same path meanwhile is an ordinary collision
decided by the real three-way merge at Apply, not a patch error.

**4. A change bundle must be able to deliver what it declares.** A `change`
bundle declaring an `impact_files` entry that the patch does not write **and**
that does not exist in the project is rejected at ingestion — before Policy,
before sandbox verification — alongside the `commit_message` and submodule
rules, publishing `bundle.incomplete_impact_files`.

The two conditions together are what make this safe, and the rule is
deliberately narrower than "declared must equal delivered". `impact_files`
remains a forecast: over-declaring a file that already exists is ordinary
imprecision and is accepted. Declaring a path that neither exists nor is created
states something that cannot become true. The check fails open — anything it
cannot resolve counts as deliverable — because rejecting a legitimate change is
worse than missing a detection.

## Consequences

- A base-rooted execution reuses the project's hydrated dependency cache, so the
  repeated human-gated stall disappears and the cache stops leaking ~144 MB per
  occurrence.
- Changes that add files reconcile normally, which removes both the legacy-rebase
  patch failures and the command-plan rejections.
- An incomplete bundle costs one precisely-directed re-request instead of a
  sandbox run plus a misdirected repair round.
- `impact_files` gains a delivery obligation in one narrow direction. It remains
  a scheduling forecast and MUST NOT decide whether two changes can be combined;
  that stays the three-way merge's answer alone.

## Not decided here

Enforcing the attempt ledger's exclusion list mechanically, and auditing every
other place where Wharnex's control container is measured as if it were the
operator's machine, remain open. `adr/ADR-0043` closed the verification-toolchain
instance of that second problem; this one closes the dependency-cache instance.
