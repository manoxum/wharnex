# ADR-0013: Dual-mode ChatGPT authentication with managed-browser callback relay

**Status:** Accepted (supersedes the same-partition detached Electron auth window)

## Context

Wharness embeds ChatGPT in a sandboxed Electron `WebContentsView`. Splitting one OAuth transaction between Electron and another browser produces state/PKCE/cookie mismatches. Keeping Google OAuth inside another Electron `BrowserWindow` also fails because Google OAuth policy rejects embedded user-agents; changing the user-agent string does not change that browser class.

## Decision

Wharness keeps two explicit modes. **Embedded** keeps compatible login navigation inside the existing sandboxed ChatGPT view. When that flow reaches Google OAuth, Wharness cancels the Google navigation and promotes the attempt to the managed external mode instead of trying to bypass provider policy.

**External browser** launches an installed real Chrome/Chromium/Brave executable with a unique temporary Wharness profile, a loopback-only DevTools endpoint, and a fresh navigation to `https://chatgpt.com/auth/login`. An intercepted provider authorization URL is never forwarded. Wharness waits until the real browser returns to non-auth `chatgpt.com` and an in-browser `/api/auth/session` probe confirms an authenticated session.

After confirmation, the main process reads cookies from that Wharness-owned temporary browser, filters them strictly to `chatgpt.com`, excludes Cloudflare/anti-bot cookies, and writes the remaining cookie records directly to Electron's dedicated `persist:wharness-chatgpt` cookie store. Cookie values never cross renderer IPC and are never logged. The managed browser is closed, its temporary profile is deleted, and the embedded ChatGPT view reloads.

The normal operating-system browser button remains an unrelated manual fallback. Wharness never inspects or copies cookies from an arbitrary user browser profile.

## Consequences

Google login runs in a browser class supported by Google's OAuth policy while Wharness still regains an authenticated embedded ChatGPT session after callback. The relay is deliberately narrow but credential-sensitive, so it is confined to main-process code, loopback CDP, the temporary Wharness profile, and `chatgpt.com` cookies only. Embedded login remains available for methods/providers that permit it; federated providers may require the managed external path.
