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

1. Keep the existing native ChatGPT attachment flow as the default when remote
   storage is not configured.
2. Add one application storage port. A configured adapter publishes a single
   `wharness-input-<request_id>.zip` containing the full planner prompt, eligible
   context, system artifacts, user attachments, and a transport manifest.
3. The Desktop sends only a short bootstrap prompt with a public HTTPS URL and
   SHA-256. Output remains the canonical `wharness-bundle-<request_id>.zip` and
   follows the existing strict download/validation/execution path.
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

## Consequences

- ChatGPT receives one small text submission and no Wharness input attachments
  when remote mode is active.
- Adding providers does not change the application interface or protocol.
- Remote availability becomes a prerequisite only for users who explicitly
  configure remote mode; others retain the current behavior.
- A public or signed URL is a temporary bearer capability, so short expiry,
  namespace isolation, secret filtering, and deletion are mandatory.
- The JSON pool configuration is loaded at backend startup. Existing
  single-provider environment variables remain a compatibility path that
  produces one unlimited `legacy-default` instance when no JSON document exists.
