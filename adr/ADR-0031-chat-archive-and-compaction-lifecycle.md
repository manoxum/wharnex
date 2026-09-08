# ADR-0031 — Passive chat archive and compaction lifecycle

## Status

Accepted.

## Context

Closing a Harness chat archives it only in the frontend's `localStorage`
(`workspaceMemory.ts`); the backend Session that chat is bound to (one
Session per chat, via `Session.ChatID`) has no notion of dormancy at all. Its
MinIO artifacts (ADR-0026), its `harness_events` audit/log rows, and any
still-present on-disk context archive files sit there indefinitely and
undated, whether the chat is open, closed, or archived, until the unrelated
30-day artifact retention cleanup eventually catches up with individual
artifacts.

Archiving needs to become a real backend data-lifecycle event: closing a
chat should be instant, restoring shortly after should be just as instant,
but a chat left archived for a while should have its backend footprint
folded down to one compact object, freeing the per-artifact/per-event
storage it was otherwise holding onto indefinitely.

The chat's human-readable transcript is explicitly out of scope: it remains
a frontend-local concern (`workspaceMemory.ts`) unaffected by this decision.
This ADR only governs data the backend already owns — MinIO artifacts,
`harness_events` rows, and on-disk context archive files.

## Decision

`domain.Session` gains `ArchivedAt`, `CompactedAt` and `ArchivePackage`
(object key, digest, size, entry count). Archiving a chat
(`Service.ArchiveChat`) is a pure, idempotent state flip: it sets
`ArchivedAt` and does nothing else — closing a chat must never itself do
heavy work.

A periodic backend sweep (`Service.CompactArchivedChats`, wired in
`cmd/harness/main.go` next to the existing artifact-retention cleanup)
folds every session whose `ArchivedAt` is older than a configurable grace
period (`HARNESS_CHAT_ARCHIVE_GRACE_HOURS`, default 72) and not yet
compacted into one package:

1. Gather that session's MinIO artifact bytes, its `harness_events` rows,
   and any still-present on-disk context archive files.
2. Pack them into one `archive/tar` stream (manifest + `events.jsonl` +
   per-artifact/per-context-file entries) and compress the whole stream in
   a single pass with the pure-Go `github.com/klauspost/compress/zstd`
   library's best-compression encoder mode. Plain tar, not `archive/zip`:
   zip's own per-entry DEFLATE would fight a second whole-stream
   compression pass.
3. Upload that one package to MinIO through the existing artifact
   object-store port, at a deterministic key
   (`sessions/<id>/archive-package`, not a fresh random id per attempt).
4. Checkpoint the package's location on the session (`ArchivePackage` set,
   `CompactedAt` still nil).
5. Only now delete the originals the package covers: the per-artifact MinIO
   objects, the `harness_events` rows, and the on-disk context files
   (best-effort — those are already-ephemeral working files).
6. Only once every delete has succeeded, clear `Artifacts`/
   `RequestContextArchives` and set `CompactedAt`.

The deterministic key plus the checkpoint-before-delete ordering makes this
crash-safe without extra bookkeeping: a crash before the checkpoint simply
re-runs step 1-4 next sweep tick, overwriting the same key; a crash after
the checkpoint but before all deletes succeed leaves the session parked
with `ArchivePackage` set and `CompactedAt` nil, so the next tick retries
only the deletes (each of which is already idempotent — a MinIO 404 on
delete is treated as success, deleting zero event rows is a no-op, a
missing context file is ignored). The session never advances past a
checkpoint until the destructive step after it confirms success.

Restoring (`Service.RestoreChat`) is bimodal:

- **Before compaction** (`CompactedAt` nil): a pure state flip clearing
  `ArchivedAt` — the fast, instant path the grace period promises.
- **After compaction**: download the package, verify its SHA-256, unpack
  it, re-upload every artifact and re-append every event (both idempotent
  on retry), then one final session update restoring `Artifacts`/
  `RequestContextArchives` and clearing every archive field — only after
  which the package is deleted. A failure at any earlier step leaves the
  session exactly as compacted, safe to retry.

The sweep processes sessions strictly one at a time, never concurrently,
with a short pause between each (`HARNESS_CHAT_ARCHIVE_SWEEP_INTERVAL_MINUTES`
governs how often the sweep itself runs; the per-session pause is a fixed
internal constant). Go has no portable OS thread-priority API, so this
bounded, sequential processing — not an OS-level priority grant — is the
literal mechanism behind not letting compaction monopolize backend
resources.

The frontend's local chat archive/restore actions (`App.tsx`) now also call
`POST /api/sessions/{id}/archive` and `POST /api/sessions/{id}/restore`
alongside their existing `localStorage` moves, giving the backend a trigger
independent of whether the browser tab that closed the chat is even still
open. The archive call is best-effort (the local transcript archive stays
authoritative); the restore call is not, since a failed post-compaction
restore means real artifacts/audit history did not come back.

## Consequences

- New pure-Go dependency, `github.com/klauspost/compress`, pinned to a
  version compatible with the backend's `go 1.23.0` / `golang:1.23-alpine`
  build image.
- No Postgres schema migration: the new fields live inside the existing
  `payload jsonb` column, and the sweep scans sessions via the same
  `Store.List()` + in-Go filter pattern the existing artifact-retention
  cleanup (`CleanupArtifacts`) already uses, rather than adding new indexed
  queries for a job with the same shape and cost profile.
- One new `Store.DeleteSessionEvents` method; a no-op without Postgres,
  matching `AppendEvent`/`EventHistory`'s existing guard.
- Restore cost becomes bimodal and user-visible: instant within the grace
  window, a brief extract-and-restore afterward (surfaced via the
  `session.restore_extracting` event on the session's existing event
  stream).
- A session whose deletes keep failing after a successful checkpoint stays
  safely parked and retried indefinitely — a stuck-but-safe failure mode,
  not a data-loss risk, visible only via the sweep's error log line; no new
  alerting infrastructure is introduced by this change.
- `Service.DeleteSession` gains one more object to delete
  (`ArchivePackage`) for an already-compacted chat, since its per-artifact
  objects are gone by then.
