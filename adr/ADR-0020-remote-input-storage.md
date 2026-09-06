# ADR-0020 — Remote input storage for consumer ChatGPT

## Status

Accepted.

## Context

Consumer ChatGPT applies rolling file-upload limits and stores uploaded files in
the user's library. Sending a context ZIP, planner prompt, and attachments on
every Wharness turn consumes that quota and creates persistent library noise.
Wharness also needs to work with hosted and self-hosted storage without coupling
application orchestration to any one vendor.

## Decision

1. Keep native ChatGPT upload as the default when remote transport is not selected,
   but collapse every planner turn into one `wharness-input-<request_id>.zip`.
   The archive contains `transport.json`, the authoritative planner prompt,
   context when required, system artifacts and user attachments. The composer
   carries only a bounded bootstrap that points to the prompt inside the ZIP.
2. Add one application storage port. A configured durable adapter publishes a single
   `wharness-input-<request_id>.zip` containing the full planner prompt, eligible
   context, system artifacts, user attachments, and a transport manifest.
3. The Desktop sends only a short bootstrap prompt with a direct binary HTTPS
   URL and SHA-256. Viewer/share/preview pages are not valid publication URLs;
   adapters normalize provider-native links to a narrowly recognized raw
   download shape. A bounded recovery continuation repeats the original
   bootstrap. Output remains the canonical
   `wharness-bundle-<request_id>.zip` and follows the existing strict
   download/validation/execution path.
4. Initially provide an rclone adapter for broad vendor/OAuth coverage and a
   PUT/WebDAV-compatible HTTP adapter for private/self-hosted endpoints.
5. Authentication belongs to a separate application enrollment port and its
   adapters. The trusted settings UI may submit transient provider credentials
   through a narrow loopback endpoint; OAuth-capable providers launch a real
   browser with a loopback callback. Secrets never enter project configuration,
   pool configuration, archives, prompts, responses, events, or logs.
6. Use a dedicated namespace, unguessable object names, and a fixed seven-day
   retention. Publication triggers cleanup; cleanup failures are reported but
   do not invalidate an already published current request.
7. Configuration contains named provider instances. Each instance has its own
   priority and optional rolling-request, file-count, per-file-size,
   archive-size, stored-object, and storage-capacity limits. Zero is unlimited.
8. The pool evaluates lower numeric priorities first and fails over on an
   account quota or publication error. Usage and retention records are durable
   and keyed by instance id, so multiple accounts using the same provider never
   share a budget.
9. The settings UI edits the complete global pool through a strict local API
   and presents named provider adapters rather than rclone internals. The
   enrollment adapter stores OAuth tokens and submitted credentials in
   rclone-owned configuration; only the managed remote name enters the pool.
   Legacy direct HTTP configuration keeps environment-secret compatibility. Writes are
   validated, permission-restricted and atomic. The active pool is immutable for
   the backend process lifetime, so a successful edit explicitly requires a
   Wharness restart.
10. Refresh context at request publication time. Durable providers publish a
    fresh request-scoped archive. TryCloudflare opens one unguessable resource
    namespace for the whole main-request chain; it is never reused across
    unrelated main requests or restarts.
11. The live namespace exposes a small manifest, mutable state/hash pointers,
    versioned prompts, immutable context snapshots by SHA-256,
    generation-specific attachments/`@file` contents, bundle contract and a
    read-only SSE stream. State is installed only after its referenced resources.
12. Keep the ChatGPT composer bootstrap compact: never paste the generated
    planner prompt into it. It carries retrieval instructions plus a bounded
    user request; a larger request falls back to the enriched remote ZIP.
13. Offer TryCloudflare as an accountless ephemeral provider. It starts
    `cloudflared` only for a dedicated loopback ZIP-object server and exposes
    that server through a temporary Quick Tunnel URL. It never tunnels the
    Wharness backend listener or any arbitrary local route.
14. A TryCloudflare channel lease starts when the main request is published and
    spans workflow, policy correction and execution repair. It ends only on a
    terminal result/completed apply, explicit cancellation, or supersession by
    a new main request. All Harness chats in one running backend session share a
    single Quick Tunnel origin but retain distinct unguessable channel
    namespaces. The tunnel remains ready between requests and closes only with
    the backend session or explicit remote-input clear/disable.
15. Context changes create a new immutable snapshot, update `state.json`, and
    emit `context.changed`. Local task comments are mirrored as `comment.added`.
    Consumer ChatGPT Web still receives comments through the allowlisted
    composer and re-fetches state before output; SSE is for capable adapters and
    MUST NOT be represented as direct model hydration in consumer Web mode.

## Consequences

- Direct mode consumes one ChatGPT file attachment per planner turn regardless of
  how many logical prompt/context/artifact/user files the turn contains.
- ChatGPT receives one small text submission and no Wharness input attachments
  when remote mode is active.
- Adding providers does not change the application interface or protocol.
- Remote availability becomes a prerequisite only for users who explicitly
  configure remote mode; others retain the current behavior.
- A public or signed URL is a temporary bearer capability, so short expiry,
  namespace isolation, secret filtering, and deletion are mandatory.
- Google Drive's rclone public link is a viewer URL. The Drive adapter extracts
  only a validated file id from that exact shape and sends the equivalent
  `drive.google.com/uc` binary-download URL to ChatGPT. The adapter verifies a
  bounded anonymous range for the ZIP signature before publication succeeds.
- TryCloudflare requires a locally installed `cloudflared` executable and a
  live Wharness process. A Quick Tunnel is not durable storage: restarting or
  stopping Wharness invalidates its URLs, and the next context publication
  establishes a new temporary session tunnel.
- The JSON pool configuration is loaded at backend startup. Existing
  single-provider environment variables remain a compatibility path that
  produces one unlimited `legacy-default` instance when no JSON document exists.
