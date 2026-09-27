# ADR-0078 — Orchestrator planning uses Worker request and response bundles

## Decision

`ORCHESTRATOR_PLAN` belongs to the persistent Worker pool. The durable claim
partition routes it there before an attempt is charged. The Agent's
`BOT_WRITE`, `RECOVERY_WRITE`, and `AWAIT_RESPONSE` remain on chat-bound
Supervisors.

New Orchestrator planning exchanges upload one canonical request ZIP. It
contains a transport manifest, the backend-authored planning prompt, and any
bounded project context and attachments. The composer contains only a short
bootstrap naming that ZIP and the exact response ZIP. A Worker follows the
conversation until it can download that response, then sends the bytes
unchanged to the backend Orchestrator bundle validator. Re-delivery after an
expired artifact is another bounded request ZIP in the same conversation.

`TRANSLATE_MARKDOWN` remains on its one-task Translator Worker, and
`RELEASE_NOTES` remains on a persistent Worker; both already exchange request
and response ZIPs. This change does not grant any of these tasks command,
patch, or Apply authority.

## Compatibility

An Orchestrator task checkpointed under the historical JSON result contract
continues to finish through that exact JSON artifact. New tasks use the ZIP
pair. Existing durable task identities, leases, and response import endpoints
do not change.

## Worker viewport during automation

The native **Interagir aqui** pane resizes the same WebContentsView into a
small responsive viewport. A running task must keep the hidden 1280×900
automation viewport, so opening that pane during a task is refused. A Worker
already in direct interaction skips new claims. The operator can capture a
snapshot of a running Worker without resizing its renderer.
