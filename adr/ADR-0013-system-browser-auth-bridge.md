# ADR-0013: Dual-mode ChatGPT authentication with same-session callback

**Status:** Accepted (supersedes the original system-browser bridge decision)

## Context

Wharness renders ChatGPT in a sandboxed Electron `WebContentsView` backed by the persistent `persist:wharness-chatgpt` partition. The previous implementation intercepted an in-flight OAuth/SSO provider URL and opened that exact URL in the operating-system browser. That split one authorization transaction across two independent browser sessions, so state/PKCE/cookie material created before the redirect could be unavailable at the final ChatGPT callback, producing `OAuthCallback` failures.

A system browser also cannot transparently authenticate the isolated Electron partition without copying browser credentials, which Wharness forbids.

## Decision

Wharness supports two explicit authentication modes:

1. **Embedded** — the complete `chatgpt.com/auth/*` → identity provider → ChatGPT callback chain remains inside the existing sandboxed ChatGPT `WebContentsView`. The remote view keeps Node integration disabled, sandbox/context isolation/web security enabled, and no Wharness preload.
2. **External window** — Wharness cancels auth navigation in the embedded view and opens a separate sandboxed `BrowserWindow` owned by Wharness. The detached window shares the exact same `persist:wharness-chatgpt` partition and always starts a fresh transaction from `https://chatgpt.com/auth/login`; it never reuses an intercepted provider authorization URL.

The detached auth window allowlists top-level navigation to ChatGPT auth pages plus supported OpenAI, Google, Microsoft and Apple identity-provider hosts. Unrelated HTTPS navigation is handed to the operating-system browser; non-HTTPS navigation is denied. Wharness observes only the detached window's top-level URL. Returning to trusted `chatgpt.com` outside `/auth` is treated as the callback signal. It then flushes the shared partition, closes the detached auth window, reloads the embedded ChatGPT view, and resumes the chat.

The ordinary operating-system browser remains available only as a manual, isolated fallback for opening ChatGPT. Wharness does not claim that this path can callback into or authenticate Electron, and it never reads/copies/imports system-browser cookies or credentials.

## Consequences

The OAuth transaction is no longer split between Electron and Chrome/Firefox. Users can choose an all-in-one embedded flow or a visually separate auth window with automatic callback into the same Wharness session. Providers may still reject embedded Chromium/Electron flows according to their own policy; in that case the external Wharness auth window is the preferred retry path. The security boundary remains credential-opaque because callback detection uses only top-level URL transitions and the partition is shared by Chromium rather than copied by application code.
