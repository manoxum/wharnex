# ADR-0005: Compose ChatGPT with Electron WebContentsView

**Status:** Accepted

## Context

A normal browser iframe is not a dependable way to embed the ChatGPT web application, and same-origin isolation prevents a local application from inspecting or controlling its authenticated DOM. The product goal is nevertheless to keep Wharness and ChatGPT visible in one workspace without scraping ChatGPT output.

## Decision

Wharness Desktop uses Electron `WebContentsView` to render `https://chatgpt.com/` as a separate remote renderer beside the local Wharness frontend.

The remote view has no preload and no Node integration, with sandbox, context isolation and web security enabled. It uses a dedicated persistent partition so normal ChatGPT login state survives restarts. Wharnex never reads cookies or generated output; DOM access is restricted to named transport and owned account-management controls.

A narrow local preload lets the trusted Wharness frontend show/hide/resize the native view, request browser navigation controls, copy the current context ZIP as a native clipboard file, and read clipboard text for explicit JSON import.

## Consequences

This avoids iframe framing restrictions and keeps both surfaces in one native window while preserving a hard privilege boundary. It does not guarantee compatibility with every future ChatGPT or third-party SSO flow; compatibility problems must not be solved by enabling Node integration, disabling web security, or scraping the remote page.
