# ADR-0068 — CHANGELOG.md chat reservation

## Status

Accepted for Wharnex vNext. Complements the concurrent host integration invariant (`AGENTS.md`, v1.3) and reuses the internal-commit pattern `adr/ADR-0035`/`adr/ADR-0039` established for the pre-merge snapshot commit.

## Context

`CHANGELOG.md` is a chronic hot file. Every chat that lands a `change` tends to add its entry near the top of the same file — the natural place for it — and those edits collide during Wharnex's real `git merge --no-ff` whenever two chats integrate close together on the same project. Each collision spends a bounded, planner-visible `harness.conflict/v1` round on a file whose actual content never disagreed; only its insertion point did.

Git's own three-way merge already reconciles disjoint edits to one file cleanly (see the concurrent host integration invariant: "clean disjoint changes require no model turn"). The lever this ADR pulls is structural, not procedural: give each chat its own uniquely anchored region of the file instead of having every chat write to the same few lines at the top.

That lever has one failure mode. If reserving a chat's own heading were itself a planner-authored patch going through the ordinary Apply/merge pipeline, the contention would not disappear — it would move from "every Apply" to "every chat start", still visible to the planner, just rarer. The reservation write must be Wharnex-owned bookkeeping, exactly like the pre-merge snapshot commit and the `VERSION` bump commit already are (`internal/hostrepo/preserve.go`'s `internalCommitArgs`, `internal/app/service_version.go`'s `bumpProjectVersion`).

## Decision

### Bootstrap

A project root MUST contain `CHANGELOG.md`. Wharnex creates a minimal default (`# Changelog` / `## Unreleased`) when absent, at the same three call sites and with the same never-overwrite, never-commit-on-creation semantics as `whaness.yml` (`internal/projectconfig`) and `VERSION` (`internal/projectversion`): `CreateProject`, `CloneProject`, and session start (`StartSessionWithModes`).

### Reservation is Wharnex-owned bookkeeping, not a planner patch

When a workspace chat is created (the first `SaveWorkspaceChat` call for an id the store does not yet hold — the renderer generates the id client-side and always upserts, so there is no separate creation endpoint to hook instead), Wharnex performs a serialized, backend-internal read-modify-write-commit against the host's real `CHANGELOG.md`:

1. insert a new heading, `### Chat <chat id> (<YYYY-MM-DD>)`, followed by a placeholder body `_(reserved — no entries yet)_`;
2. commit it with the fixed non-human identity, no signing, no project hooks — the same `internalCommitArgs` shape as every other Wharnex-owned host commit;
3. store the exact heading text on the chat's own durable row (`domain.WorkspaceChat.ChangelogHeading`).

This never travels through `apply_patch`/Policy/sandbox verification/host merge. It is analogous to Apply writing files without per-file approval (see the concurrent host integration invariant's authority note) — Wharnex mutating a host file it already owns as part of its own bookkeeping, not a model-requested mutation.

**Insertion point and separation.** The heading is inserted immediately beneath the file's first `## ` heading (falling back to the first `# `, then the top of the file for a malformed/legacy `CHANGELOG.md`), so newest reservations sit first — matching this repository's own newest-entries-at-top convention, confirmed by reading `CHANGELOG.md`'s current top section before deciding. Exactly two blank lines separate one reservation block from the next block or from the file's pre-existing content. Two blank lines, not one, because that is what gives Git's merge algorithm unambiguous, distinct hunk context between adjacent chats' blocks — the single blank line this repository's own ad hoc convention already used for informal grouping was judged too easy for a diff context window to still bridge.

**Heading format.** `### Chat <chat id> (<date>)` is terse, human-readable in real `git log`/`CHANGELOG.md` history, and mechanically grep-able (`^### Chat \S+ \(\d{4}-\d{2}-\d{2}\)$`). The chat id is the full id the renderer already generates (a UUID), not a shortened hash: correctness of later exact-match lookup (see boundary-finding below) was judged more important than shaving characters, and the id never appears inline in prose elsewhere that would need it kept short.

**Serialization.** Reservation reuses the project's existing per-project apply lock (`Service.projectApplyLock`, `internal/app/service_baseline_concurrency.go`) — the same lock that already serializes the host-facing push/merge phase of ordinary Apply. Two chats starting concurrently on the same project therefore queue briefly on that lock instead of racing a `git commit`. This is deliberately synchronous and bounded (15s): the reservation must exist before the chat's first planner request is built, or that first prompt would omit the section telling the planner where its heading is.

**Content remains planner-owned.** Only the reservation heading/placeholder insertion and removal are Wharnex-owned. Once reserved, the content a planner writes *under* its own heading travels through the ordinary `apply_patch`/Policy/sandbox/merge path like any other source change — that is exactly where real, disjoint, mergeable edits belong, and nothing about this mechanism changes how that content is verified or integrated.

### Cleanup on archive

When a workspace chat transitions into archived (`SetWorkspaceChatArchived(id, true)`) and it still owns a recorded heading, Wharnex looks up that exact heading's block — bounded by its own heading line and the next Markdown heading of any level, or the canonical two-blank-line separator this package always writes, whichever comes first — and deletes it only if that block's body is still exactly the untouched placeholder. A block carrying any real planner content is never removed, permanently.

Archiving itself stays the instant, idempotent state flip `adr/ADR-0031` requires; the cleanup commit runs on its own goroutine after the archive response is already returned, and clears the chat row's stored heading only once it knows whether removal actually happened.

Restoring a chat (`SetWorkspaceChatArchived(id, false)`) that no longer owns a heading (cleaned up, or never reserved — e.g. a project with no Git repository yet) gets a fresh reservation attempt, synchronously, on the same idempotent path chat creation uses.

### Planner-facing contract

The exact reserved heading, when one is active for the current chat, travels to the planner as a new `PROJECT CHANGELOG RESERVATION` prompt section (`planner.Request.ChangelogReservation`, rendered by `internal/projectchangelog.RenderPromptSection`), alongside the existing `LOCAL EXECUTION ENVIRONMENT`/`LOCAL REPOSITORY TOPOLOGY` measured sections. The planner is instructed to anchor a changelog entry's patch context on that exact heading line, never to invent a new top-level release heading, and never to touch another chat's own `### Chat ...` heading or its content. This is advisory, matching every other measured section's trust level — Wharnex does not (in this version) reject a patch that violates it at ingestion; see Known limitations.

## Migration

No schema break. `domain.WorkspaceChat.ChangelogHeading` is a new, additively migrated column (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS changelog_heading text NOT NULL DEFAULT ''`), empty for every chat that predates this change and for every chat whose reservation attempt failed or was never attempted. An empty value means exactly "no active reservation" throughout — the prompt section is omitted, and archive cleanup is a no-op.

A project's `CHANGELOG.md` predating this change keeps its existing flat-bullet content untouched below wherever the first reservation is inserted; the two conventions (legacy flat bullets, new headed chat sections) coexist in the same file indefinitely.

## Known limitations (v1)

- **Abandoned chats leak an empty reservation.** A chat that is never explicitly archived (closed tab, uninstalled Desktop, a crashed session) has no lifecycle signal this hooks into, so its empty placeholder heading is never cleaned up. Wharnex has no durable "this chat will never be reopened" event today; inventing one was judged out of scope for this change. Documented, not silently accepted: an operator can still delete such a heading by hand, and it costs nothing beyond a few permanently-empty lines.
- **Advisory, not enforced.** The planner obligation to stay inside its own heading is prompt guidance, not a protocol-validation rejection. A planner that ignores it produces an ordinary, mergeable diff to a region another chat also touches, which is exactly the pre-existing collision risk — this ADR reduces how often that happens, it does not make it structurally impossible. Ingestion-time enforcement (reject a `change` bundle whose patch touches another chat's own heading text) is reasonable future work, not included here.
- **Restoring a chat whose block still carries real content does not create a new heading**, by design (`Reserve` is idempotent per chat id and finds the existing block first) — but it also means that block's original reservation date does not change to reflect the restore. The heading date records when the chat was first created, not each time it became active again.
