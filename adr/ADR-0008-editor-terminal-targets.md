# ADR-0008: Explicit Editor terminal targets

**Status:** Accepted

## Context

The original Editor terminal was deliberately sandbox-only. That is the safest default for exploratory commands, but it prevents a developer from using the same IDE surface for deliberate commands that must inspect or affect the real checkout. Reusing Agent `Unprotected` for this purpose would couple two different trust decisions and could silently widen execution scope.

## Decision

The Editor terminal exposes two independent human-selected targets:

- `Sandbox` remains the default and keeps the persistent copied workspace, optional per-command network access, and reset-from-host behavior.
- `Host` executes argv directly in the real project root through `HostRunner`. Entering Host requires a dedicated warning/confirmation. While active, the terminal displays a persistent host-direct warning and a distinct prompt/visual state.

The backend validates the target and rejects Host requests that do not carry the explicit host-confirmation marker. Both targets continue through protocol-compatible `CommandSpec` validation and the Policy Engine. Shell strings are not introduced. Agent Protected/Unprotected mode never changes the Editor terminal target.

## Consequences

- Developers can choose where an interactive command runs without leaving the Wharness workspace.
- Sandbox remains the safe default and can still be recreated deterministically.
- Host commands can mutate the real project and have no automatic rollback; the UI states this before and during use.
- Host inherits machine networking, so the sandbox network checkbox is intentionally unavailable there.
- The model and Agent automation receive no new capability to select or use the Host terminal.
