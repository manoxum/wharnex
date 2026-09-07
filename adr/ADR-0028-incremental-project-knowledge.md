# ADR-0028 — Incremental per-project knowledge

## Status

Accepted for Wharness v1.2.28; amended for v1.2.46.3.

## Decision

Each project MAY accumulate one incremental knowledge document, authored by the planner across sessions, stored by Wharnex as `domain.ProjectKnowledge` in `harness_project_knowledge` (Postgres, keyed by `project_path`) — never as a file inside the project's own tree.

A file in the project tree was rejected: it would be picked up by ordinary context assembly, scanned as project content and therefore subject to the prompt-injection trust rule, and could only ever be the raw text a request happened to contain rather than a controlled full-document replacement. Backend-side storage, injected programmatically, matches the pattern already used for other Wharnex-authored content handed to the planner (manifests, contracts) rather than the pattern for content scanned from the project.

The document travels only as an optional `knowledge.md` file at the response bundle root, never as a JSON field on `turn.json`. This avoids the escaping problem a large free-form Markdown/code document would have as a JSON string (the same problem patches already have), and follows the existing precedent of `README.md`/`patches/*.patch` as bundle files. When present, it is always the complete replacement document, never a diff.

The knowledge document can only be updated at the close of a task: after a `change` is verified and applied to the host, Wharnex sends one additional best-effort answer-only round (`knowledge_review`) carrying that task's full event history and the current document, and asks whether anything is worth retaining. The planner is never obligated to answer with an update. This is enforced structurally, not by convention: the bundle parser extracts `knowledge.md` whenever present (pure transport), but the service layer only ever reads and persists `ProjectKnowledgeUpdate` inside the response-ingestion branch gated on `RequestLineage.Kind == "knowledge_review"`. A `knowledge.md` attached to any other response is parsed but never read by anything.

The `knowledge_review` round never mutates session state, plan, policy, or execution result. The apply that triggered it already succeeded and is the outcome the user sees; introducing a second "in-review" state would require restoring the real state afterward, for no benefit. A dedicated `PendingKnowledgeReviewRequestID` field marks it instead, independent of `state`, mirrored in the frontend by a dispatch effect keyed on that same field rather than on `state`.

## Amendment — delivery scope and content priority (v1.2.46.3)

The original v1 delivery rule sent the document only in the first request of a new chat, on the theory that a single ChatGPT conversation already retains everything said in it. In practice several derived-request kinds never included it at all regardless of chat position — automatic repair, workflow continuation, and both conflict-resolution paths (`service_changeset.go`, `service_gitintegration.go`) built their planner requests without `KnowledgeSource` — so a prior operational lesson about why a change failed to apply was systematically absent from exactly the requests most likely to repeat that failure. A long chat can also drift far enough, across many repair/workflow rounds, that content from its first message is no longer effectively in front of the model.

`KnowledgeSource` is now attached to every planner request for a project that has a recorded document: the first request of a chat, every automatic repair round, every workflow-continuation round, both conflict-resolution rounds, and the closing `knowledge_review` round itself. The trade-off is accepted deliberately: repeating a bounded, full-replacement document (capped at 256 KiB, see `AUTOMATION_BUNDLE.md`) on later turns of the same chat costs some prompt size, but a missed operational lesson costs an entire failed apply/repair cycle instead.

This amendment also narrows what the document is expected to contain. Normative rules — coding standards, architecture invariants, protocol contracts — already reach the model as ordinary project content (`AGENTS.md`, `README.md`, `SoT/*.md`, `adr/*.md`) on every request; restating them in `knowledge.md` would only waste the space this document exists for. Both the `PROJECT KNOWLEDGE` prompt section and the `knowledge_review` round's authoring instructions now direct the planner toward procedural/operational knowledge instead: what specifically made a change in this project fail to apply, need a repair round, or hit a conflict — self-evolution/build/apply gotchas, sequencing or companion-file requirements, a rejected patch and why — the kind of hard-won lesson that is not written down as a rule anywhere else. The planner is also asked to prune superseded content rather than only append, so the document does not grow unbounded.

## Scope (v1)

- Transport: manual/Desktop ChatGPT delivery only. The OpenAI API provider adapter is not wired to this round.
- No dedicated Settings UI to view/edit/reset the document.
- No version history: only the latest content and a version counter are retained, not prior revisions.

## Consequences

- A knowledge-store outage never blocks an ordinary request: `knowledgeContentForProject` swallows errors and returns empty content.
- Every derived request already carries a `RequestLineage`; `knowledge_review` is simply one more recognized kind (`requestKindKnowledgeReview`), parented on the task's main request, reusing `expectedResponseBundleFilenameForDerivedRequest` and the existing bundle-name/chat-id scheme unchanged.
- The mandatory final report (files changed and why, summary, next steps, knowledge captured) is delivered as the round's `turn.message`, which the existing chat-rendering path already displays as an ordinary ChatGPT message — no new frontend rendering was needed for it.
- Since the v1.2.46.3 amendment, the document reaches the model on every request for the project, not only the first of a chat, and is framed as operational/procedural knowledge rather than a place to restate normative rules already available elsewhere in context.

## Transport and terminal-learning amendment

Incremental knowledge is now part of request protocol state rather than prompt-only context. Each request freezes one knowledge version and reuses it across prompt and transport materialization. Read failures fail closed. Terminal knowledge review runs for both success and terminal failure/block, with deterministic retention of integration/repair/conflict/apply evidence. Knowledge persistence uses compare-and-swap; stale review output is reconciled in a bounded follow-up instead of replacing newer knowledge.
