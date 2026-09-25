# ADR-0074: Provider requests never depend on tunnels

**Status:** Accepted (2026-09-25). Suspends the live-channel parts of `adr/ADR-0020` and `SoT/CONTEXT_PROTOCOL.md` "Remote consumer-Web transport (v1.3)".

## Context

Before a request ZIP was built, Desktop called the backend `remote-input` publication, which provisioned and published every selected tunnel in series. A Cloudflare tunnel may wait up to 50 s to start and 60 s to become reachable, so the request sat on "A preparar o bundle ZIP e a publicar apenas os túneis selecionados…" for minutes. Earlier the same day a timeout (18 s Desktop, 16 s backend) was added, but a bounded wait is still a wait on the critical path of every request, and the tunnel links it produced were only an advisory refresh channel next to an archive that was already authoritative (`adr/ADR-0052`).

A second, independent stall was measured on the monitored chat `f3ebe00d-…`: a `BOT_WRITE` attempt fetched all its inputs at 16:55:13, then heartbeated for ~300 s with nothing uploaded until the Node `fetch` default header timeout released it at 17:00:14. The retry completed the whole preparation, upload and submit in 16 s. The local preparation phase had no deadline of its own and no timestamps in the Desktop log, so the stall could only be reconstructed from gateway access logs.

A third stall followed once that deadline existed. Chats `7e463b09-…` and `f3ebe00d-…` each prepared a ~15 MB request concurrently, and the backend logged each `POST …/artifacts` as `201` after ~119 s: it had been waiting for the request body, with no database or MinIO activity. A separate Node client inside the same up-link network namespace sent the same bytes in under a second. The 120 s preparation deadline expired just after the first upload, so every `BOT_WRITE` retry failed with "A preparação local do bundle excedeu 120 segundos" until the task exhausted its attempts without ever contacting ChatGPT. After uploads moved to dedicated connections, the same 15 MB request prepared and persisted in 3.5 s, and both chats resumed their request/response cycle.

## Decision

- A provider request is prepared, uploaded, submitted, resent and commented on without any tunnel. Desktop no longer calls `/api/sessions/{id}/remote-input` or `/remote-input/events`, and neither the request archive (`live_tunnels` stays empty for compatibility) nor the composer bootstrap carries tunnel endpoints.
- The per-chat tunnel selector is removed from the composer; `tunnelInstanceIds` is no longer part of the prepare IPC.
- Tunnels remain configured, provisioned and paired for one purpose: reaching the paired remote webapp (`adr/ADR-0071`).
- The local preparation of a request — inputs, logical archive, artifact persistence — runs under `REQUEST_PREPARATION_TIMEOUT_MS` (10 min). Hitting it fails the attempt with a named, retryable error that states ChatGPT was never contacted; an operator cancellation still propagates unchanged.
- Artifact persistence (`POST /api/sessions/{id}/artifacts`) does not use the Desktop's shared `fetch` pool. Each upload opens its own HTTP connection (`agent: false`, `Connection: close`), uploads are serialized process-wide, and each one is bounded by `ARTIFACT_UPLOAD_TIMEOUT_MS` (60 s) whose error reports the bytes actually sent.
- Each phase (`archive`, `composer`, `upload`, `submitted`) is logged as `[chatgpt-prepare] at=<ISO> request=… phase=… phaseMs=… totalMs=…`.

## Consequences

- No tunnel provider state can delay or block a request.
- The backend `remote-input` endpoints and tunnel publication code remain in place, unused by the Desktop request path, until a tunnel-context strategy is designed; that redesign needs its own ADR before any request may depend on a tunnel again.
- Durable payloads written before this change may still hold `live_tunnels`; they remain readable, and new requests always write an empty list.
