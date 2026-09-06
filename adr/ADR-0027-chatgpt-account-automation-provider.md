# ADR-0027 — ChatGPT account automation provider

## Decision

Wharnex exposes project/conversation lifecycle as a small typed provider interface. A documented official API capability is preferred when it explicitly supports the requested account action. The current consumer ChatGPT project/conversation lifecycle has no configured supported API adapter, so the provider falls back to owner-checked browser commands for exact project lookup/creation, move, `WHX:` rename, stop/archive and sidebar collapse.

Browser-session cookies, bearer tokens, private ChatGPT endpoints, request bodies and sockets are not captured or replayed. An authenticated consumer session is not an API credential. Unsupported or ambiguous controls fail closed and are never replaced by broad DOM scraping.

Account operations are serialized across the shared browser partition so concurrent chats cannot race while creating the same project. Transport/download supervision remains per-chat and execution remains governed by the backend project FIFO.

## Consequences

- A future supported account API can be added behind the provider without changing application orchestration.
- Private web endpoints are not reverse-engineered into an unstable security dependency.
- UI drift causes an explicit failed account operation, not a click on an unrelated control.
