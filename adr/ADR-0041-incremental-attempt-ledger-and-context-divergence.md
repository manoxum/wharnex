# ADR-0041 — Incremental attempt ledger and context divergence

## Status

Accepted for Wharnex v1.3.5.

## Context

A correction that should take one request routinely took many. Two distinct blind spots produced the loop, and both sat in what a continuation request carried.

**The planner could not see its own history.** A repair request carried the failure that triggered it and nothing else. On round three the planner saw round three's diagnostics; rounds one and two were gone. In Desktop transport the conversation nominally held them, but bundles are large, context is truncated, and the remote one-shot and live-channel transports have no conversation at all. So the planner re-proposed approaches the local machine had already rejected, and each repetition cost a full round trip to rediscover a known failure.

`harness.knowledge/v2` did not fill this gap, and should not have. Knowledge is durable project truth, committed only after a Main Request succeeds, and the protocol correctly tells the planner not to record things that are not durable. "Attempt 2's patch did not apply because it was authored against pre-refactor line numbers" is decisive for round three and worthless as project history. There was no protocol slot for it.

**The planner could not see what moved.** Every continuation rebuilt the full context bundle and shipped a new manifest with a new `sha256`. The planner was told the snapshot changed but never what changed, so it could not distinguish real drift from a new fingerprint, and its cheapest safe response was to re-read the project.

Underneath that sat a real defect. `captureRequestBase` was called only from `submitPlannerRequest`. Every derived request — repair, workflow continuation, conflict, improvement — got a fresh request id with no anchored base, so `prepareBaseRootedWorkspace` found nothing and silently degraded to host-current application. The base-rooted integration of `adr/ADR-0035` was therefore absent from exactly the rounds most likely to need it: the ones correcting a patch while the host kept moving. `ADR-0035` calls applying a patch to a tree it was not authored against a dead end that no retry can resolve. It was happening on every repair round.

## Decision

Two request-side artifacts, each with one job, plus the missing base anchor.

### `harness.attempts/v1` — the session attempt ledger

Session-scoped state keyed by the Main Request root, carried on every wave and discarded at the terminal boundary.

It has two halves with different authorities.

**Wharnex measures the rounds.** Each round records its request id, kind, plan id, outcome classification, the argv that ran with exit codes, and one actionable detail line. This is Wharnex's own evidence, never a planner claim. A failed round reaches the next request whether or not the model chose to write it down — which is the entire reason the two halves are separate.

**The planner writes the narrative.** Every response bundle carries `attempts/ledger.md`: a cumulative account of what has been proven to work and to fail on this machine, in five required sections — Goal, Works locally, Does not work locally, Open hypotheses, This round. "Does not work locally" is a hard exclusion list, each entry stating symptom, cause, and the round that proved it. "This round" must state explicitly why the current approach differs from every excluded one.

The narrative is a full replacement each round, never a delta, so a garbled or dropped round cannot corrupt accumulated conclusions. The measured rounds are authoritative: the planner may explain them, never contradict or omit them.

The ledger is scaffolding, not truth. It is discarded when the Main Request ends. A repair/continuation that receives measured failure evidence must promote any reusable cause or repair strategy into `knowledge/index.json` in that same response, not only when the attempt budget is exhausted: a successful verification/Apply does not create another planner turn in which to learn retroactively. The expected-last-round reminder remains a final consolidation guard. Wharnex also reports `knowledge.promotion_missing` when a terminal request had measured repair evidence but the durable catalog did not change, making a missed promotion observable without rejecting an otherwise verified change. That is where the separation earns itself: the ledger is where the conclusion is worked out, the knowledge catalog is where it is kept.

### `harness.context-delta/v1` — local project divergence

Every continuation carries a report of exactly how the local project moved since the snapshot the planner already holds.

Divergence is measured against the **root** request's anchored base, never the previous round's. The planner holds one complete baseline and every later round is a correction on top of it, so a root-anchored report is self-healing: a report that was lost, truncated, or never read does not break the chain, because the next one still describes the full divergence.

The report leads with a verdict — UNCHANGED, a file list, or UNKNOWN — because that is the decision the planner makes before reading anything else. UNCHANGED is a positive, load-bearing answer: it tells the planner a patch that failed to apply did *not* fail because the tree moved, so the real cause lies elsewhere. UNKNOWN is stated as such; reporting "no files changed" when Wharnex could not measure would be a lie the planner acts on.

Small diffs are inlined into the prompt. Every transport delivers the prompt; only some deliver side files, and a reference to an attachment the runtime never fetched is worth nothing. Larger diffs travel as `context-delta/delta.patch`, and an oversized one is refused rather than truncated — half a hunk is not a patch.

### Every continuation anchors its own base

`prepareContinuation` runs immediately after each continuation's context refresh, anchoring that request's base tree and measuring the divergence together, so the anchor always describes the snapshot the planner was shown.

## Degradation

Both artifacts are bookkeeping whose purpose is to make the *next* round cheaper. Neither may ever cost the current one.

- A missing or oversized `attempts/ledger.md` is recorded as a degradation and the previous ledger is retained. Rejecting a bundle over it would discard a verified patch to protect a note about patches.
- Ledger staging is independent of knowledge staging, so a catalog revision race cannot also cost the Main Request its record of what already failed.
- An unmeasurable divergence falls back to manifest-level changed paths, then to an explicit UNKNOWN verdict.
- Base capture stays best effort: a project with no commit, or any Git refusal, degrades to the previous behavior.

## Consequences

- A correction wave starts from every earlier wave's conclusions instead of the last failure alone.
- Approaches proven to fail locally are an explicit exclusion list rather than something the planner must remember.
- A continuation states what changed instead of implying it, so the planner rebases its pending edit rather than re-reading the project.
- Repair rounds regain base-rooted integration, turning "patch does not apply" back into an ordinary three-way merge.
- Session-scoped learning no longer has to masquerade as durable project knowledge to survive one round.
