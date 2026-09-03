# ADR-0013: Route ChatGPT authentication to the system browser

**Status:** Accepted

## Context

Wharness renders ChatGPT in a sandboxed Electron `WebContentsView`. Google and other identity providers may reject OAuth inside embedded user-agents. Allowing those pages to continue inside the remote view produces an authentication failure, while disguising Electron or copying browser cookies would weaken the security boundary.

## Decision

Wharness treats authentication navigation as a boundary transition. Main-frame navigation, redirects and popups to `auth.openai.com` or supported social identity providers are cancelled in the embedded renderer and opened with the operating-system default browser. Other external HTTPS links are also kept outside the ChatGPT `WebContentsView`.

The affected chat enters a system-browser bridge state. Its native remote view stays hidden, the UI explains that browser sessions are isolated, and the user may continue manual delivery by copying the Wharness context/prompt and importing the downloaded execution-bundle ZIP through a narrow native file picker. The picker validates size, ZIP signature and request-id binding before the normal bundle import path sees the file.

Wharness never reads or transfers cookies, OAuth tokens, passwords or system-browser profile data. Embedded automation is blocked with an actionable error while external-auth mode is active. Returning to the embedded browser is an explicit user action.

## Consequences

Google/SSO authentication no longer fails inside the embedded browser because it is never attempted there. Authentication completes in a provider-supported browser. The system-browser login does not authenticate the isolated Electron partition, so automatic WebContents-based ChatGPT transport is unavailable in that state; the explicit manual bridge preserves context/prompt/bundle workflow without credential extraction.
