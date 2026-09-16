# ADR-0052 — Bundle-only provider protocol and the translation bundle

Status: Accepted

Supersedes the transport half of `ADR-0036`, whose application boundary (a non-executing utility port, isolated from planner/execution semantics) remains in force.

## Context

Wharnex talks to one provider through several different exchanges: the planner request/response pair, orchestrator planning, and document translation. Only the first was a bundle in both directions. The others grew their own shapes, and translation had the weakest one of all: the whole instruction was pasted into the composer, the source went up as a bare Markdown attachment, and the answer was expected back as a bare Markdown file named after the task.

That shape has no contract to enforce. Nothing in a returned `whx_translation_<task_id>.md` said which document it was a translation of, which language had been asked for, or which request it belonged to. The only check available was "a file with roughly the right name arrived", so every other outcome collapsed into the same observation: the model answering in prose, attaching the source back, producing a differently named file, or simply not producing one, were all indistinguishable from "not yet". The worker held the lease and waited until it timed out — the `--md` translation jobs that sat stuck in the queue.

The composer-pasted instruction made this worse in a way that is easy to miss. It was authored in the Desktop transport layer, while the answer was interpreted in the backend. The two halves of the contract lived on opposite sides of an IPC boundary, so they could drift apart silently — exactly the failure mode `ADR-0036` itself already recorded once, when a request was encoded without its `protocol` field and every claim of every translation task failed while every structural check passed.

The same reasoning applies beyond translation. Any exchange that is not a bundle is an exchange whose answer cannot be bound to its question.

## Decision

**Every exchange with the provider is a bundle in both directions.** Wharnex sends exactly one request archive and accepts exactly one response bundle. No other format or convention is a valid way to ask the provider for something or to accept its answer. This is recorded as an invariant in `AGENTS.md` and as the opening rule of `SoT/AUTOMATION_BUNDLE.md`.

A request archive carries its own protocol identity in a root transport document, the authoritative instruction as a file inside it, and every input the exchange needs. Composer text stays what it already is for planner requests: a bounded bootstrap naming the archive and the canonical expected output filename. `ADR-0056` additionally requires the same bounded engine-authored request identity in the archive, prompt, and bootstrap; no task body or project content is added to composer text.

A response bundle is named by an exact canonical filename derived from that exchange's durable identity, carries its own protocol identity in a root manifest, and is validated fail-closed before any byte is used. Validation binds the answer to the request — its identity, what was asked of it, and the digest of what was sent.

**The engine that builds a request validates its response.** A transport worker composes no instruction and parses no bundle. This is the structural fix for the drift above: there is one authority for each contract, and it is the one that can see both ends.

**Translation gets a dedicated protocol.** `wharness.translation-input/v1` for the request archive, `harness.translation/v1` for the response bundle, implemented as `internal/translation` in the backend:

- request `whx_translation_req_<task_id>.zip` — `transport.json`, `prompt/wharness-translation-prompt.md`, `source/document.md`;
- response `whx_translation_res_<task_id>.zip` — `translation.json`, `translation/document.md`.

Source and result paths are fixed by the protocol rather than declared by the producer: exactly one document travels each way, so a path the model chooses is only a path it can get wrong.

`transport.json` records `source_sha256`, and `translation.json` must echo it. That single field is what turns "a file arrived" into "this is the translation of the document we sent", and it is the check the previous shape could not express at all.

`harness.utility/v1` is retained, narrowed to what it always actually was: the application port between a Wharnex surface and the utility engine. It is no longer a wire format, and nothing shaped like it reaches the provider.

## Consequences

- A translation can now fail for a reason with a name — wrong document, wrong language, wrong task, wrong protocol, prose instead of a file, invalid UTF-8 — instead of occupying a worker until a timeout. Each of those is a refusal the operator can read.
- The provider is asked for a strictly harder artifact than before: a structured archive rather than a file. A model that cannot produce one fails immediately and visibly, which is the intended trade against failing slowly and silently.
- The Desktop transport layer holds no protocol knowledge for translation beyond size bounds and an exact expected filename. Changing the translation contract is a backend change.
- The response boundary is unchanged in substance: the worker still reads no assistant prose, and the bundle's bytes are still utility data that never become instructions.
- Future non-executing utility tasks join this protocol by adding a `task` value rather than inventing another transport.
