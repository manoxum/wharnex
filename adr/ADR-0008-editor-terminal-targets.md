# ADR-0008: Explicit Editor terminal targets

**Status:** Accepted

## Context

The original Editor terminal was deliberately sandbox-only. That is the safest default for exploratory commands, but it prevents a developer from using the same IDE surface for deliberate commands that must inspect or affect the real checkout. Reusing Agent `Unprotected` for this purpose would couple two different trust decisions and could silently widen execution scope.

## Decision

The Editor terminal exposes two independent human-selected targets:

- `Sandbox` remains the default and keeps the persistent copied workspace, optional per-command network access, and reset-from-host behavior.
- `Host` opens a real interactive PTY in the real project root. Entering Host requires a dedicated warning/confirmation. While active, the terminal displays a persistent host-direct warning and a distinct prompt/visual state. In stack mode, the PTY is delegated to `wharnex-host-pty`, a native helper launched by the Desktop coordinator as the logged-in operating-system user; the backend container only proxies bounded PTY frames through the checkout bridge socket. Local non-stack mode may own the PTY directly.

The backend validates the target and rejects Host requests that do not carry the explicit host-confirmation marker. Interactive PTY bytes are deliberately separate from planner/model `CommandSpec` execution; Agent Protected/Unprotected mode never changes the Editor terminal target. The native bridge inherits the user's HOME/SHELL/PATH/session environment and host hostname, restoring parity with an ordinary workstation terminal while keeping the model outside that capability.

## Consequences

- Developers can choose where an interactive command runs without leaving the Wharness workspace; Host uses the same logged-in workstation identity/toolchain instead of the backend container identity.
- Sandbox remains the safe default and can still be recreated deterministically.
- Host commands can mutate the real project and have no automatic rollback; the UI states this before and during use.
- Host inherits machine networking, so the sandbox network checkbox is intentionally unavailable there.
- The model and Agent automation receive no new capability to select or use the Host terminal.
- The Host bridge socket is checkout-scoped and mode `0600`; lifecycle ownership starts/stops the helper with Desktop.
- Terminal copy/paste uses the system clipboard with `Ctrl+Shift+C/V` (`⌘C/⌘V` on macOS).
