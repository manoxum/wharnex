# ADR-0028 — Incremental per-project knowledge

## Status

Accepted for Wharness v1.2.28; superseded in-place by the record-catalog protocol (`harness.knowledge/v2`).

## Decision

Project knowledge is a first-class Wharnex artifact with two synchronized representations: shareable project files under `.wharnex/knowledge/` and local catalog metadata in the Wharnex database. Each knowledge item is one Markdown file (`.wharnex/knowledge/<id>.md`) and one independent `domain.ProjectKnowledgeEntry` database record. `.wharnex/knowledge/catalog.json` is only a small protocol/index marker so an intentionally empty catalog is representable. Postgres stores catalog revision metadata in `harness_project_knowledge_state` and one row per item in `harness_project_knowledge_entries`; the former single-document `harness_project_knowledge` table is retained only as a migration source/compatibility projection.

Knowledge exists for operational/procedural learning: proven host/build/apply sequencing, repair causes, conflict patterns, transport gotchas, and other hard-won behavior that improves later answers or changes. Normative rules remain in `AGENTS.md`, `SoT/*.md`, ADRs, and other project context and SHOULD NOT be duplicated as knowledge.

## Request delivery and per-chat control

Every chat has a `knowledge_sharing_enabled` switch. New sessions default to enabled. When enabled, a request freezes the current catalog revision and attaches every record separately as `knowledge/<id>.md`; the planner prompt contains only the catalog identity/instructions, not the record bodies. The planner MUST inspect/search and actively use relevant entries before producing an answer, workflow, or change.

The chat composer exposes this switch. Disabling it suppresses delivery of the existing catalog for that chat, but does not prevent the planner from returning new learning discovered during the current Main Request. Because the collaboration copy is project-editable, knowledge is active advisory evidence rather than privileged instructions: embedded directives cannot override the user request, `AGENTS.md`, SoT/security policy, or higher-priority instructions. If another chat commits a newer catalog revision, the next request in any stale chat automatically re-enables sharing and sends the refreshed catalog. `knowledge_last_seen_revision` makes that refresh deterministic.

Before freezing a request snapshot, Wharnex reads `.wharnex/knowledge/`. A changed project-file catalog is imported into the local database as a new catalog revision, so knowledge pulled or edited by another developer becomes visible to open chats and triggers the same stale-chat refresh behavior as knowledge produced locally. The managed knowledge subtree is excluded from ordinary project context to avoid duplicate delivery and is transported only through this knowledge protocol.

Request snapshots are immutable and record the catalog revision, sharing state, digest, and the exact entries attached to that request. Direct ZIP, remote one-shot, live-channel, and Desktop transports preserve those entries as separate files.

## Response protocol during a Main Request

Every planner response in a Main Request carries two cumulative artifacts:

- `summary.md`: the cumulative user-facing summary of what the current Main Request has handled so far;
- `knowledge/index.json` using `harness.knowledge/v2`, plus one `knowledge/<id>.md` per returned record.

`knowledge/index.json` contains `base_revision`, `mode`, and indexed records with exact SHA-256 values. When the request received the current catalog, the planner returns `mode=replace` and the complete desired catalog. It may create, edit, delete, deduplicate, merge/reconcile, or split records. When sharing was disabled, the planner returns `mode=overlay` and may contribute only current-task learning; it cannot delete unseen records.

Each successive response for the same Main Request repeats the current cumulative summary and knowledge candidate, refining them as new execution evidence appears. Wharnex stages only the most recent candidate/summary for that Main Request; response arrival alone never mutates durable project knowledge.

## Terminal commit boundary

Wharnex commits staged knowledge only when the Main Request reaches its real terminal boundary. For a change, that boundary is successful host Apply (including successful self-evolution host integration). At that point Wharnex:

1. reconciles the staged candidate against the current catalog using compare-and-swap semantics;
2. writes the reconciled catalog to `.wharnex/knowledge/`, one Markdown file per knowledge item, removing superseded managed Markdown records and updating the catalog marker;
3. persists each resulting knowledge item as an independent database record and records the new catalog revision only when the catalog actually changed;
4. stores and surfaces the cumulative `summary.md`;
5. then presents structured applied-change information.

The project files are the collaboration surface and the database is the local indexed/versioned mirror. Project-file writes use real directories, regular files, bounded IDs/content, and atomic replacement; symlinked managed paths fail closed. Ordinary execution-plan patches are forbidden from targeting `.wharnex/knowledge/`, so planner-generated knowledge can change that subtree only through the validated knowledge response protocol at the terminal commit boundary.

No new `knowledge_review` request is scheduled in the v2 flow. This removes the previous extra ChatGPT round because the latest bundle already contains both the cumulative summary and the latest knowledge candidate.

## Concurrent chats

The response candidate is based on the immutable request revision, while the durable catalog may have advanced in another chat. Reconciliation is fail-safe:

- unchanged records may be deleted or replaced as requested;
- concurrent records absent from the old request are preserved;
- a candidate edit does not overwrite a different concurrent edit silently; both versions are retained under distinct IDs so a later refreshed planner request can reconcile them deliberately;
- a no-op candidate does not create a new catalog revision.

A stale chat therefore receives the newer catalog on its next request and is automatically switched back to sharing-on for that refresh.

## Compatibility

Pre-v2 sessions may still contain `PendingKnowledgeReviewRequestID` and legacy `knowledge.md` responses. That ingestion path remains only to let an already-pending legacy review finish safely after upgrade. New Main Requests never schedule it. The legacy `ProjectKnowledge` API remains a deterministic single-document projection over the catalog (and preserves raw semantics for the one migrated `legacy-project-knowledge` record).

## Consequences

- Knowledge is independently addressable, searchable, versioned, and transportable instead of one growing blob.
- Developers can share retained learning through project-owned `.wharnex/knowledge/*.md` files; local Wharnex databases import and version those records independently.
- Planner instructions make knowledge an active required reasoning input rather than decorative context.
- Turning sharing off is chat-local, while cross-chat catalog freshness wins on the next request.
- Knowledge learned during a failed/unapplied change is staged but not committed as durable project truth.
- Catalog size remains bounded and every file/index digest is validated before staging.
