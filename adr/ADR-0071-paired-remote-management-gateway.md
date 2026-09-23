# ADR-0071: Paired remote management uses the tunnel through one gateway

Status: Accepted — 2026-09-23

## Context

The tunnel subsystem already owns durable provider configuration, public URLs and request-channel/object delivery, but its public root is only a discovery page. The local stack separately publishes frontend and backend ports. That makes a remote-management UI tempting to implement as another independently exposed server or as a second browser runtime, both of which would duplicate trust boundaries and conflict with Desktop ownership of ChatGPT browser instances.

The requested remote surface also needs privileged product actions such as sending a request, creating TODOs and invoking Git workflows. A public tunnel URL by itself cannot be treated as authentication.

## Decision

Wharnex adopts one gateway plus an explicit pairing session.

- `services/gateway` is the only host-published application ingress in the canonical stack, on loopback port 6969 by default. The backend and frontend are internal-only. Desktop uses this same-origin gateway.
- `services/frontend` remains the Desktop/local workbench. `services/webapp` is a separate React + Tailwind application with its own package, lockfile, build and container image; browser automation still executes exclusively in Desktop.
- Nginx has a local listener and an internal-only remote listener. The local listener clears `X-Wharnex-Remote`; the remote listener sets it. The tunnel daemon proxies ordinary public application paths only to that trusted internal remote listener.
- Exact request-channel paths, exact stored objects, tunnel readiness and `/status` remain tunnel-owned and take precedence over the remote app proxy.
- Pairing begins only from the trusted local UI. The backend mints a short-lived single-use random code and returns a remote pairing URL/QR. Claim exchanges that code for a random session cookie; only token digests are persisted in private state.
- Remote-marked backend requests require a valid paired session, except health and pairing claim/status. Pairing does not bypass Policy, Protected execution, Git confirmation or project/security boundaries.
- Tunnel lifecycle control is an authenticated backend-to-daemon operation. Pause is process-lifetime/ephemeral; stop is persisted; resume starts the provider again. A paused or stopped instance is ineligible for new publications.
- The paired webapp is an Agent/Orchestrator cockpit over durable backend state: it may select indexed projects, manage durable chats and operational side panels, and follow requests, but it never receives a browser-control primitive. When a manual planner prompt must reach ChatGPT, the backend validates it against the active Session and enqueues a request-bound `BOT_WRITE/PREPARE_PROMPT`; an existing Desktop Supervisor performs the actual browser submission and supervision.
- Web pairing supports scanning the Desktop-generated QR directly in the webapp. The scanner extracts only a same-origin one-time pairing code; the camera stream stays browser-local and the existing claim endpoint remains the authentication boundary.

## Consequences

There is one local application origin instead of separately published frontend/backend origins, and public remote management reuses the existing tunnel rather than opening another host port. The public tunnel becomes both the request-bundle transport and, when configured, the paired remote application ingress, while its unguessable request resources retain route precedence.

The remote webapp can reuse the paired backend capabilities without importing or compiling the Desktop frontend and without owning any ChatGPT renderer. Security-sensitive behavior remains centralized in the backend/Desktop boundaries already covered by Policy. A copied public URL alone is insufficient for remote API use; a local pairing action is additionally required.

Remote requests therefore survive webapp refreshes and are visible in the same durable queue as Desktop work. A paired browser can compose, archive/save and reopen chats or operate project panels, while Supervisor/Worker capacity, provider affinity, rate limits, bundle collection and every ChatGPT renderer stay exclusively Desktop-owned.

The remote surface owns its Tailwind bootstrap inside `services/webapp`; the Desktop frontend keeps its own incremental migration rules and is not compiled as part of the remote image. This preserves independent dependency/build boundaries while leaving untouched legacy Desktop UI governed by its existing styling stack.
