# ADR-0054 — File-first conflict capsules and cumulative path replacement

- Status: accepted
- Amends: `ADR-0025`, `ADR-0048`, `ADR-0051`, `ADR-0052`
- Evidence: chat `65a2830d-6b2a-4616-b75b-74b11d9b813f`, context hash `07e8eabdd520e812b7d2923b766a618ddfc4cfd7a73abb328a6a7edcf220ad6e`, 2026-09-14

## Context

A verified 20-file Git-native candidate conflicted with concurrent host work on three files. Its focused three-file resolution bundle was structurally correct, but verification reported four missing frontend types that existed in the original candidate's non-conflicting `types.ts` change.

The engine had called `retireConflictingMutations` before replay. That function retained only legacy records with a `ChangeSet`; Git-native pending changes intentionally have no `ChangeSet`, so it discarded the entire original candidate. Verification therefore ran the correction alone. When that failed, the retry path attempted to rebuild the Git conflict through empty ChangeSet details and failed locally. Because the transient pending flags were then clear, Apply merged the stale original candidate again and created a second 19-file conflict.

That larger conflict exposed a separate transport defect. The engine placed up to 24,000 characters for each BASE, CURRENT and RESULT body directly in the planner prompt. Nineteen paths can exceed the Desktop's deliberate 1 MiB prompt limit, so the dedicated conflict window could never be prepared and repeated the same notification after every retry/restart.

The real replay then exposed three adjacent lifecycle defects. ChatGPT's upload contract had moved to a staged metadata request followed by a file-specific `uploaded` acknowledgement, while the Desktop waited only for the legacy stream endpoint and chose a document-global file input that could belong to a stale SPA composer. Restart restoration also exempted write tasks from semantic deduplication, allowing several identical `BOT_WRITE` records and two provider submissions. Finally, the installed launcher inherited `ELECTRON_RUN_AS_NODE` from the desktop session whereas `make start` sanitized it, making the same checkout appear to be two different instances even though its profile and stack identity were equal.

## Decision

The `harness.conflict/v1` object is an engine-authored request artifact named `conflict/capsule.json`. It is carried inside the existing single `wharness.chat-input/v1` ZIP, inventoried by `transport.json`, accepted through a closed Desktop allowlist, and bounded to 4 MiB. The planner prompt contains only paths, instructions, local attempt evidence and the mandatory capsule filename. The general prompt limit remains 1 MiB.

Persisted active conflicts from the inline era are migrated during session restore. Only a syntactically valid `harness.conflict/v1` object whose `conflict_id` equals the active durable conflict is externalized; its request and conflict identities are unchanged.

A focused resolution is cumulative path replacement. The engine removes only the active conflict paths from the candidate identified by `original_plan_ids`. For a legacy `ChangeSet`, it copies and filters mutations. For a Git-native candidate, it reads the candidate commit's exact diff restricted to every non-conflicting path and replays that canonical residual before the resolution patch. The exact composition verified in the sandbox is persisted for Apply; it is not recomputed from a different representation after verification.

An active `IntegrationConflict` is itself an Apply guard, independent of UI/session state labels. If a focused resolution fails, the next bounded conflict request copies the same immutable capsule artifact and appends the observed local failure. Git-native conflicts are never retried through absent ChangeSet details.

Upload discovery is scoped to the currently usable composer and uses a closed selector preference ladder. Confirmation understands both the staged metadata/final-ack sequence and the legacy stream, and all observed request ids are cleaned up together. File-selection retry is permitted only while absence is provable: before an upload request starts or after an explicit provider rejection. Network errors and completion timeouts after a provider upload starts are ambiguous, so they fail closed without selecting the same archive again; otherwise ChatGPT may retain the first upload and reject the replay as an already-loaded file. Active semantic deduplication now covers write tasks in both durable stores and the Desktop projection. Both local launch paths sanitize Electron-as-Node mode before the splash and converge on the same lifecycle identity. Auxiliary `_cf_` surfaces never persist their conversation URL as a durable workspace-chat binding, including during restart recovery.

## Consequences

- Conflict size is bounded as archive data instead of prompt text, so multi-file capsules no longer make the dedicated window structurally unsendable.
- A three-file correction is tested and applied on top of all seventeen non-conflicting files from its original candidate.
- A failed correction cannot expose the stale predecessor to Apply or manufacture a larger second conflict.
- Existing response bundle schemas remain unchanged. Request archives gain one optional, fixed-path engine-owned entry; persisted sessions gain server-only support artifacts and an automatic compatibility migration.
- Composer revisions may change selector placement or split upload into stages without turning a successful attachment into a timeout, and restart recovery cannot multiply one accepted write.
- An ambiguous upload acknowledgement may require operator recovery, but it cannot create a duplicate attachment by replaying the same local file selection.
- The OS shortcut and `make start` now share the same runtime semantics as well as the same stored identity.

## Verification

The incident is encoded as a deterministic Git replay regression: original candidate changes one conflicting and one non-conflicting file, host drift forces conflict, a later host change forces archive-based execution, and the correction compiles only if the original non-conflicting file survives. Separate tests cover legacy prompt migration, a 2 MiB capsule in the Desktop ZIP, retry reuse, the durable Apply guard, staged upload acknowledgement and cleanup, composer-scoped file selection, write-task deduplication, auxiliary-surface recovery, and launcher environment parity.
