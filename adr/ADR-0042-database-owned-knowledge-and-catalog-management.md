# ADR-0042 — Database-owned knowledge and catalog management

## Status

Accepted for Wharnex v1.3.5. Amends `adr/ADR-0028`, which established the two-representation model this replaces.

## Context

`ADR-0028` gave project knowledge two synchronized representations: Markdown files under `.wharnex/knowledge/` as the collaboration surface, and database rows as the local indexed mirror. The files were re-read before every request and rewritten at every terminal commit.

Putting the store inside the repository made every catalog write a working-tree mutation, and the rest of the system had to be taught to work around its own knowledge store:

- `AGENTS.md` needed a rule partitioning `.wharnex/knowledge/**` out of merge conflicts, resolved by preserving the host version.
- Request-base capture needed to exclude the subtree, or volatile managed materialization would enter candidate-owned ancestry.
- Context capture needed to exclude it, or knowledge would be delivered twice.
- Plan patches needed to be forbidden from targeting it.
- A dirty knowledge file could dirty an operator's working tree for reasons they never caused.

Four special cases and one recurring surprise, all to protect the project from a store that happened to live in it.

The collaboration benefit those costs bought was also weaker than it looked. Knowledge arrived by `git pull` whether or not the recipient wanted it, carried conclusions another machine proved about another environment, and could not be handed over selectively.

## Decision

**The local database is the single authoritative store for project knowledge.** `.wharnex/knowledge/` is no longer read as a store or written at all.

Sharing becomes explicit, with an explicit artifact.

### `harness.knowledge-export/v1`

A portable bundle carrying each record's id, content, and SHA-256, plus provenance. Content is verified against its own digest on import, so an edited or truncated transfer is refused rather than quietly installed as project truth that later requests reason from.

Export is whole or selective. A selective bundle is marked as such and **may never replace a catalog**: it does not describe the records it omits, so treating its absences as deletions would destroy knowledge the exporter never spoke about. That is refused, not reinterpreted.

Import modes are `replace`, `merge` (import wins a collision), and `merge_keep_local` (local wins). The third exists because a record this machine proved by execution here outranks an older snapshot someone committed elsewhere. Every import returns a report naming what was added, replaced, kept, removed and skipped — an import that reported success while silently dropping records would be worse than a refusal.

### Clearing

Emptying the catalog, or removing named records, requires explicit confirmation at the API boundary. It destroys learning that took real execution rounds to earn, so Wharnex never takes that decision on anyone's behalf and never offers it as a cleanup step inside another operation.

### Consolidation

A catalog grown one Main Request at a time accumulates the shape of its history rather than of the project: one lesson recorded three times under three ids, one record that quietly became four unrelated topics, two records only meaningful read together. None of that is visible from inside a single request.

Consolidation is a maintenance round whose entire input is the catalog. The planner receives every record and returns the complete reorganized catalog: merging duplicates, splitting records that became several topics, deleting what `AGENTS.md`/SoT/ADR/README already encode, and rewriting each record to open by naming the situation it applies to — these records are retrieved by relevance, and one whose first line does not say when it applies will not be found when it matters.

It reuses `harness.knowledge/v2` with `mode=replace`, which already means "here is the complete desired catalog", so it inherits that path's revision compare-and-swap, validation and size bounds rather than introducing a second write path. It commits on ingestion: there is no execution to succeed or fail, so there is no later terminal boundary to stage against, and the task's own `State`, `Plan`, `Policy` and `LastExecution` are untouched.

An empty consolidation result is refused outright. Reorganizing must never become a way to delete everything; discarding knowledge is the separate confirmed human action above.

Consolidation reads the durable catalog alone, never a staged candidate: promoting an in-flight Main Request's unproven learning would bypass the terminal boundary that exists to gate exactly that.

## Migration

A project still carrying `.wharnex/knowledge/` files adopts them into the database exactly once, on first catalog access, so upgrading does not look like losing every lesson the project had earned. Adoption is one-way and idempotent; local records win. After it, the files are never read as a store again, and an explicit adopt action remains available for recovery.

The exclusion rules stay. A legacy subtree in a project must still be kept out of context bundles, request bases, and plan patch paths — those rules now protect against stale files rather than against a live store.

## Consequences

- Committing knowledge can no longer dirty a working tree, collide in a merge, or arrive in someone's checkout without them choosing it.
- Knowledge crosses machines by a deliberate, verifiable, selectable transfer.
- The catalog can be maintained as a whole rather than only appended to one request at a time.
- Knowledge is local state: a developer who wants it in their repository exports it there, and a fresh clone starts with an empty catalog until something is imported or learned.
