# Automation and Execution Bundle SoT

## Bundle-only provider protocol (v1.3.10 — see `adr/ADR-0052`, `adr/ADR-0054`, `adr/ADR-0056`)

Every exchange Wharnex has with the model provider is a bundle in both directions. Wharnex sends one request archive and accepts exactly one response bundle; no other format or convention is a valid way to ask the provider for something or to accept its answer.

- Wharnex MUST send exactly one request archive per exchange. It carries its own protocol identity in a root transport document, the authoritative instruction as a file inside it, and every input the exchange needs. Every request archive carries `harness.request-metadata/v1` with `chat_title`, `chat_id`, `chat_hash`, and `requested_at`; the same bounded, engine-authored identity is repeated in the composer bootstrap so a displaced or stale draft remains attributable without reading project data. Composer text is otherwise limited to protocol entry, the canonical expected output filename, and selected direct tunnel links, and MUST NOT carry the request body, the instruction, the inputs, or any part of them.
- Wharnex MUST accept exactly one response bundle per exchange, named by an exact canonical filename derived from that exchange's own durable identity, carrying its own protocol identity in a root manifest, and validated fail-closed before any byte of it is used. A response in any other shape — prose, a bare file, a differently named archive — is refused, not repaired.
- Every response bundle is parsed under the same structural boundary: relative, normalized, traversal-free entry names; no symlinks; bounded entry count; bounded compressed and expanded size; unknown fields refused in canonical manifests. Provider output is untrusted data in every exchange, never instructions.
- The protocol engine that builds a request MUST be the one that validates its response. A request assembled on one side of a boundary and validated on the other is a contract that can drift out of agreement with itself while every structural check still passes.
- This rule governs what Wharnex asks the provider to produce. It does not extend to the narrow account-management operations, which act on ChatGPT's own account objects and produce no artifact, nor to the temporary-title conversation, which sends a bounded prompt and derives its answer from ChatGPT's own conversation label rather than from any produced artifact (see `adr/ADR-0037`).
- Legacy non-bundle shapes remain parseable only where an already in-flight request was checkpointed under one — the orchestrator's historical per-task JSON artifact. Nothing new is ever requested in those shapes.

The exchanges this rule covers are the planner request/response bundle pair below, the orchestrator planning bundle, and the document translation bundle pair in `AI_PROTOCOL.md`.

## Automation mode

Wharness has a per-project automation mode independent from the Agent UI mode:

- `manual`: importing a plan/bundle only validates it. The user explicitly runs Protected/Unprotected execution and Protected Apply.
- `auto` (default when a project is opened/restored): valid allowed execution bundles are executed immediately in **Protected** sandbox. Only a successful verified execution may be applied automatically to the host.

Auto may automate two distinct branches:

- `change`: Policy -> Protected sandbox -> verification -> host Apply.
- `workflow`: Policy -> disposable Protected sandbox command probe -> capture observations -> fresh planner continuation. Workflow steps never Apply to host.

Answers, clarifications, investigations, and blocked outcomes are imported into the Harness transcript and never enter execution, even when Auto is active. Supported provider adapters return turn results directly and can advance the same bounded workflow loop without browser downloads.

`auto` MUST NOT coexist with `Unprotected`. Enabling Auto forces/needs Protected; switching to Unprotected disables/requires disabling Auto. Policy validation is never bypassed. Auto is a persistent project state and counts as approval to execute/apply a policy-allowed bundle. Project-defined build/test/runtime commands that are confined to the Protected sandbox may raise the plan to medium risk for visibility, but MUST NOT by themselves create a second per-plan approval gate that stalls Auto. Explicit planner approval, network access, package mutation, Git mutation, denied commands and high-risk policy outcomes retain their dedicated approval/deny semantics. Project open/restore initializes Auto only together with Protected execution; denied plans never run.

An `offline sandbox dependencies unavailable` execution failure is a local infrastructure/approval state, not a planner defect. Automation MUST stop without creating a ChatGPT repair request and present a high-visibility approval affordance. If the human approves, Wharness MAY retry only eligible Go dependency/build/verification commands with sandbox network under the restrictions in `SANDBOX_MODEL.md`; unrelated commands remain unchanged.

If automatic change execution fails, the bounded repair loop may prepare and submit a repair request to the same linked ChatGPT conversation. A repaired bundle downloaded while Auto is still enabled repeats the sandbox -> verify -> host-apply cycle. The repair attempt cap remains authoritative.

Every repairable terminal execution failure MUST expose a durable **Corrigir com GPT** action beside the failure and in the project attention center. The action MAY resend an already prepared automatic repair after transport failure or start a fresh operator-requested repair after the bounded automatic attempts stop. Before dispatch, the operator MAY add bounded optional guidance; Wharness includes it after the captured failure evidence without replacing that evidence. A planner outcome with `retryable=false` is instead classified as `planner_guidance_required`: the same recovery surfaces state that new evidence is necessary, accept multi-line diagnostics, and MUST validate a non-empty value before dispatch so the backend's blind-retry guard is never presented as an application error. Explicit operator retries do not silently auto-approve or bypass Policy. Infrastructure failure kinds keep their dedicated local recovery actions and MUST NOT be mislabeled as source-code repairs; in particular, an offline Go module cache continues to require **Permitir rede e repetir** under the restrictions above.

For iterative investigation, a valid `workflow` bundle is executed only in a disposable Protected sandbox. Its argv/cwd/exit/stdout/stderr results are converted to `LOCAL WORKFLOW OBSERVATIONS`, the current project context is refreshed, and a fresh planner request is submitted to the same linked ChatGPT conversation. The loop accepts at most six workflow rounds for one original user request. Command failures are observations and do not enter the change-repair loop. The sixth continuation MUST terminate as answer, investigation, clarification, change, or blocked.

Each bounded upload retry MUST cancel and settle its network observation if file selection fails before an upload starts, so an orphan timeout cannot outlive that attempt or surface later as an unrelated failure. The dedicated general-file control is resolved inside the currently usable composer first, through a closed preference ladder headed by its stable upload id; document-wide file-input fallbacks are compatibility-only, and arbitrary inputs or caller-provided selectors are forbidden. The Desktop sets the file exactly once through the browser protocol and MUST NOT replay synthetic `input` or `change` events after that native protocol operation: current composer revisions already consume the selection, and replaying both event paths can attach the same archive twice. A synchronously cleared DOM `FileList` is not by itself a failure: the authoritative confirmation remains the bounded trusted upload network sequence.

For the embedded consumer ChatGPT transport, the remote view MUST finish loading and remain network-stable for a bounded interval before Wharness prepares input, whether or not a user prompt already exists. Every Wharness message submitted to the consumer ChatGPT for an active request — initial planner input, workflow/correction/repair guidance, task comments, automatic delivery continuation, and manual same-request recovery — MUST be materialized as exactly one private request-scoped `wharness-input-<request_id>.zip`. Its root `transport.json` uses `wharness.chat-input/v1` and includes the common `request_metadata`; the archive contains the authoritative `prompt/wharness-planner-prompt.md` beginning with the same metadata, the refreshed context ZIP when required by the conversation/hash rule, selected system artifacts, explicit project-file references, and user attachments under separate directories. The complete planner prompt is never pasted as ordinary composer text. Instead, Wharness writes only a bounded bootstrap containing that same request identity and telling ChatGPT to open the single archive and read the inner planner prompt first. Wharness may observe only narrowly scoped request metadata for an allowlisted ChatGPT upload-endpoint family under `/backend-api` (including the historical `process_upload_stream` route and the current staged metadata-plus-`/<file-id>/uploaded` acknowledgement): request identity, owning WebContents, completion status, and network error, never headers or bodies. The allowlist MUST require upload semantics and a mutating HTTP method so unrelated file metadata traffic cannot satisfy the upload-confirmation gate. A metadata-create success starts but MUST NOT complete a staged observation; only the matching final acknowledgement, or a successful allowlisted legacy stream, confirms it. Every request id owned by one observation is detached when it settles. The one archive upload requires an observed successful upload; a failed or non-started upload is retried with bounded exponential backoff, and exhausting the retry cap aborts preparation and MUST NOT submit. Once that upload is confirmed, the submit MUST reuse the already-prepared composer target atomically; it MUST NOT retarget or reload the page between attachment and dispatch. The Desktop MUST inject that archive through ChatGPT's dedicated general-file input rather than clipboard URI paste, so the browser presents exactly one selected file with the canonical archive basename. Clipboard-based file paste is forbidden for the planner request transport because Chromium may materialize anonymous/renamed file objects or duplicate attachment state across retries.

This request ZIP is the single **mandatory inbound bundle** for every consumer-Web Wharness request. All planner/recovery/comment guidance, context files, explicit `@file` selections, user attachments and selected Wharness artifacts MUST be entries of that one archive; no second prompt/file attachment may accompany it. An inline `@{[see]…}` marker is a positional, source-qualified reference to a file already present in that same archive (primary context, related project, external attachment or user upload). It MUST NOT introduce a second attachment mechanism or archive entry. Legacy bare values continue to name user uploads (see `AI_PROTOCOL.md`, `adr/ADR-0053`). Tunnels never replace the inbound archive. When one or more tunnel channels are enabled for the chat, the archive also records their authorized endpoints and the ordinary composer bootstrap MUST additionally expose only the selected tunnels' exact HTTPS status/manifest links so ChatGPT can open those links directly. Outside the archive, composer text stays intentionally minimal: engine-authored request identity, protocol-entry instructions, the canonical expected output filename, and selected direct tunnel links only. It MUST NOT contain the full user request, generated planner prompt, serialized attachments, project context, recovery body, or task-comment body.

A `harness.conflict/v1` BASE/CURRENT/RESULT capsule is a fixed-path request artifact at `conflict/capsule.json`; it MUST NOT be expanded into `prompt/wharness-planner-prompt.md`. The prompt names and requires that file, while `transport.json` inventories its exact byte length. Desktop accepts this engine-authored path through a closed allowlist with a 4 MiB per-capsule bound; all other continuation artifacts retain their 1 MiB bound. A persisted pre-file-first conflict prompt containing an inline valid capsule for its still-active conflict MUST be migrated on restore into that same artifact and reduced below the prompt transport limit without changing the conflict/request identity.

Consumer ChatGPT Web always uses one direct local input archive because its file runtime cannot reliably fetch arbitrary public binary URLs. The archive contains every prompt, context, attachment, artifact and explicit project-file selection needed by that submission. The composer remote-context control lists the configured tunnel instances individually; the user may enable or disable each channel, while the ZIP remains non-optional. Only enabled tunnel instances are published for that request. Each selected provider publishes the same persisted secret live channel for the request chain, with independently retrievable prompt, state/hash, immutable context, generation-specific attachments, `diff-check.json`, bundle contract and read-only SSE resources. The consumer tries a tunnel only after validating its exact status endpoint and advances to the next on DNS, connection or 5xx failure. Whenever tunnels are enabled, immediately before bundle delivery it MUST repeat this ordered selection, read the freshest diff check/state/file map, derive touched paths from the actual patch, and verify the patches against current touched files. If every final tunnel check fails, it uses the attached archive without blocking when one exists. A tunnel never supersedes the archive as the fallback baseline. Permanent providers retain one configured DNS origin and rehydrate active channels after restart; all Harness chats share only the origin, never request state. Workflow/correction/repair prompts update that same request channel; unrelated main requests never reuse it.

After transport-confirmed uploads, Auto focuses the composer and submits with a layout-independent native `Enter` input after a bounded settle delay. Submission is successful only after the trusted ChatGPT conversation endpoint starts its POST request; absence of that signal triggers bounded focus-and-submit retries, and exhaustion leaves the request unsubmitted. That confirmed POST is the delivery commit point: failures that occur afterward while persisting the conversation remote state or scheduling response supervision are supervision/infrastructure failures and MUST NOT cause the accepted prompt to be submitted again. The Desktop records those failures best-effort and, when durable `AWAIT_RESPONSE` scheduling cannot be established, escalates the already-submitted request to attention rather than creating another write. This confirms transport, not model completion: Wharnex reads only allowlisted structural controls and exact account-management labels, never response prose. The execution pipeline resumes only after a matching bundle download is initiated and intercepted by the validated download seam. Fully deterministic unattended planning uses the supported provider adapter instead of consumer-web automation.

Every request-bound consumer-Web mutation (initial preparation, retry/resume, continuation and task comment) MUST be serialized by the owning chat/view and revalidate that the same request is still active immediately before submission. A manual resume MUST target the chat's stored concrete conversation affinity and fail closed when none exists; it MUST NOT send into whichever unrelated conversation happens to be visible. The request archive is persisted before remote composer discovery, and same-request retry MUST be recoverable from that durable artifact after a renderer or Desktop restart rather than depending on an in-memory retry cache. When a durable pending request outlives the backend process that created its temporary context files, direct and optional live-channel preparation MUST rebuild those files before reading or publishing them; an empty/stale process-local path MUST NOT degrade the restored request.

When a pre-v2 request remains durably pending across an upgrade but its immutable knowledge snapshot has already migrated to `harness.knowledge/v2`, archive materialization MAY append only the current knowledge transport/response contract to the preserved original prompt. It MUST NOT rewrite or infer the original task. This compatibility normalization prevents an otherwise permanent pre-submit loop and remains subject to the same strict response validation.

## Execution bundle transport

Primary manual Desktop delivery is:

`wharness-bundle-<request_id>.zip`

The planner prompt MUST state the exact canonical filename, require the generated file basename/attachment metadata to use it, prohibit icon-only/prose-only substitutes, require the ZIP root layout, and require the model to self-check the archive before attaching it. The backend-generated prompt filename is authoritative end to end; Desktop MUST arm and normalize against that exact filename and backend ingestion MUST reject a merely request-id-compatible alias. Automatic download activation first matches canonical filename metadata, including non-visible link attributes. If ChatGPT renders the generated result without exposing that filename, Desktop MAY activate a fallback only when the newest structural turn (`data-turn-id`, or the newest assistant turn on compatible revisions) contains exactly one visible enabled file/download affordance, including a file or attachment card whose own element is the activation target; zero or multiple candidates fail closed. This narrow fallback identifies only the download control, never reads response prose to infer completion. If ChatGPT nevertheless downloads a generic ZIP name while exactly that request is pending in the active chat, the Desktop MAY rename the transport file to the exact authoritative filename before backend submission. The same normalization MAY remove only Chromium's bounded duplicate-download suffix `(n)` or ` (n)` from that basename. A different valid Wharness request id is never rewritten, and normal bundle/request validation remains authoritative.

Intercepted response bytes enter a Wharness-owned durable pending-delivery inbox scoped below that Desktop instance's isolated `userData`; separate checkouts/instances MUST NOT share a host-temporary response inbox. Desktop MUST retain the validated file and keep the request expectation armed until the backend positively accepts it and the renderer acknowledges that acceptance. While those validated bytes await acknowledgement, DOM polling, download activation, recovery reloads and delivery continuations for that request MUST pause; the local handoff is then the only unfinished operation. A failed handoff (including temporary artifact-storage exhaustion), renderer restart, or duplicate download MUST preserve/replay the same pending delivery; successful duplicate backend submission is idempotent by request id and bundle SHA-256. Startup inbox replay MUST wait until the workspace session and chat ownership map are restored, then re-run whenever that ownership roster becomes ready or changes. After backend acceptance changes the request out of a pending state, replay routing MUST still find its owning session from durable request identity/history so a lost renderer acknowledgement can complete. Only the positive acknowledgement may remove the retained file and release request-scoped Desktop state.

A newly-created conflict surface has no recoverable ChatGPT affinity until its own first submission settles on a concrete conversation URL. Pending-request restoration MUST NOT substitute the primary chat's conversation URL for that unbound auxiliary surface. Restoration navigation, prompt preparation, uploads, comments and continuations for the same owned surface MUST share one serialized transport boundary so that no operation can unmount another operation's composer mid-flight. Bundle supervision MUST defer recovery reloads and DOM probes while that boundary is held, and a transient composer-readiness miss inside a bounded upload attempt MUST consume a retry rather than bypassing the retry policy.

While `integration_conflict` remains set, Apply is unavailable regardless of transient state labels or pending-request arrays. A focused resolution is verified against the cumulative candidate formed from every preceding verified change, with only the active conflict paths retired from the exact candidate that owns them. For a Git-native predecessor, the engine materializes the predecessor commit's exact non-conflicting path diff before replay; it MUST NOT discard the whole predecessor merely because it has no legacy `ChangeSet`. The exact cumulative composition that passes sandbox verification is the composition persisted for host Apply. A failed focused resolution creates a bounded child conflict request by reusing the immutable capsule artifact and attaching the new local failure evidence; it MUST NOT reconstruct an empty ChangeSet conflict from absent Git details.

Every new bundle contains `turn.json` using `harness.turn/v1` plus a non-empty `README.md`. New turns include a concise semantic `chat_title` (maximum 82 characters, no `WHX:` prefix, never transport boilerplate such as `Processar ZIP`) and the mandatory planner `outcome`. After bundle acceptance Wharnex promotes a non-manual provisional title to this planner title and queues the linked ChatGPT rename; only `outcome.status=completed` may proceed to a plan. `failed` or `partial` outcomes omit `plan.json` and patches, are recorded as failed requests, and never reach Policy or execution. `answer`, `clarification`, `investigation`, and `blocked` omit `plan.json` and patches. Completed `workflow` and `change` turns contain `plan.json`; only `change` may contain patches. Legacy bundles without `turn.json` remain compatible, are interpreted as `change`, and synthesize a completed planner outcome.

Required entries for `workflow`:

- `plan.json`: `harness.execution/v1` with `status=ready`, `risk=low|medium`, `requires_approval=false`, 1..16 command-only operations, and `network=false` for every operation/verification command.
- `README.md`: human explanation of the evidence requested.
- `patches/` MUST NOT exist.

Required entries for `change`:

- `plan.json`: `harness.execution/v1` metadata, including a mandatory `commit_message` for `change`: useful permanent Git history derived from the actual patch. It MUST use the most accurate Conventional Commits type (`feat` for new capability/behavior, `fix` for a bug or corrective patch, then `refactor`, `perf`, `docs`, `test`, `build`, `ci`, or `chore` only when nothing more specific applies), SHOULD include a meaningful subsystem scope, and MUST state the concrete implemented/corrected outcome rather than generic process text such as `update files`, `apply patch`, `requested changes`, or `Wharness-verified change`. It becomes the real Git commit that integrates this candidate into the host (see the Git-native host integration section below) after sanitization and appended `Request-Id`/`Plan-Id` trailers; a `workflow` (command-only) plan does not require it. `apply_patch` operations SHOULD use `patch_file` instead of embedding a diff string.
- `cross_project` (optional): changes for other projects this request's own prompt granted with `@ref:<project>`. One self-contained entry per project, each with `project` (the granted reference name, never a path), its own mandatory `commit_message` under the same Conventional Commits contract, its own `operations` and its own `verification`. Patch paths inside an entry are relative to that project's root and `patch_file` resolves from the same `patches/` directory. Entries are validated exactly as the primary plan is and authorized fail-closed at ingestion; each one executes as a derived request on its own project, with that project's Protected sandbox, verification and Git-native host integration. See `AI_PROTOCOL.md` and `adr/ADR-0053`.
- `README.md`: human explanation of the user problem, solution, affected files, operations, verification, risks, and expected result. When the bundle carries `cross_project`, it explains each project's part of the change.
- `patches/*.patch`: raw UTF-8 standard unified diffs referenced by `patch_file`.

Each patch is raw bytes, never a Markdown fence. Every `diff --git` header MUST
contain exactly two unquoted relative paths in the form `a/path` and `b/path`;
it MUST NOT contain a trailing backslash or explanatory text. The producer MUST
run `git apply --check` against the current context before packaging it.

When a bundle is rejected for protocol validation, a user-initiated repeat is a
new request chain. Its planner input MUST name the prior validation failure and
the violated contract, preserve the original user goal, and require a single
fully self-checked result. The provider MUST produce either a valid canonical
bundle or a valid terminal `blocked` bundle; it MUST NOT use malformed bundles
or ordinary prose as a retry loop mechanism.

Optional support material may be included under `docs/`, `metadata/`, or `artifacts/`. Only `plan.json` commands and referenced `patches/*.patch` can influence execution. Other bundle files are documentation/support and are never executed.

Every v2 planner response in a Main Request carries cumulative `summary.md` plus `knowledge/index.json` using protocol `harness.knowledge/v2`. Each indexed knowledge record MUST live at exactly `knowledge/<id>.md`, where `<id>` is lowercase alphanumeric/hyphen and the index carries that file's exact SHA-256. The canonical index top level is exactly `protocol`, `base_revision`, `mode`, and `entries`; each entry is exactly `id`, `file`, and `sha256`. Request/transport metadata such as `request_id` does not belong in the canonical response contract. For compatibility with bundles emitted before this shape was made explicit in the planner prompt, ingestion MAY ignore the single historical top-level `request_id` field while continuing to reject every other unknown field. The index declares `base_revision` and `mode=replace|overlay`; see `AI_PROTOCOL.md` and ADR-0028/ADR-0042 for sharing and commit semantics. The parser validates these artifacts and exposes a staged candidate, but response ingestion does not persist it immediately. At the terminal commit boundary Wharnex persists the reconciled records as separate database rows; `.wharnex/knowledge/` is compatibility input only and is never written. Legacy root `knowledge.md` remains parseable only for an already-pending pre-v2 `knowledge_review`.

At the terminal boundary Wharnex MUST replace the planner's proposed learning statement with an authoritative `## Conhecimento adquirido` section in the cumulative summary, derived from whether reconciliation actually changed the durable catalog. The Agent transcript surfaces that cumulative GPT summary exactly once and then the structured diff/host-command card, which is the final component of the terminal package.

## Bundle validation

Before plan validation/policy:

- filename request id must equal `plan.json.request_id`;
- ZIP paths must be relative, normalized, and traversal-free;
- normalized directory entries such as `patches/` are allowed but ignored as content;
- symlinks are forbidden;
- compressed/download and expanded-size limits apply;
- `README.md` should be present and non-empty. For consumer-web compatibility only, if it is missing/blank but a valid structured `turn.json` or legacy `plan.json` contains user-facing text, Wharness MAY synthesize documentation from that already-validated text; this never invents executable semantics;
- every `patch_file` must resolve to an existing `patches/*.patch` entry;
- a new explicit `turn.json` must contain a valid `outcome`, and non-completed outcomes must not contain `plan.json`;
- a patch operation cannot specify both non-empty inline `patch` and `patch_file`;
- every patch header follows the exact two-path raw-unified-diff form above;
- the resolved execution plan still passes the normal protocol validator and Policy Engine.

Clipboard/raw JSON remains a legacy fallback only.

### Narrow consumer-web bundle normalization

Before executable validation, the parser MAY normalize only transport/layout mistakes that do not invent execution semantics: remove one common top-level wrapper directory, synthesize missing README documentation from an already valid structured turn/plan message, and canonicalize a root-level `.patch` referenced by an otherwise safe patch basename to `patches/<name>.patch`. Missing `plan.json`, missing executable patches, request-id mismatches, unsafe paths, malformed JSON, or policy violations remain hard failures.

## Git-native host integration (v1.3, superseding ChangeSet/CAS)

This is the primary integration and communication protocol between the sandbox and the host — see the "Concurrent host integration invariant" in `AGENTS.md` and `SoT/SANDBOX_MODEL.md` for the full normative contract. Once a `change` plan's sandbox verification succeeds, WHX commits the applied patch onto a dedicated branch (`whx/<request_id>`) inside the sandbox's own Git clone of the host, using `commit_message` (above) as the commit message, then pushes that branch locally into the host's own `.git` and merges it (`git merge --no-ff --no-edit`) into whatever the host currently has checked out. The plan's `verification` commands are rerun against the merged result before the branch is deleted. A planner-resolvable merge conflict aborts before planner reconciliation and routes into the same `harness.conflict/v1` request described in `AI_PROTOCOL.md`. `.wharnex/knowledge/**` is excluded from that model-facing path: request-base capture does not stage dirty managed knowledge, and any residual/legacy managed-only merge collision preserves the current host version locally; if ordinary files also conflict, only those ordinary paths enter the capsule. A post-merge verification failure reverts the host to its exact pre-merge commit and re-enters the normal repair loop with that concrete failure. Neither outcome consumes an extra planner turn beyond what the ChangeSet-based path already required for the same outcome.

## Host execution observability and regression (v1.2.31)

Protected host Apply MUST emit execution lifecycle events before and after each patch replay, including a stable run id, target and touched paths; elapsed duration is emitted when the runner reports it. The same rule applies to reverse patch replay. Self-evolution build phases remain explicit host events. Renderer timelines correlate these events instead of inventing execution state from transcript prose.

A user-requested regression is allowed only for the current successfully executed/applied Protected plan and only when deterministic patch reversal is available. Wharness validates patch paths again, performs `git apply --reverse --check` before mutation, reverses multiple patches from last to first, and attempts to restore already-reversed patches if a later reverse step fails. Plans containing host-replayed Git mutation commands are not presented as deterministically reversible. A pending self-evolution transaction uses its transaction rollback rather than ad-hoc source replay.

Task comments sent to the active consumer-Web ChatGPT conversation are serialized per conversation. A queue item cannot be flushed concurrently by the immediate submit path and periodic retry loop. The main process retains bounded recent comment identifiers plus a short semantic fingerprint window to collapse accidental duplicate dispatches while preserving the ability to intentionally repeat guidance later. A duplicate comment never creates a new planner request or changes the canonical request id. The comment guidance and all of its user attachments MUST be written into one protocol request ZIP and sent with only the bounded external bootstrap; comment prose and raw attachment uploads MUST NOT be injected separately.

Pending bundle supervision is independent of the visible Inspector/chat. At startup and whenever live chat metadata is restored, the application MUST enumerate all durable pending request ids, re-create their owned ChatGPT views hidden as needed, navigate only to their stored trusted concrete affinities, and immediately probe for the exact expected bundle. During this rehydration, historical assistant turns MUST NOT trigger terminal/recovery actions; only the exact download is actionable until the freshly loaded conversation establishes its current assistant-count baseline and completes a bounded stabilization grace. Re-arming the same request MUST preserve that baseline and gate. Download events MUST be routed by request id at workspace scope so an inactive chat can import, validate, queue, execute and apply in Auto without being selected.

A terminal bundle protocol/transport failure may be retried only as a genuinely new request id with a fresh current context snapshot and immutable request base. The backend owns this transition from durable failure state; the frontend transcript is not authoritative recovery data. The stale plan remains diagnostic history and MUST NOT be resubmitted or rebound to the new request. A rejected retry returns its actionable domain reason to the UI rather than a generic error summary.

In project Auto mode, receipt and strict rejection of a bundle is positive terminal evidence, not an ambiguous ChatGPT-processing signal. Wharness MUST prepare at most one automatic fresh-request recovery for that failed chain, preserving the failure as diagnostic evidence and creating a new immutable request base. Desktop submits that prepared request through the owning chat's existing single-flight transport. Older failure actions remain disabled while any newer request in that chat is pending. Transport silence, structural ambiguity, or a still-active ChatGPT conversation request do not qualify for this automatic fresh-request transition.

Each chat's DOM/download supervisor is single-flight. Processing classification MUST combine active conversation transport, assistant-turn progression, composer availability and processing-control presence with a bounded disappearance grace; a single control is not authoritative. Active conversation transport prohibits automatic and manual continuation. Here, active means a request from the current renderer/navigation generation that still has positive lifecycle or structural liveness; a request record whose terminal callback was missed is not allowed to block recovery forever. When its lifecycle record is old and the current trusted surface is structurally idle, Wharness MUST classify it as stale/ambiguous, reconcile the orphaned record, and require explicit human confirmation before any manual continuation; `force` never overrides transport that is still positively active. A persistent control without network/structural progress is ambiguous and raises human attention without interruption. Mere structural silence is also ambiguous and MUST NOT inject an automatic processing-recovery prompt. A concrete conversation-transport interruption, including the request used by ChatGPT to resume an interrupted stream, permits bounded page reload recovery independently of UI language. A structural response-error affordance permits one recovery reload. A positively terminal response without the expected bundle permits at most one automatic same-request delivery continuation; exhaustion raises human attention. A local `Retomar pedido` action MAY send a request-scoped recovery prompt when structurally idle, or after explicit human override of an ambiguous stale processing control. Every such continuation/recovery message MUST use the same mandatory request-ZIP transport; strings such as `WHARNESS PROCESSING RECOVERY — SAME REQUEST` and `WHARNESS DELIVERY CONTINUATION — SAME REQUEST` belong inside `prompt/wharness-planner-prompt.md`, never as full plain composer text. These decisions MUST remain categorical, rely on language-neutral stable attributes where available, and MUST NOT read generated assistant prose or localized status text.

## Request knowledge artifact

Direct ZIP, remote one-shot, live-channel, and Desktop archive request transports carry a first-class immutable project-knowledge snapshot. Before creating that snapshot, Wharnex reads the managed project catalog under `.wharnex/knowledge/` and imports a changed valid file catalog into the local DB; the subtree is excluded from ordinary context capture so knowledge is not sent twice. Under `harness.knowledge/v2`, each record is transported as a separate `knowledge/<id>.md`; metadata includes `state`, `sharing_enabled`, catalog `revision`, catalog `sha256`, updater, and every entry's `id`, `path`, `version`, SHA-256, and updater. The bytes MUST match those hashes. The planner prompt identifies the v2 protocol and catalog revision/count but MUST NOT inline the knowledge bodies. `state: none` means no knowledge files are attached (because sharing is off or the catalog is empty).

## Account operations and chat maintenance (v1.3.3 — see `adr/ADR-0037`)

Account-management operations (find/create project, move conversation, `WHX:`
rename, stop/archive, sidebar collapse, library bundle deletion) are activated
with trusted native input, not synthetic DOM clicks. Each script locates its
control and returns that control's viewport-relative click rect; the main
process commits it with `sendInputEvent`, the same mechanism the composer
transport already uses. ChatGPT renders these controls as Radix
`div[role="menuitem"]` nodes that ignore `HTMLElement.click()`, so a script that
clicks is a script that reports success while doing nothing. A script that
cannot find its control returns a typed failure state — and, for menus, the
labels it did observe — rather than activating an adjacent control.

The permitted inspection boundary is unchanged: structural control metadata and
exact user-owned project/conversation labels only. Trusted input is a
renderer-level event; it does not move the operating-system pointer and does not
focus the remote WebContents.

A conversation's menu is addressed through `data-conversation-options-trigger`,
whose value is that conversation's own id, with the thread-header
`conversation-options-button` as the fallback when the conversation is open but
absent from the visible history. List position is never used.

Renaming commits through the inline sidebar `input[name="title-editor"]`; there
is no rename dialog. The staged value is committed with a trusted `Enter` and
confirmed from the conversation row's own label.

Project existence is decided by reading the account's own "Move to project"
inventory with names folded for case and whitespace, and creation is confirmed
by re-reading that same inventory. A confirmation matching more than once is
reported as a duplicate rather than accepted, so a project is never created
twice remotely.

Browser maintenance is persisted as typed PostgreSQL tasks and leased to one of
three hidden workers. Archive/delete/title/organization work is idempotent and
bounded; active request/recovery/write guards defer lifecycle work with
`WAITING`/`not_before`. A Desktop restart reclaims expired leases. Maintenance is
Worker-only by construction: the claim itself refuses these types to the
Supervisor pool, so a rename or an archive can never take the renderer a chat
needs for a request in progress (see `adr/ADR-0049`).

A chat opens with a provisional locally-derived title. After the first confirmed
submission, native-title discovery and project organization are queued
independently from response waiting. The native title must stabilize before use;
a temporary title conversation is a bounded fallback. A title explicitly chosen
by the user remains definitive.

Bundle files in the account library are cleanup candidates only after local
persistence/ingestion and the configured retention boundary. A cleanup task must
carry an exact canonical Wharnex filename and, when available, the provider
artifact id. Fuzzy prefixes, truncated UI labels, ambiguous rows, or artifacts
still needed by request recovery/audit fail closed and are never deleted.

## Self-contained correction archives (v1.3.9 — see `adr/ADR-0055`)

Every derived request archive MUST carry the refreshed complete context even
when the same ChatGPT conversation previously received a snapshot. It also
carries the root-relative context delta, cumulative redacted execution/recovery
events (including argv, stdout, stderr and exit codes), and every prior response
bundle in the Main Request with a hash/size index. Historical responses are
opaque evidence and MUST NOT be accepted or executed as the active response.
Expired or unreadable history is declared in the index and does not invalidate
the current request.
