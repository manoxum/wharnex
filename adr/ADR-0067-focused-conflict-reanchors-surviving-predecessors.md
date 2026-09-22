# ADR-0067 — Focused conflicts re-anchor surviving predecessor deltas

- Status: accepted
- Amends: `ADR-0054`, `ADR-0065`
- Evidence: execution `execucao-20260922T023505_beaaf83731e4f93a`, requests `req_20260922T031351_f8c87759812ab2e5` and `req_20260922T033102_ca1de84396dfa016`, 2026-09-22

## Context

A Git-native candidate was functionally verified, then host Apply opened a focused conflict on `AGENTS.md` and `SoT/FRONTEND_STYLING.md`. The focused resolution patched exactly those two capsule-owned paths and passed sandbox verification. The next Apply nevertheless reproduced the same conflict on the same two paths.

The predecessor's functional patch did not explicitly write either policy file. The collision came from the predecessor integration branch being rooted at an older immutable request base whose policy bytes had since diverged from the host. Existing conflict retirement filtered only paths that appeared in `actualPatchFiles`. It could therefore preserve the predecessor's explicit functional delta yet later promote that residual from its original request base again. That promotion restored the stale ancestry that the focused resolution had just reconciled, so the conflict could not converge.

A second compatibility hazard existed for candidates carrying both a legacy `ChangeSet` and a Git-native integration branch. After narrowing the Git commit into canonical patch bytes, retaining the old `ChangeSet` allowed later promotion to prefer stale CAS mutations instead of the narrowed patch.

## Decision

Focused conflict ownership is determined by durable conflict request lineage, not by overlap with a predecessor's explicit write set. Every pending ancestor of a verified conflict-resolution request is eligible for conflict retirement using the resolution's capsule paths. Retirement still preserves all explicit non-conflicting mutations; an incidental capsule path forces ancestry replacement, not wholesale loss of the predecessor delta.

A surviving predecessor records `integration_base_request_id`, identifying the focused resolution request base on which its residual delta was composed and verified. `Plan.BaseContextSHA256` and legacy `ChangeSet.BaseRevision` advance to the replacement context at the same time. Legacy branch promotion resolves this override first, roots the original predecessor branch identity at that retained request base, and never silently falls back to the predecessor's original request anchor. Request-base retention treats the override as live state so its ref cannot be evicted while the pending candidate depends on it.

When a Git-native candidate is narrowed into canonical residual patch bytes, its legacy `ChangeSet` representation is cleared. From that point the patch is the one durable representation of the residual delta and later promotion cannot select stale CAS state.

Recovery of already-persisted conflict threads uses the newest pending conflict-resolution request in the lineage as the replacement request base. This lets self-heal remove stale integration ancestry even when the live `IntegrationConflict` slot has already been cleared or overwritten.

## Consequences

- A focused resolution can converge when its capsule paths are incidental to the predecessor's patch and originate only from stale request-base ancestry.
- Non-conflicting predecessor changes remain part of the cumulative candidate and are not discarded.
- Later Apply/promotion cannot recreate the retired conflict by rebuilding the predecessor from an obsolete request base.
- Request-base retention may keep one additional anchor per narrowed pending candidate until that candidate is applied, rejected or otherwise retired.
- Persisted sessions without `integration_base_request_id` remain compatible and keep the historical `Plan.RequestID` fallback.

## Verification

Regression coverage must include: a conflict-resolution child whose capsule paths do not overlap the predecessor patch; retirement of a surviving predecessor recording the replacement request base; explicit rooting at a replacement request base while preserving the predecessor's branch identity; retention of that replacement anchor; and the existing guard that unrelated candidates sharing a path are not treated as a conflict lineage.
