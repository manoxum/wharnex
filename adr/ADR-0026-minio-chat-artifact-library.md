# ADR-0026 — MinIO-backed ChatGPT artifact library

## Status

Accepted.

## Context

Wharness already creates request context/input archives and validates result
bundles, while Desktop keeps durable local copies of user chat attachments.
Those mechanisms do not provide one durable, inspectable history of every file
exchanged with ChatGPT, and local copies are unsuitable as the canonical store
for result bundles or multi-container lifecycle management.

## Decision

Add MinIO as a durable internal service in the canonical Compose stack and place
an object-store port in the backend application layer. Persist exchanged input
bundles, output bundles, context archives, user/system/comment attachments and
manual plan files with public metadata in the owning Session and private object
keys in backend persistence.

Expose loopback backend APIs to list/download artifacts, list ZIP entries and
read one bounded entry. The React chat presents input/output bundle metadata and
a modal file explorer with virtual directory navigation, preview and per-entry
or whole-bundle download. MinIO retention defaults to 30 days and is globally
configurable from Project Settings; startup, periodic cleanup and explicit data
removal delete owned objects.

The implementation uses the S3 SigV4 protocol directly with the Go standard
library to avoid adding a new backend dependency.

## Consequences

- The canonical stack gains one durable service and named volume.
- Backend startup in canonical stack depends on a healthy MinIO service.
- Artifact metadata contributes to backend storage metrics; MinIO object keys
  remain server-only and survive PostgreSQL/session reloads.
- Existing Desktop local attachment storage remains for transcript preview/open
  compatibility but is no longer the only durable copy of exchanged files.
- Bundle exploration never extracts into the project and therefore does not
  bypass context, policy or Protected execution boundaries.
- Existing non-MinIO application tests remain compatible because artifact
  persistence is activated only when an object-store adapter is configured.
