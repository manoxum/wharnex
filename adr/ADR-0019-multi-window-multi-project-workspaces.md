# ADR-0019 — Multi-window and multi-project workspaces

## Status

Accepted.

## Context

Wharness historically treated the Electron renderer, active project and embedded ChatGPT surface as one global desktop instance. Opening several projects required closing/replacing that state, and a second desktop window could not safely coordinate ownership of the same project or its native ChatGPT views.

## Decision

1. Electron main owns stable desktop-window records plus an in-memory lease from canonical project path to owner window. A project can have only one live owner window.
2. Each window loads a trusted workspace shell. Bound projects run as same-origin child frames and remain mounted while inactive; switching only changes which frame is visible.
3. Project bindings and active project are persisted per stable window id in local storage. The Electron process persists the set of window ids so restart reconstructs the same window topology.
4. Every ChatGPT `WebContentsView` keeps both its Harness-chat key and owner-window id. IPC/event delivery, bounds and visibility are validated against that owner.
5. Self-evolution remains a process-level transactional restart. Before scheduling it, the desktop persists window topology and exposes all/current/later activation intent; startup reconstructs the saved windows and each shell restores its bindings.

## Consequences

- Parallel projects can run without refactoring the existing project application into a global state container.
- Ordinary project switching preserves live React/component state because inactive project frames are not unmounted.
- Memory use grows with the number of simultaneously bound projects, so bindings are bounded to twelve per window.
- Project exclusivity is enforced for live windows only; filesystem/process locking across separately launched Wharness OS processes is outside this ADR.
- A transactional self-evolution handoff necessarily restarts the Electron process, so current-only means preserve/reconstruct other window compositions rather than keeping their renderer processes physically alive.
