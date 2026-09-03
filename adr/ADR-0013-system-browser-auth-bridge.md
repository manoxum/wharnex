# ADR-0013: Dual-mode ChatGPT authentication with managed-browser callback relay

**Status:** Accepted (supersedes the same-partition detached Electron auth window)

## Context

Wharness embeds ChatGPT in a sandboxed Electron `WebContentsView`. Splitting one OAuth transaction between Electron and another browser produces state/PKCE/cookie mismatches. Keeping Google OAuth inside another Electron `BrowserWindow` also fails because Google OAuth policy rejects embedded user-agents; changing the user-agent string does not change that browser class.

## Decision

Wharness keeps two explicit modes. **Embedded** keeps compatible login navigation inside the existing sandboxed ChatGPT view. When that flow reaches Google OAuth, Wharness cancels the Google navigation and promotes the attempt to the managed external mode instead of trying to bypass provider policy.

**External browser** launches an installed real Chrome/Chromium/Brave executable with a persistent dedicated Wharness profile under Electron `userData`, a loopback-only DevTools endpoint, and a fresh navigation to `https://chatgpt.com/auth/login`. An intercepted provider authorization URL is never forwarded. Wharness waits until the real browser returns to non-auth `chatgpt.com` and an in-browser `/api/auth/session` probe confirms an authenticated session.

After confirmation, the main process reads cookies from that Wharness-owned dedicated browser, filters them strictly to `chatgpt.com`, excludes Cloudflare/anti-bot cookies, and writes the remaining cookie records directly to Electron's dedicated `persist:wharness-chatgpt` cookie store. Cookie values never cross renderer IPC and are never logged. The managed browser window is closed, but its dedicated profile is preserved so the user does not have to sign into the Google/ChatGPT account again on every Wharness authentication. Explicit browser-session/full-data clearing deletes it. The embedded ChatGPT view then reloads.

The normal operating-system browser button remains an unrelated manual fallback and is surfaced as **Chrome pessoal** for convenience. It intentionally reuses the user's current browser profile/session, but Wharness never inspects or copies cookies from that arbitrary personal profile and never claims that this shortcut can callback into the embedded session. Chrome 136+ ignores remote-debugging switches against the default data directory, so bypassing that protection is explicitly out of scope.

## Consequences

Google login runs in a browser class supported by Google's OAuth policy while Wharness still regains an authenticated embedded ChatGPT session after callback. The relay is deliberately narrow but credential-sensitive, so it is confined to main-process code, loopback CDP, the dedicated Wharness profile, and `chatgpt.com` cookies only. Embedded login remains available for methods/providers that permit it; federated providers may require the managed external path.
