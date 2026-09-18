# ADR-0061 — Git context in planner request bundles

Status: Accepted

## Context

The project context intentionally excludes `.git` internals. That protects the
planner from repository-private implementation state, but it also leaves a
material blind spot: the request can say that a branch is ahead while omitting
the uncommitted patch and the local commits that explain the divergence. A
planner can then produce work against an incomplete view of the operator's
current tree and repeat or conflict with changes that already exist locally.

The same request can also include related `@ref` projects. Their source is
namespaced in the context snapshot, so Git evidence must preserve that
repository boundary instead of treating the primary repository as the only
source of local divergence.

## Decision

Wharnex adds the additive `harness.git-context/v1` request protocol. The backend
builds one read-only snapshot from the primary repository and every related
project already represented in the request context. The primary namespace is
the current branch/ref. Related repositories use a stable `related-<context
namespace>` path so repositories on the same branch cannot overwrite one
another.

The snapshot contains `git-context/index.json`, one `uncommited/diff` plus
`uncommited/state.json` per represented repository, and bounded pairs of
`<sha>/commit.json` plus `<sha>/diff` for local commits not represented by the
upstream (or by any remote ref when no upstream exists). `uncommited` is kept as
the protocol path spelling requested by the transport contract. Commit records
carry ordinary Git metadata and existing Wharnex request/plan trailers when
present.

Disclosure is constrained by the existing context selection, not by a second
Git-specific heuristic. A path may enter a Git diff only when it appears in the
corresponding primary or related-project context manifest. Git internals,
repository configuration, remote URLs, credentials, and excluded paths are
never serialized. Inspection uses read-only local Git commands, has per-diff
and aggregate inventory bounds, and reports a generic unavailable state when a
repository cannot be inspected.

The snapshot is a single engine capability reused by all request transports:
Desktop direct ZIP, backend one-shot remote ZIP, live remote file map, preview,
and continuation/direct materialization. The Desktop verifies path containment,
per-file SHA-256 and byte counts before writing the local archive.

## Consequences

The planner can distinguish uncommitted work from committed-but-unpublished
work without receiving `.git`, reducing accidental duplication and local merge
conflicts. Related projects carry the same evidence without weakening their
read-only execution authority.

Request archives grow with local divergence, so the protocol enforces bounded
worktree/commit diffs, a 128-file Git-context inventory, and a commit budget
shared across represented repositories. Large histories may therefore be
truncated by policy and expose that bound in the index rather than silently
becoming unbounded transport input.

Git context remains evidence only. It grants no mutation authority, performs no
network operation, and does not change the execution baseline or the existing
cross-project approval model.
