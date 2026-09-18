# ADR-0060: Interactive observation and structured interview contract

## Status

Accepted.

## Context

The legacy `harness.debug/v1 access=modify` path let a planner place a large
program in an argv argument and execute it on the host after one approval. A
cleanup incident demonstrated the missing safety stages: no candidate inventory
was shown, no immutable selection was approved, discovery and deletion shared
one program, and a failed discovery was followed by another destructive plan.

## Decision

The user-facing mode is **Interativo**. New workflow bundles use
`harness.interactive/v1`; `harness.debug/v1` remains readable only for
persisted and in-flight compatibility. Both variants are observation-only.
Host-modifying debug workflows are retired and fail closed. The existing
`debug` field and session properties remain internal compatibility names until
a data migration can retire them safely.

Interactive workflows may use a four-times evidence budget: at most 24
materially distinct rounds, instead of the ordinary six. This is a reasoning
budget, not authority: every round remains argv-only, network-free, patch-free,
low/medium risk, bounded, and either Protected-sandbox or closed host
observation. It never performs deletion, deployment, package installation,
Docker, SSH, privilege escalation, Git mutation, or arbitrary script execution.

Destructive or external work requires a future dedicated typed-operation module.
Its interface must own inventory collection, immutable candidate manifests,
dry-run/preflight, explicit scoped approval, drift revalidation, execution, and
postcondition verification. It must not accept model-authored shell text or a
generic argv escape hatch.

A `clarification` turn may carry `harness.interview/v1`: 1..8 neutral
questions, each with 2..8 bounded options. The frontend copies a selected
answer into the composer; it never submits automatically. Interview data is
validated like all turn data and cannot carry execution semantics.

## Consequences

- The unsafe cleanup path is blocked before host execution.
- Interactive investigation can converge through more small evidence exchanges
  without creating an unbounded retry loop.
- Ambiguity is a durable, structured human decision point rather than guessed
  execution intent.
- Git release, Docker, remote SSH, package repair and destructive storage work
  remain unavailable until each has a reviewed typed capability.

## Historical note

The observation-only restriction in this ADR remains the permanent contract of `harness.interactive/v1`. ADR-0063 introduces a distinct `harness.interactive/v2` protocol for typed, scoped runtime capabilities with explicit consent; v2 does not reinterpret or broaden a v1 grant.
