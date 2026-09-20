# ADR-0024 — Persistent Compose stack and tunnel daemon

Status: Accepted

## Context

Wharness previously ran backend/frontend on the host and started tunnel provider processes inside the backend. Self-evolution or a backend restart therefore terminated Quick Tunnel processes and invalidated public URLs while ChatGPT could still be consuming request resources. PostgreSQL was a separately managed one-off Docker container, creating a second lifecycle model.

## Decision

Desktop remains a host Electron process. Backend, frontend, PostgreSQL and a new Go tunnel daemon run in one project-owned Docker Compose stack. The tunnel daemon is the sole owner of cloudflared/ngrok/zrok/localxpose/SSH-based tunnel processes and persisted request-channel resources. Backend stack mode uses a bearer-authenticated private HTTP adapter to the daemon and its session stop is deliberately a no-op.

Normal build/start reconciliation preserves database and tunnel container identity and rolls backend/frontend independently. Explicit `make stack-stop` and `make stack-down` are the only normal commands allowed to terminate the durable stack. Transactional self-evolution uses `make build-stage`, which may build new images but may not activate them; the detached activation path recreates only the services named by the transaction's persisted impact manifest. Database is never part of this automatic rollout. Tunnel is preserved unless tunnel source/config itself changed; backend and frontend are independent activation targets.

The first stack initialization performs a one-time offline physical migration of the legacy PostgreSQL PGDATA only when its major version is PostgreSQL 17. Any incompatible version fails closed. Existing tunnel credentials/state are copied once into the tunnel named volume.

The backend alone may access the host Docker socket so it can create Protected runner containers. Runner containers never receive that socket. Host-visible temporary work required across the backend/container/host-daemon boundary is rooted below `.harness/bridge` and mounted at the same absolute path.

## Consequences

- Backend/Desktop restarts no longer invalidate active ephemeral tunnel URLs.
- Existing tunnel resources continue to be served while the backend is temporarily unavailable.
- Normal `make stop` is intentionally Desktop-only.
- Tunnel binary dependencies leave the host and are versioned in the tunnel image.
- Projects opened by the containerized backend must be reachable through the configured host-path mounts; the canonical local stack mounts the operator home at the same absolute path.
- Explicit full stack stop/down may invalidate ephemeral public URLs and is therefore an operator action rather than part of self-evolution.
