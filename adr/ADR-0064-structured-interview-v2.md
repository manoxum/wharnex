# ADR-0064: Multi-wave structured interview v2

## Status

Accepted.

## Context

The v1 interview made one bounded choice easy to answer, but it had no open
answer contract, the UI did not honor multi-select, and each clarification was
accounted like an autonomous planner attempt. Large or ambiguous requests need
several focused decision waves without burning the execution/recovery budget or
being mistaken for separate Main Requests.

## Decision

New interviews use `harness.interview/v2`; v1 stays readable for durable
compatibility. V2 keeps 1..8 questions and 2..8 labelled options per question,
supports `allow_multiple`, and requires `allow_other=true` on every question.
The open Other response is a first-class escape from an incomplete option set.

The valueless composer directive `@interview` canonicalizes to
`@{[interview]}` and forces an initial interview wave. Without it, the planner
may activate the same protocol when a material ambiguity would change scope,
safety, architecture, UX, data semantics, or acceptance criteria. Questions are
asked in focused waves; an answer is sent as an interview continuation whose
request lineage remains under the original Main Request. Another v2 wave is
valid while material ambiguity remains; otherwise the planner resolves the
original request.

A completed structured-interview turn is credited back from
`AutomationAttempt`. Submitting its answer temporarily advances the attempt
before asking the planner again; another interview credits that round back,
while the first substantive terminal result or executable result retains the
normal attempt cost. Thus interview depth does not consume the effort budget.

The frontend accumulates single/multi-choice selections and free-form Other
text, then prepares one readable reply in the composer. It never auto-submits.
Interview data remains non-executable and grants no scope, project authority,
or execution consent.

## Consequences

- Ambiguous requests can converge through as many human decision waves as are
  needed without consuming autonomous retry capacity.
- Every question has a safe escape from the proposed choices.
- `@interview` gives the operator an explicit protocol trigger without creating
  a new transport or authority surface.
- Existing v1 bundles remain valid, while new provider output converges on v2.
