# ADR-0028 — Incremental per-project knowledge

## Decision

Each project MAY accumulate one incremental knowledge document, authored by the planner across sessions, stored by Wharnex as `domain.ProjectKnowledge` in `harness_project_knowledge` (Postgres, keyed by `project_path`) — never as a file inside the project's own tree.

A file in the project tree was rejected: it would be picked up by ordinary context assembly on every request (every repair round, every workflow step), when the requirement is that it appears only once, in the first request of a new chat. Backend-side storage, injected programmatically, matches the pattern already used for other Wharnex-authored content handed to the planner (manifests, contracts) rather than the pattern for content scanned from the project.

The document travels only as an optional `knowledge.md` file at the response bundle root, never as a JSON field on `turn.json`. This avoids the escaping problem a large free-form Markdown/code document would have as a JSON string (the same problem patches already have), and follows the existing precedent of `README.md`/`patches/*.patch` as bundle files. When present, it is always the complete replacement document, never a diff.

The knowledge document can only be updated at the close of a task: after a `change` is verified and applied to the host, Wharnex sends one additional best-effort answer-only round (`knowledge_review`) carrying that task's full event history and the current document, and asks whether anything is worth retaining. The planner is never obligated to answer with an update. This is enforced structurally, not by convention: the bundle parser extracts `knowledge.md` whenever present (pure transport), but the service layer only ever reads and persists `ProjectKnowledgeUpdate` inside the response-ingestion branch gated on `RequestLineage.Kind == "knowledge_review"`. A `knowledge.md` attached to any other response is parsed but never read by anything.

The `knowledge_review` round never mutates session state, plan, policy, or execution result. The apply that triggered it already succeeded and is the outcome the user sees; introducing a second "in-review" state would require restoring the real state afterward, for no benefit. A dedicated `PendingKnowledgeReviewRequestID` field marks it instead, independent of `state`, mirrored in the frontend by a dispatch effect keyed on that same field rather than on `state`.

## Scope (v1)

- Transport: manual/Desktop ChatGPT delivery only. The OpenAI API provider adapter is not wired to this round.
- No dedicated Settings UI to view/edit/reset the document.
- No version history: only the latest content and a version counter are retained, not prior revisions.

## Consequences

- A knowledge-store outage never blocks an ordinary request: `knowledgeContentForProject` swallows errors and returns empty content.
- Every derived request already carries a `RequestLineage`; `knowledge_review` is simply one more recognized kind (`requestKindKnowledgeReview`), parented on the task's main request, reusing `expectedResponseBundleFilenameForDerivedRequest` and the existing bundle-name/chat-id scheme unchanged.
- The mandatory final report (files changed and why, summary, next steps, knowledge captured) is delivered as the round's `turn.message`, which the existing chat-rendering path already displays as an ordinary ChatGPT message — no new frontend rendering was needed for it.
