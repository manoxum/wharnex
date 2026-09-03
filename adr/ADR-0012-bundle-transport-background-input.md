# ADR-0012 — Canonical bundle transport and background ChatGPT input

## Status

Accepted.

## Context

Consumer ChatGPT can rename generated attachments, add visible prose despite a file-first instruction, or package otherwise valid execution metadata with harmless transport/layout mistakes. The Desktop automation also previously switched the Inspector to ChatGPT and explicitly focused the remote `WebContents`, interrupting editor and terminal work.

Wharness must remain strict about executable semantics and request correlation while being tolerant only of non-executable transport mistakes. It must also be able to prepare/submit ChatGPT input without moving the OS pointer or intentionally taking keyboard focus from trusted local surfaces.

## Decision

1. Manual planner prompts start with an explicit `FILE_ONLY` mode and the exact canonical filename `wharness-bundle-<request_id>.zip`, prohibit visible prose, require the ZIP root layout, and require a self-check before attachment.
2. After a manual/Auto draft is submitted, Desktop records the expected request id for that chat for a bounded period. A generic ZIP download may be renamed to the canonical filename only for that active pending request. A different valid Wharness request id is rejected and never rewritten.
3. Bundle parsing may normalize only non-executable layout mistakes: one common wrapper directory, missing README documentation synthesized from already structured turn/plan text, and a referenced root-level patch basename moved logically under `patches/`. It does not invent plans, operations, commands, patches, request ids, or policy decisions.
4. Automatic ChatGPT transport does not change the visible Inspector tab and does not call `WebContents.focus()`. Synthetic input is sent directly to the remote `WebContents`; it does not move the OS pointer. Explicit user bridge actions may still focus ChatGPT.
5. Existing protocol validation, pending-request correlation, Policy Engine checks, sandbox execution, verification, and host-apply rules remain authoritative after transport normalization.

## Consequences

- Generic ChatGPT attachment names no longer prevent an otherwise valid pending bundle from being imported.
- Incorrect/malicious request ids and missing executable content remain hard failures.
- The user can continue working in Editor/Terminal while automatic ChatGPT transport runs in the background.
- Consumer-web automation remains best-effort transport. Deterministic unattended planning should use the supported provider adapter.
