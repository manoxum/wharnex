# ADR-0005: Compose ChatGPT with Electron WebContentsView

**Status:** Accepted

## Context

A normal browser iframe is not a dependable way to embed the ChatGPT web application, and same-origin isolation prevents a local application from inspecting or controlling its authenticated DOM. The product goal is nevertheless to keep Wharness and ChatGPT visible in one workspace without scraping ChatGPT output.

## Decision

Wharness Desktop uses Electron `WebContentsView` to render `https://chatgpt.com/` as a separate remote renderer beside the local Wharness frontend.

The Agent exposes two deliberately separate products on that primitive. **Engine** is the Harness-chat-owned, request-bound transport surface and may use only the typed automation allowlist. **ChatGPT** is a project-scoped surface for direct human interaction; it registers no Wharness bundle/activity/recovery/affinity/account listeners and offers only browser navigation. Sharing authenticated partition state does not share orchestration ownership.

The remote view has no preload and no Node integration, with sandbox, context isolation and web security enabled. It uses a dedicated persistent partition so normal ChatGPT login state survives restarts. Wharnex never reads cookies or generated output; DOM access is restricted to named transport and owned account-management controls.

An explicit toolbar action may open the current trusted ChatGPT URL in a detached Electron `BrowserWindow` for ordinary human browsing. That internal browser reuses the same persistent ChatGPT partition only for browser-session state, keeps the same sandbox/context-isolation/web-security boundary with no preload or Node integration, and is never registered as an Engine transport/account-automation surface. One internal browser is reused per owning Wharnex desktop window; top-level navigation is confined to trusted `chatgpt.com` HTTPS origins and unrelated HTTPS destinations are delegated to the operating-system browser. This convenience window is not an authentication workaround: providers that reject embedded Electron user-agents continue to use the external managed-browser flow from ADR-0013.

A narrow local preload lets the trusted Wharness frontend show/hide/resize the native view, request browser navigation controls, open the detached internal browser through one named IPC capability, copy the current context ZIP as a native clipboard file, and read clipboard text for explicit JSON import.

## Consequences

This avoids iframe framing restrictions and keeps both surfaces in one native window while preserving a hard privilege boundary. It does not guarantee compatibility with every future ChatGPT or third-party SSO flow; compatibility problems must not be solved by enabling Node integration, disabling web security, or scraping the remote page.
