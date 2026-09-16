# ADR-0057: Informed execution contract and bounded debug protocol

## Status

Accepted.

## Context

An executable bundle previously exposed commands and patches but did not give the operator one coherent place to understand the implementation, dependency changes, operating-system requirements and exact diffs before consenting. Evidence workflows were restricted to copied sandboxes even when a defect existed only in the running host. Repeated approval of every repair round made Protected automation tiring, while decorative tab animation did not identify a concrete unresolved decision.

## Decision

New plans use `harness.execution/v2`, which adds a Markdown `document`, typed `dependencies`, and typed `system_tools`; `harness.execution/v1` remains readable for persisted/in-flight compatibility. Newly prompted change bundles must populate all three, using empty arrays when there is no dependency or system-tool impact. Exact operations and patches remain authoritative; prose never grants execution authority.

A new `harness.debug/v1` extension may be attached only to a `workflow` plan. It declares `target=sandbox|host` and a rationale. Every debug step remains argv-only, patch-free, network-disabled, bounded to the existing six workflow rounds, validated by Policy, and its output is untrusted evidence. Sandbox debug uses the disposable copied workspace. Host debug uses a closed read-only command vocabulary and can neither mutate files nor invoke arbitrary readers, shells, package managers, privilege tools, or Docker.

When Debug mode is off, the first debug step of each Main Request root waits for one explicit authorization; derived debug rounds inherit only that root authorization. When Debug mode is on, valid debug steps may proceed automatically. Toggling it off clears the standing grant. No debug grant approves a later change, network access, dependency installation, system-tool change, host Apply, or Unprotected execution.

In Protected Auto, a newly authored root change with the enriched contract waits for one informed execution decision. Repair/evidence descendants then proceed automatically unless Policy discovers a new approval boundary, especially network, package mutation, or host tool installation/configuration. A plan produced by an explicitly approved Plan-first continuation is already covered by that decision. Persisted pre-contract plans retain their historical behavior. Unprotected remains explicit, manual, and confirmed per execution as required by the root security model.

The Plan surface is the decision workbench: it shows the document, dependency and system-tool inventories, exact diffs, verification commands, Policy reasons, and accept/reject actions. Global tab state is static and evidence-based; unresolved items expose a titled alert/count instead of indefinite blinking. Chat Markdown parsing is memoized and off-screen transcript items may skip layout/paint through `content-visibility` without unmounting or losing features.

## Consequences

- The operator can make one informed root decision and inspect exactly what will change.
- Automated correction stays fluid without widening authorization.
- Host diagnosis is possible without turning workflow into a generic host command channel.
- Old stored bundles remain readable; new planner output is richer.
- Debug is diagnostic evidence only and cannot be smuggled into a change plan.
