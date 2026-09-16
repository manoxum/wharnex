# ADR-0058 — Explicit provider reasoning effort

## Status

Accepted.

## Context

Wharnex already used `effort_level` to bound the number of autonomous attempts in a Main Request. ChatGPT and the OpenAI Responses API also expose a provider reasoning-depth control, but that is a different decision: it trades response latency for per-turn deliberation and does not authorize more retries. Treating both as one value would silently change request budgets when the user only intended to change model depth.

The browser transport had provisional selector vocabulary for ChatGPT's composer control but did not enforce or verify it before submission. Consequently a translation or Agent prompt inherited whatever state the remote composer happened to retain.

## Decision

Wharnex adds a separate, closed `reasoning_effort` contract with `instant`, `medium`, and `high`.

- The session owns the user's per-chat selection and defaults to `high` for compatibility with previous Agent behaviour.
- Every Agent, continuation and Orchestrator provider request carries the normalized selection.
- The OpenAI adapter maps the choice to the configured model's supported Responses API value. The mapping is explicit and covered by request-body tests rather than assumed to be uniform across models.
- The Desktop serializes reasoning enforcement with prompt submission. It observes only the composer control, uses trusted native input to change it, and re-observes the control before sending. Unknown, absent or ambiguous state blocks submission.
- `TRANSLATE_MARKDOWN` always overrides the session value with `instant` because translation is a bounded utility operation.
- The dev-only behavior probe admits `reasoning-effort` as a closed control so selector drift can be measured against an authenticated live surface without exposing response prose or generic DOM access.

## Consequences

`effort_level` remains an attempt budget and existing stored sessions with no reasoning field behave as `high`. The browser behavior document can evolve its structural selector and localized control-label vocabulary without changing the application protocol. Live calibration is diagnostic evidence only; it cannot submit a prompt or inspect a conversation.
