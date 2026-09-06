# ADR-0014 — Narrow ChatGPT DOM transport and local-data lifecycle

## Status

Accepted; amended for v1.2.21, v1.2.26, v1.2.31, v1.2.38.1 and v1.2.42.3.

## Context

The browser-backed ChatGPT provider already owns a sandboxed `WebContentsView`, a dedicated persistent partition, strict request-id/bundle validation, and an explicit project Auto mode. Native keyboard/mouse replay proved insufficient for background operation: a hidden view could receive prepared files yet fail to submit, and a completed response could expose the expected bundle download without the Wharness transport recovering it. Separately, operators need lifecycle controls for the embedded browser session and visibility into Wharness-owned disk usage.

A Policy rejection is also an expected automation outcome, not an execution crash. Hiding its reason or leaving the repair loop idle makes Auto mode stall even though the backend already knows the exact denied executable or rule.

## Decision

Wharness permits a **narrow, allowlisted DOM transport bridge** inside the isolated ChatGPT `WebContentsView`. It may only:

1. locate/focus the ChatGPT composer;
2. write the already-prepared Wharness prompt into that composer;
3. activate the submit control; and
4. activate the pending result download control. Selection first matches the exact expected `wharness-bundle-<request_id>.zip` against download/link metadata. If ChatGPT omits the filename from the rendered control, Wharness may fall back only to one visible enabled file/download affordance contained in the newest assistant turn. If there are zero or multiple fallback candidates, it does nothing.

Those operations may run while the ChatGPT view is hidden when the project is explicitly in Auto mode. The fallback may inspect only narrow control metadata, file-like href shape, icon-only download labels, visibility/disabled state, and assistant-turn ancestry. Wharness does not scrape response prose, enumerate arbitrary page content for semantic analysis, read cookies/local storage, inspect authentication state from DOM content, or use response text to infer model completion. A separate main-process same-origin `/api/auth/session` probe may reduce the result to one boolean used only to suppress redundant login UI; it does not expose the returned session object or weaken the DOM transport boundary. The existing `will-download` boundary and backend bundle validator remain authoritative; a DOM click never makes downloaded bytes trusted.

A Policy-blocked Auto bundle now emits an explicit non-execution event containing the denial reason and enters the existing bounded repair loop. The repair prompt must request a Policy-compatible alternative and must not ask the model to weaken, bypass or reconfigure Policy.

Wharness also adds explicit local-data lifecycle controls:

- browser-session export/import uses an opaque Wharness backup file and is presented as secret material;
- import validates entries and is committed at restart before the persistent partition is opened;
- browser-session clear invalidates embedded browser state only;
- full Wharness clear removes Wharness-owned state, contexts/sandboxes, attachments, audit and temporary data but **never deletes the user's project directories/files**;
- storage metrics expose Wharness totals and per-project Wharness-owned usage without traversing or charging the project working tree itself.


### v1.2.26 composer-owned transport intent

Manual transport affordances for context ZIP, planner prompt and result bundle are removed from the ChatGPT header. The Wharness chat composer is the single trusted surface that declares which artefacts accompany the next iteration. The renderer may encode bounded Wharness-generated result/error artefacts and pass them through the existing narrow desktop attachment transport; the main process validates count, size and filename uniqueness before materialization. This does not broaden the permitted remote DOM surface: ChatGPT interaction remains limited to composer file input/fill, submit and exact-result download control.

The legacy Desktop manual fallback panel is removed. File-first request/bundle validation remains authoritative.

## Consequences

Background Auto transport becomes independent of Inspector visibility and can recover an expected bundle as soon as its download control appears. The trade-off is a small DOM selector compatibility surface that can change with ChatGPT UI revisions; selectors must therefore stay minimal, covered by regression tests, and fail closed.

Browser-session backups may contain authenticated browser material even though Wharness never decodes it. Users must protect those files like credentials. Full reset is destructive to Wharness state and therefore requires the literal confirmation `APAGAR WHARNESS`.
### v1.2.27 visible activity and in-flight comments

The narrow bridge may additionally observe **only activity/reasoning text that ChatGPT visibly renders in the current UI** together with the visible stop-generation state. Wharness may surface that material as ephemeral thought/activity in its own transcript. It must not infer, request or extract hidden chain-of-thought, inspect non-visible model state, read arbitrary page prose, cookies/storage, or broaden the download trust boundary.

While the same Wharness request is in flight, the renderer may queue a user comment for that bound conversation. The main process submits a bounded text-only continuation only after the existing composer is ready and prefixes it with an invariant that preserves the same task/request and exact canonical bundle deliverable. The comment does not arm a new expected bundle or create a new planner request.

### v1.2.31 native-overlay ownership and comment idempotency

Electron `WebContentsView` is a native sibling surface that can paint above renderer DOM regardless of CSS z-index. Wharness therefore treats visibility as a main-process capability, not a styling problem: whenever the renderer contains an aria-modal dialog or an explicit trusted overlay blocker, the ChatGPT view is hidden and is shown again only when the blocker disappears. Context menus and error popups that can intersect the embedded region opt into the same blocker contract.

Task-comment delivery is single-flight per ChatGPT cache key. The queue owns one in-flight head item; periodic retry cannot submit that same head concurrently. A bounded recent identifier cache protects IPC retries, and a short content/attachment fingerprint window protects accidental duplicate renderer dispatches with different transient identifiers. Both are transport idempotency mechanisms only and do not inspect ChatGPT response prose.
## v1.2.38.1 bounded request re-hydration

For an active expected Wharnex bundle, Desktop maintains per-request liveness state using only transport errors, renderer health, assistant-turn counts and structural processing state. Recoverable connection/socket/main-frame failures reload the same owned `WebContentsView`. Mere silence or an ambiguous stale processing control never injects a recovery prompt; it escalates for human attention. A positively completed response without the canonical bundle may use the single bounded delivery-continuation path.

Named account-management commands are a separate allowlist: exact project lookup/creation, move of the owned conversation, `WHX:` rename, stop/archive and sidebar collapse. They inspect only controls and the exact requested project/title values. There is no generic selector or arbitrary-script IPC, and any unsupported surface fails closed.

This recovery is intentionally bounded. It does not inspect arbitrary assistant prose to make decisions, does not change the original request or scope, does not access another chat's renderer, and does not create an unbounded retry loop.

### v1.2.42.3 liveness qualification

Recovery fault probing and liveness classification are separate concerns. A probe that has no current structural snapshot may act only on an already-recorded transport/renderer fault; missing fields are never negative evidence that ChatGPT stopped. Desktop also tracks the lifecycle of allowlisted ChatGPT conversation requests. While one of those requests is in flight, heuristic silent/surface recovery is suppressed even if a transient DOM probe does not see the processing control. Automatic expected-bundle supervision is armed before submission so immediate request failures are correlated to the correct Harness request. Generic Chromium `ERR_FAILED` is considered recoverable only on that allowlisted conversation transport, not on arbitrary ChatGPT resources.
