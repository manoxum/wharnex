# ADR-0087 — Mandatory bundles for GPT processing and UI discovery

Status: Accepted
Date: 2026-10-02

## Decision

Every Wharnex-owned GPT processing/reasoning exchange uses request and response
bundles, including UI discovery and utility work. The normative root now states
this requirement explicitly. Instructions and inputs stay inside the archive;
only bounded routing/identity bootstrap text stays in the composer. Deterministic
account controls and direct human browsing are outside the processing contract.
The old temporary-title exception in the bundle SoT is superseded. Its retained
durable task types are compatibility sinks and submit no provider prompt.

UI discovery already has an engine-built ZIP request and ZIP response parser.
Preserve its shipped names and v1 protocol IDs, strengthen exact task correlation
before upload and strict JSON termination before persistence, and cover attachment
and response validation with regression tests. No inline/prose fallback is added.

## Compatibility

Valid existing UI discovery bundles remain accepted. Foreign task request names,
trailing response content and special ZIP entries are rejected. This change does
not alter execution permissions.
