# ADR-0053: Persistent multi-terminal editor workbench

## Status

Accepted (amended).

## Context

The IDE shell exposed only one interactive terminal. Starting another backend PTY implicitly closed the existing PTY, and collapsing the frontend terminal unmounted the terminal component, whose cleanup closed the live process. The Editor also required operators to leave the source surface to run a package script, inspect a per-file Git diff, or get useful completion inside common embedded template languages.

These are human IDE capabilities. They must not weaken the existing boundary that keeps model/Agent execution on structured Policy-controlled operations and keeps PTY input ephemeral. The workbench has since standardized on the Host-only human terminal described by ADR-0008, and the Editor now needs durable-feeling automatic persistence without bypassing optimistic concurrency.

## Decision

1. Backend PTYs are independent resources keyed by terminal id. `StartInteractiveTerminal` no longer closes siblings in the same project session. Session reset/teardown retains authority to close the applicable set.
2. Frontend terminal state is managed by a persistent tabbed workbench. Inactive and collapsed tabs stay mounted so their SSE subscription and process continue; explicit tab close unmounts and closes only that PTY. There is no fixed UI tab limit.
3. The normal human terminal workbench opens Host PTYs only. Tab identity, rename/close, connection status, reconnect, resize, split/detach and new-terminal actions share one compact top line; target/network/reset controls and the redundant Host-direct banner are absent.
4. Editor run actions are explicit human gestures routed only to the currently active PTY. Supported actions include discovered `package.json` scripts, runnable source files, and the current selection. They do not become execution-plan operations.
5. Per-file Git diff is a read-only endpoint. The backend validates the path through `workspacefs.Read` before calling the bounded host-repository diff helper, so Editor containment/exclusion/symlink rules still apply.
6. Text documents auto-save after a short debounce through the existing `writeFile` API and optimistic SHA-256 guard. `Ctrl/Cmd+S` flushes immediately. If edits occur while a save is in flight, the saved baseline advances without replacing the newer draft, which is then scheduled for another save. A failed unchanged draft remains dirty and is not repeatedly auto-retried.
7. Monaco keeps eager JavaScript/TypeScript model synchronization, stronger general suggestions, and tagged-template snippets/decorations for HTML, SQL, CSS and GraphQL. Embedded support remains an editor affordance, not a parser or execution boundary.

## Consequences

- Long-running commands can coexist in several terminal tabs and survive a collapsed terminal panel.
- Commands launched from Editor are intentionally visible in and owned by the human Host PTY session, preserving the same human-only security boundary as typed terminal input.
- Terminal UI consumes less vertical space and no longer presents a target choice whose sandbox semantics overlap with Protected Agent execution.
- Ordinary text edits persist without requiring a manual save click, while concurrency conflicts and write failures remain visible and retain the unsaved draft.
- Git diff reflects saved worktree state; while an auto-save is pending or has failed, the UI states that the diff still reflects the saved version.
