# ADR-0014 — Narrow ChatGPT DOM transport and local-data lifecycle

## Status

Accepted.

## Context

The browser-backed ChatGPT provider already owns a sandboxed `WebContentsView`, a dedicated persistent partition, strict request-id/bundle validation, and an explicit project Auto mode. Native keyboard/mouse replay proved insufficient for background operation: a hidden view could receive prepared files yet fail to submit, and a completed response could expose the expected bundle download without the Wharness transport recovering it. Separately, operators need lifecycle controls for the embedded browser session and visibility into Wharness-owned disk usage.

A Policy rejection is also an expected automation outcome, not an execution crash. Hiding its reason or leaving the repair loop idle makes Auto mode stall even though the backend already knows the exact denied executable or rule.

## Decision

Wharness permits a **narrow, allowlisted DOM transport bridge** inside the isolated ChatGPT `WebContentsView`. It may only:

1. locate/focus the ChatGPT composer;
2. write the already-prepared Wharness prompt into that composer;
3. activate the submit control; and
4. activate the download control associated with the exact expected `wharness-bundle-<request_id>.zip`.

Those operations may run while the ChatGPT view is hidden when the project is explicitly in Auto mode. Wharness does not scrape response prose, enumerate arbitrary DOM, read cookies/local storage, inspect authentication state, or use DOM text to infer model completion. The existing `will-download` boundary and backend bundle validator remain authoritative; a DOM click never makes downloaded bytes trusted.

A Policy-blocked Auto bundle now emits an explicit non-execution event containing the denial reason and enters the existing bounded repair loop. The repair prompt must request a Policy-compatible alternative and must not ask the model to weaken, bypass or reconfigure Policy.

Wharness also adds explicit local-data lifecycle controls:

- browser-session export/import uses an opaque Wharness backup file and is presented as secret material;
- import validates entries and is committed at restart before the persistent partition is opened;
- browser-session clear invalidates embedded browser state only;
- full Wharness clear removes Wharness-owned state, contexts/sandboxes, attachments, audit and temporary data but **never deletes the user's project directories/files**;
- storage metrics expose Wharness totals and per-project Wharness-owned usage without traversing or charging the project working tree itself.

## Consequences

Background Auto transport becomes independent of Inspector visibility and can recover an expected bundle as soon as its download control appears. The trade-off is a small DOM selector compatibility surface that can change with ChatGPT UI revisions; selectors must therefore stay minimal, covered by regression tests, and fail closed.

Browser-session backups may contain authenticated browser material even though Wharness never decodes it. Users must protect those files like credentials. Full reset is destructive to Wharness state and therefore requires the literal confirmation `APAGAR WHARNESS`.
