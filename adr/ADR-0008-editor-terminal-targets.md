# ADR-0008: Host-only human Editor terminal

**Status:** Accepted (amended)

## Context

The Editor terminal is a direct human IDE capability, separate from Agent execution. Earlier versions exposed both a copied `Sandbox` PTY and a real `Host` PTY with a target selector and a persistent Host warning. The product now treats the terminal as the developer's workstation shell, while Agent Protected execution remains the dedicated isolated execution path. Keeping two human terminal targets duplicates the trust choice, consumes vertical chrome, and creates ambiguity about where ordinary IDE commands run.

## Decision

The normal Editor terminal exposes one human target: `Host`.

- Creating/opening a terminal tab is the explicit human gesture to start a Host PTY. The frontend always supplies the backend's dedicated host-confirmation marker, so there is no second confirmation modal, target selector, or persistent `HOST DIRECTO` banner.
- The Host PTY runs in the real project root as the logged-in operating-system user. In stack mode it is delegated to `wharnex-host-pty`, a native helper launched by the Desktop coordinator; the containerized backend proxies only bounded PTY frames over the checkout-scoped Unix socket. Local non-stack mode may own the PTY directly.
- The backend may retain its Sandbox terminal target for compatibility/internal callers, but normal workbench UI does not expose it. Agent Protected mode continues to execute plans in its separate copied sandbox and is not affected by this decision.
- The backend still validates the target and rejects Host requests that do not carry the host-confirmation marker. Interactive PTY bytes remain separate from planner/model `CommandSpec` execution; Agent automation cannot select or drive the human terminal.

## Consequences

- Every terminal tab behaves like the user's normal workstation terminal and uses the same HOME/SHELL/PATH/session environment and host hostname.
- Terminal chrome no longer needs target/network/reset controls or a persistent Host-mode warning; the tab itself represents an intentionally opened human Host shell.
- Host commands can mutate the real project and have no automatic terminal-level rollback. This capability remains human-only and does not broaden Agent authority.
- The Host bridge socket remains checkout-scoped and mode `0600`; lifecycle ownership starts/stops the helper with Desktop.
- Terminal copy/paste uses the system clipboard with `Ctrl+Shift+C/V` (`⌘C/⌘V` on macOS).
