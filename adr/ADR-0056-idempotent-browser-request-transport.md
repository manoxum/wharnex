# ADR-0056 — Idempotent browser request transport and request identity

Status: Accepted

## Context

The consumer-Web transport had three related failure shapes. Chromium's file-input protocol operation was followed by synthetic `input` and `change` events, allowing one archive selection to be handled twice by current ChatGPT composers. After an upload was confirmed, submission independently rediscovered the composer and could reload the page during a transient attachment state, leaving an unattributed stale draft. Finally, generated file cards moved under generic structural turns and were no longer always descendants of an assistant-role wrapper, so the exact bundle could exist without the bounded detector seeing its activation target.

Request bundles also lacked one common identity block. The request id bound the transport, but an operator or model looking at a displaced draft could not directly identify its local chat, current context hash, title, or request instant.

## Decision

Browser request preparation is one serialized transaction. The Desktop selects the canonical archive exactly once with `DOM.setFileInputFiles`, trusts the existing bounded upload-network acknowledgement, and does not replay synthetic file-input events. A confirmed upload is submitted through the same captured composer/WebContents target; no readiness rediscovery or reload may occur between attachment and dispatch. Retries may repeat only after evidence that the prior selection did not start, under the existing ambiguity and attempt bounds.

Every provider request bundle carries a closed `harness.request-metadata/v1` object containing `chat_title`, `chat_id`, `chat_hash`, and `requested_at`. The same normalized values appear in the authoritative prompt file and the bounded composer bootstrap. Continuations, repairs, comments, manual recovery, durable supervision, and translation inherit the original request identity. This metadata identifies the request and is not task instruction or project content.

Bundle activation first uses the exact expected filename. Its compatibility fallback may inspect the newest structural `data-turn-id` when an assistant-role wrapper is absent and may activate a unique visible enabled file/attachment card directly. It remains structural and bounded: it does not read answer prose, and ambiguity still fails closed.

## Consequences

- One logical request cannot create a duplicate attachment merely because two event paths processed the same native file selection.
- A transient composer state after upload cannot silently move or reload the prepared request before submission.
- Stale or displaced drafts are attributable from their bounded text without exposing project context.
- Current generated-file card layouts are detected while the response-output privacy boundary remains unchanged.
