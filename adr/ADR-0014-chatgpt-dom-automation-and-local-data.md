# ADR-0014 — Narrow ChatGPT DOM transport and local-data lifecycle

## Status

Accepted; amended for v1.2.21, v1.2.26, v1.2.31, v1.2.38.1, v1.2.42.3 and the 2026-09-25 DOM maintenance.

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

### Upload-thumbnail observation

For a file that Wharnex itself has just selected, the bridge may passively poll
the composer-owned upload thumbnail. When file metadata exists, the probe is
correlated by the exact local basename. When the current preview exposes no
filename metadata, it instead compares a bounded structural marker count taken
immediately before and after native file selection. It may return only
`visible`, that count, a bounded numeric progress value, an active bit and a
completed bit derived from structural attributes (`data-*`, `aria-valuenow`,
`role=progressbar`, or a composer-local spinner class). It must not read text
content, assistant turns, cookies or storage. A 100%/completed thumbnail
confirms completion. Existing narrow network confirmation remains a fallback
for UI revisions that expose no progress attributes.

When the provider uses its current ZIP-preview shape — an indeterminate
composer-local spinner without a numeric value — observing that spinner starts
the upload and its disappearance confirms completion. The bridge reports no
invented percentage in that state.

The current composer may expose separate media and general-file inputs. A ZIP
selection resolves the explicit upload input first, then a composer-scoped file
input with no `accept` restriction; a generic `multiple` input is only a final
compatibility fallback. This prevents a successful native selection from being
sent to the image/video listener while the transport waits for an upload that
can never start.

The visible-reasoning probe first selects only visible provider containers whose
`data-testid` identifies reasoning, thinking, or analysis, or whose semantic
class token is the provider's `group/activity-header`. The latest
`data-chatgpt-agent-turn-start` marker bounds the active turn: all activity
headers inside that turn and only leaf `data-markdown-text-style` row boundaries
inside a visibly expanded header's sibling body may be read, including nested
activity summaries. A row is captured at that boundary because provider
animation may split one visible line across several otherwise meaningless spans.
If no such turn-scoped container exists, the legacy current-turn path remains
available and excludes every assistant turn. Both paths exclude code, Markdown,
tool/output regions, screen-reader-only regions and controls; a collapsed
disclosure is never opened. This preserves the visible-reasoning exception
without turning it into response-prose scraping.

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

### 2026-10-08 transport idempotency and responsive composer

An automatic preparation holds the owned native composer at 1280 × 900 through
preflight, upload and submit, including when presented in the browser monitor.
Project mirror geometry is retained and restored when the last hold ends.
Reasoning effort is verified before any composer mutation or file selection.
An unavailable effort control or ambiguous file selection enters `ATTENTION`
instead of replaying the complete request ZIP through the scheduler.

A retry first checks exact input-file metadata in the owned user turn. When
that proves an existing submission, it adopts durable exact-result supervision
without another upload or submit; failure to persist that supervision disarms
the in-memory expectation. Submitted-only maintenance fails closed if its
concrete conversation or input evidence is missing. Transport/stall attention
keeps exact-file capture active, while authentication/access/manual gates still
block it. No completion is inferred from generated answer or reasoning text.
The adopted task persists `observation_only=true`; hydrating it restores the
exact-only gate across Desktop restarts, including when another pool observes
the task. Legacy ordinary supervision remains ordinary only in its existing
live expectation. Cold task hydration awaits durable recovery history and
restores passive supervision, including for missing/false legacy flags.
Passive payloads reinforce an existing expectation without resetting its age,
progress or spent budget. Historical idle
completion does not extend this passive lease or authorize a recovery write.
The submitted-request resume operation also creates observation-only
supervision for historical ordinary tasks. It preserves live/task continuation
counts and a spent continuation recorded by request-scoped recovery events;
ledger failure cannot grant write authority. Progress uses the durable
successor task id rather than the retired task or an empty lineage.
An explicitly submitted output correction starts a fresh response observation
window and retires only transport/stall attention for its same owned request.
The request TTL and spent automatic continuation budget remain intact;
authentication/access/verification are not cleared. Its next durable
supervision retains metadata and records progress against the successor task.

Live observation also confirmed agent turns marked with
`data-chatgpt-agent-turn-start` while author-role wrappers are absent. The
response observer counts that marker and checks its order against the latest
user-message wrapper. Download lookup accepts that turn boundary for fresh
capture and excludes submitted user/composer controls before reading file
metadata, so a requested filename in the bootstrap cannot trigger a download.

The definitive conversation's selected effort may share an inline wrapper with
an icon. The leaf-only observer missed `Elevada` while reporting only the model
selector, reasoning title and `5.6`. Keep the leaf path and add bounded direct
text nodes of visible wrappers inside that single composer control. Exact
mapped-level matching remains mandatory; neither model version nor generic
control labels authorize a submit.

Background Auto transport becomes independent of Inspector visibility and can recover an expected bundle as soon as its download control appears. The trade-off is a small DOM selector compatibility surface that can change with ChatGPT UI revisions; selectors must therefore stay minimal, covered by regression tests, and fail closed.

Browser-session backups may contain authenticated browser material even though Wharness never decodes it. Users must protect those files like credentials. Full reset is destructive to Wharness state and therefore requires the literal confirmation `APAGAR WHARNESS`.
### v1.2.27 visible activity and in-flight comments

The narrow bridge may additionally observe **only activity/reasoning text that ChatGPT visibly renders in the current UI** together with the visible stop-generation state. Wharness may surface that material as ephemeral thought/activity in its own transcript. It must not infer, request or extract hidden chain-of-thought, inspect non-visible model state, read arbitrary page prose, cookies/storage, or broaden the download trust boundary.

While the same Wharness request is in flight, the renderer may queue a user comment for that bound conversation. The main process submits a bounded text-only continuation only after the existing composer is ready and prefixes it with an invariant that preserves the same task/request and exact canonical bundle deliverable. The comment does not arm a new expected bundle or create a new planner request.

### v1.2.31 native-overlay ownership and comment idempotency

> Superseded for overlays (v1.3.42): agent views now live in the browser host window and project windows show only an interactive mirror, so no native view can paint above renderer DOM and overlays no longer suspend anything (see `SoT/ARCHITECTURE.md`). The comment-idempotency rules below still apply.

Electron `WebContentsView` is a native sibling surface that can paint above renderer DOM regardless of CSS z-index. Wharness therefore treats visibility as a main-process capability, not a styling problem: whenever the renderer contains an aria-modal dialog or an explicit trusted overlay blocker, the ChatGPT view is hidden and is shown again only when the blocker disappears. Context menus and error popups that can intersect the embedded region opt into the same blocker contract.

Task-comment delivery is single-flight per ChatGPT cache key. The queue owns one in-flight head item; periodic retry cannot submit that same head concurrently. A bounded recent identifier cache protects IPC retries, and a short content/attachment fingerprint window protects accidental duplicate renderer dispatches with different transient identifiers. Both are transport idempotency mechanisms only and do not inspect ChatGPT response prose.
## v1.2.38.1 bounded request re-hydration

For an active expected Wharnex bundle, Desktop maintains per-request liveness state using only transport errors, renderer health, assistant-turn counts and structural processing state. Recoverable connection/socket/main-frame failures reload the same owned `WebContentsView`. Mere silence or an ambiguous stale processing control never injects a recovery prompt; it escalates for human attention. A positively completed response without the canonical bundle may use the single bounded delivery-continuation path.

Named account-management commands are a separate allowlist: exact project lookup/creation, move of the owned conversation, `WHX:` rename, stop/archive and sidebar collapse. They inspect only controls and the exact requested project/title values. There is no generic selector or arbitrary-script IPC, and any unsupported surface fails closed.

This recovery is intentionally bounded. It does not inspect arbitrary assistant prose to make decisions, does not change the original request or scope, does not access another chat's renderer, and does not create an unbounded retry loop.

Manual **Retomar pedido** uses that same compact delivery-continuation path in
the already-linked conversation. It does not reconstruct project context or
upload the request ZIP again. The manual action may be used after the one
automatic wake-up was exhausted, while preserving request identity, affinity,
active-transport and validated-bundle guards.

Supervisor transport serialization is per physical Supervisor instance. A
write in one instance cannot place unrelated chats owned by another instance
behind a process-global transport tail; a pending or active write still pins
its own instance until the operation settles.

### v1.2.42.3 liveness qualification

Recovery fault probing and liveness classification are separate concerns. A probe that has no current structural snapshot may act only on an already-recorded transport/renderer fault; missing fields are never negative evidence that ChatGPT stopped. Desktop also tracks the lifecycle of allowlisted ChatGPT conversation requests. While one of those requests is in flight, heuristic silent/surface recovery is suppressed even if a transient DOM probe does not see the processing control. Automatic expected-bundle supervision is armed before submission so immediate request failures are correlated to the correct Harness request. Generic Chromium `ERR_FAILED` is considered recoverable only on that allowlisted conversation transport, not on arbitrary ChatGPT resources.

### Model choice boundary (2026-10-09)

The human composer model chooser reads only the owned model-switcher menu through named inventory/selection operations. Exact offered labels and selected/disabled flags are bounded to 32 models of 120 characters; no assistant text is read and no model names are baked into the product. A confirmed selection is local per-chat configuration, revalidated before archive upload and verified again before submit. Selection does not waive reasoning-effort validation. This adds no planner IPC or arbitrary selector/script capability.

### Expected download selection observability (2026-10-09)

A manual click followed by a valid response ZIP proves download ingestion, not automatic affordance selection. The named exact-download operation now exposes categorical structural diagnostics from its existing selection scan, with an engine-owned expected filename. Counts and bounded control shapes are logged without answer text or URLs. Skip reasons explain ownership, attention, preparation and in-flight gates. Selection remains unchanged until a real measured shape justifies a correction; diagnostics cannot trigger a continuation or relax strict validation.


### Expected response artifact controls — 2026-10-09

The 2026-10-09 passive control diagnostic proved the exact expected response ZIP existed on visible SPAN role=link controls, while the capture selector covered role-button but omitted role-link. Extend capture narrowly to exact filename tokens in bounded role-link attributes within the owned conversation main. Wrong names and generic links cannot enter fallback, and this path reads neither answer prose nor href. The operation still activates only the expected artifact and validates downloaded bytes through the existing strict protocol.
