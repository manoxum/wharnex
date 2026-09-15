# ADR-0053: Persistent multi-terminal editor workbench

## Status

Accepted.

## Context

The IDE shell exposed only one interactive terminal. Starting another backend PTY implicitly closed the existing PTY, and collapsing the frontend terminal unmounted the terminal component, whose cleanup closed the live process. The Editor also required operators to leave the source surface to run a package script, inspect a per-file Git diff, or get useful completion inside common embedded template languages.

These are human IDE capabilities. They must not weaken the existing boundary that keeps model/Agent execution on structured Policy-controlled operations and keeps PTY input ephemeral.

## Decision

1. Backend PTYs are independent resources keyed by terminal id. `StartInteractiveTerminal` no longer closes siblings in the same project session. Session reset/teardown retains authority to close the applicable set.
2. Frontend terminal state is managed by a persistent tabbed workbench. Inactive and collapsed tabs stay mounted so their SSE subscription and process continue; explicit tab close unmounts and closes only that PTY. There is no fixed UI tab limit.
3. Editor run actions are explicit human gestures routed only to the currently active PTY. Supported actions include discovered `package.json` scripts, runnable source files, and the current selection. They do not become execution-plan operations.
4. Per-file Git diff is a read-only endpoint. The backend validates the path through `workspacefs.Read` before calling the bounded host-repository diff helper, so Editor containment/exclusion/symlink rules still apply.
5. Monaco keeps eager JavaScript/TypeScript model synchronization, stronger general suggestions, and tagged-template snippets/decorations for HTML, SQL, CSS and GraphQL. Embedded support remains an editor affordance, not a parser or execution boundary.

## Consequences

- Long-running commands can coexist in several terminal tabs and survive a collapsed terminal panel.
- Resetting a shared sandbox can still terminate sandbox PTYs because it replaces the workspace they execute in; this is an explicit destructive action rather than a visibility side effect.
- Commands launched from Editor are intentionally visible in and owned by the human PTY session, preserving the same security model as typed terminal input.
- Git diff reflects saved worktree state, so the UI warns when the selected editor document has an unsaved draft.
