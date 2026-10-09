# Automation and Execution Bundle SoT

## Bundle-only provider protocol (v1.3.11 — see `adr/ADR-0052`, `adr/ADR-0054`, `adr/ADR-0056`, `adr/ADR-0087`)

Every exchange Wharnex has with the model provider is a bundle in both directions. Wharnex sends exactly one logical request archive and accepts exactly one response bundle; no other format or convention is a valid way to ask the provider for something or to accept its answer. The logical request is uploaded unchanged as one ZIP when it fits the configured per-part transport limit; otherwise Wharnex sends one canonical main part followed by ordered continuation ZIPs whose chunk payloads reconstruct the logical archive byte-for-byte.

- Wharnex MUST create exactly one logical request archive per exchange. It carries its own protocol identity in a root transport document, the authoritative instruction as a file inside it, and every input the exchange needs. Every logical request archive carries `harness.request-metadata/v1` with `chat_title`, `chat_id`, `chat_hash`, and `requested_at`; the same bounded, engine-authored identity is repeated in the composer bootstrap so a displaced or stale draft remains attributable without reading project data. Composer text is otherwise limited to protocol entry and the canonical expected output filename — never tunnel endpoints (see `adr/ADR-0074`) — and MUST NOT carry the request body, the instruction, the inputs, or any part of them. If transport is multipart, the bootstrap MUST additionally name the exact number of attached parts and require reconstruction from their `wharness.chat-input-part/v1` manifests before opening the logical archive.
- Wharnex MUST accept exactly one response bundle per exchange, named by an exact canonical filename derived from that exchange's own durable identity, carrying its own protocol identity in a root manifest, and validated fail-closed before any byte of it is used. A response in any other shape — prose, a bare file, a differently named archive — is refused, not repaired.
- Every response bundle is parsed under the same structural boundary: relative, normalized, traversal-free entry names; no symlinks; bounded entry count; bounded compressed and expanded size; unknown fields refused in canonical manifests. Provider output is untrusted data in every exchange, never instructions.
- The protocol engine that builds a request MUST be the one that validates its response. A request assembled on one side of a boundary and validated on the other is a contract that can drift out of agreement with itself while every structural check still passes.
- This rule governs every Wharnex-owned request for GPT processing or reasoning, including utility workers, discovery, title generation, follow-ups and recovery. Only deterministic account-management controls and direct human browsing are outside it. The historical temporary-title prompt exception is superseded: it MUST NOT be used as precedent for a non-bundle processing flow.
- Legacy non-bundle shapes remain parseable only where an already in-flight request was checkpointed under one — the orchestrator's historical per-task JSON artifact. Nothing new is ever requested in those shapes.

The exchanges include planner, orchestrator, translation, classification, release notes and `UI_TEST_DISCOVER`; this list is not exhaustive. New or maintained provider-processing paths MUST prove request attachment, exact response correlation and fail-closed validation with automated tests. See `adr/ADR-0087-gpt-bundle-contract.md`.

Transport retries MUST first check the owned conversation for exact user-turn
evidence of every input part. Proven submission adopts durable response
supervision without uploading or submitting again. Adopted observation MUST
persist `observation_only=true` in its durable task: restoring it after a
Desktop restart MUST retain exact-file capture without reload, continuation
or another prompt. Static historical completion cannot renew its progress;
normal stall and task-age bounds still apply. Older payloads retain ordinary
behavior only while their same-request live expectation remains armed. Cold
hydration after restart MUST await durable budget restoration and be passive,
even for an older ordinary payload. A passive payload MUST reinforce an already
armed expectation without resetting its age, progress or spent budget. A structural composer or
reasoning-control failure, or ambiguous file selection, MUST pause the write
for attention rather than restart its upload. Transport/stall attention MAY
continue capturing only the exact expected response filename; it MUST NOT
trigger recovery, reload, continuation or another prompt. Authentication,
verification, access and Manual gates remain closed.

Restoring submitted supervision through `resumeExpectedBundle` MUST always be
observation-only, including when older ordinary tasks lacked that flag. It MUST
preserve the greatest known continuation count from live state, matching tasks
and request-scoped recovery events, and correlate subsequent events with its
durable successor task. An unavailable event ledger MUST NOT enable writes;
passive exact-file capture remains available under the existing guards.
Historical recovery events with an empty chat identity MAY contribute only
when their exact task id belongs to that same request and owned chat. An
explicitly different chat or an uncorrelated task MUST NOT contribute.
After asynchronous history reads, restoration MUST revalidate the expectation:
a newly armed same-request live dispatch retains its guard and age, while a
different replacement request MUST fail closed without being overwritten.

An explicitly dispatched output correction MAY resume stale transport/stall
attention for that same owned request after submission. It MUST reset only
response progress/processing samples, preserve request age and spent automatic
continuations, and never clear authentication/access/verification gates. Its
successor supervision MUST retain request metadata and the new durable task id.

An automatic transport MUST hold a stable 1280 × 900 composer viewport while
preparing/uploading/submitting. Project mirror resizes record their display
geometry but MUST NOT switch the provider into its compact composer during
that operation. Nested holds release only after the last owner finishes, and
the last release restores the latest human pane geometry.

Completion observation MUST support both author-role wrappers and the current
provider's `data-chatgpt-agent-turn-start` marker, using structural turn order
to exclude an unanswered latest user turn. A stop/streaming control prevents
completion. Exact response-file capture MUST exclude user-turn and composer
controls: naming an expected ZIP in the submitted bootstrap is not a download
affordance. Fresh-response fallback remains scoped to the current agent turn.

Reasoning effort MUST be proved by one mapped level in the unique owned composer
control. Observation MAY read bounded direct text nodes of visible inline
wrappers as well as leaf control labels, because a selected level may contain
an icon. Model versions, generic titles and concatenated wrapper text MUST NOT
stand in for a verified level; missing or ambiguous evidence prevents submission.

## Automation mode

Wharness has a per-project automation mode independent from the Agent UI mode:

- `manual`: importing a plan/bundle only validates it. The user explicitly starts Protected/Unprotected execution. For Protected, that informed execution decision also authorizes automatic host integration after successful verification; there is no second Apply approval.
- `auto` (default when a project is opened/restored): valid allowed execution bundles are executed immediately in **Protected** sandbox when their informed-consent boundary is already covered. A successful verified execution then integrates into the host under that same consent.
- `auto_approve`: explicit opt-in automation that has the same continuation/repair semantics as `auto`, stays **Protected**, and treats the initial Main Request execution-contract consent plus `Policy.RequiresApproval` as pre-authorized only after the plan is `ready` and Policy has already returned `Allowed=true`. The grant travels through the normal `Execute(..., approved=true)` path so the existing consent/audit boundary remains authoritative, and Wharnex emits `automation.approval_auto_granted` when it consumes this opt-in.

Automatic modes may automate two distinct branches:

- `change`: Policy -> Protected sandbox -> verification -> host Apply.
- `workflow`: Policy -> command-only local step -> capture observations -> fresh planner continuation. Ordinary workflow executes in the disposable Protected sandbox; `harness.interactive/v1` may execute only a bounded closed host observation. Workflow steps never become Apply candidates.

Answers, clarifications, investigations, and blocked outcomes are imported into the Harness transcript and never enter execution, even when Auto is active. Supported provider adapters return turn results directly and can advance the same bounded workflow loop without browser downloads.

`auto` and `auto_approve` MUST NOT coexist with `Unprotected`. Enabling either automatic mode forces/needs Protected; switching to Unprotected disables/requires disabling automatic execution. Policy validation is never bypassed and `auto_approve` MUST NOT transform a denied Policy decision into an allowed one. In ordinary `auto`, a newly authored Protected root change with an informed execution contract waits for one operator decision before it first executes. That decision covers sandbox execution, post-verification host integration, and policy-compatible repair/evidence descendants of the same Main Request; it does not cover a newly introduced Policy boundary such as network, package/Git mutation, or host system-tool installation/configuration. `auto_approve` may pre-authorize those execution-level Policy approval gates when Policy itself allows the ready plan, but it does not grant interactive/debug capabilities, dependency/infrastructure-repair approval surfaces, or permission to leave Protected. Self-evolution remains transactional and its rebuilt runtime still requires the existing explicit restart activation confirmation. An explicitly approved Plan-first continuation already carries its root decision. Project-defined build/test/runtime commands confined to Protected sandbox may raise medium risk without introducing another gate. Automation mode controls whether eligible execution starts automatically; it never creates a second host-Apply approval gate. Unprotected remains manual and requires per-execution confirmation. Project open/restore initializes `auto` only together with Protected execution; `auto_approve` is never the implicit default, and denied plans never run.

An `offline sandbox dependencies unavailable` execution failure is a local infrastructure/approval state, not a planner defect. Automation MUST stop without creating a ChatGPT repair request and present a high-visibility approval affordance. If the human approves, Wharness MAY retry only eligible Go dependency/build/verification commands with sandbox network under the restrictions in `SANDBOX_MODEL.md`; unrelated commands remain unchanged.

If automatic change execution fails, the bounded repair loop may prepare and submit a repair request to the same linked ChatGPT conversation. A repaired bundle downloaded while Auto is still enabled repeats the sandbox -> verify -> host-apply cycle. The repair attempt cap remains authoritative.

Every repairable terminal execution failure MUST expose a durable **Corrigir com GPT** action beside the failure and in the project attention center. The action MAY resend an already prepared automatic repair after transport failure or start a fresh operator-requested repair after the bounded automatic attempts stop. Before dispatch, the operator MAY add bounded optional guidance; Wharness includes it after the captured failure evidence without replacing that evidence. A planner outcome with `retryable=false` is instead classified as `planner_guidance_required`: the same recovery surfaces state that new evidence is necessary, accept multi-line diagnostics, and MUST validate a non-empty value before dispatch so the backend's blind-retry guard is never presented as an application error. Explicit operator retries do not silently auto-approve or bypass Policy. Infrastructure failure kinds keep their dedicated local recovery actions and MUST NOT be mislabeled as source-code repairs; in particular, an offline Go module cache continues to require **Permitir rede e repetir** under the restrictions above.

Outbound planner request archives keep the primary snapshot isolated under `context/`. Related `@ref` snapshots are transported under `ref-context/`, external `@attach` material under `att-context/`, and `metadata/context-sources.json` is the canonical request-side mapping. Direct uploads and artifacts stay in their own top-level roots; they MUST NOT be folded back into `context/`.

For iterative investigation, an ordinary or debug-observe sandbox `workflow` bundle is executed in a disposable Protected sandbox; a debug host workflow uses the separately constrained host path described below. Its argv/cwd/exit/stdout/stderr results are converted to `LOCAL WORKFLOW OBSERVATIONS`, the current project context is refreshed, and a fresh planner request is submitted to the same linked ChatGPT conversation. The loop accepts at most six workflow rounds for one original user request. Command failures are observations and do not enter the change-repair loop. The sixth continuation MUST terminate as answer, investigation, clarification, change, or blocked.

With Debug mode active, a machine-local diagnostic question must use a targeted executable debug workflow before a terminal answer whenever a Policy-accepted local probe can resolve the missing runtime fact; stdout/stderr/exit evidence is returned to the same Main Request. An engine-owned query may supplement, but not replace, such a relevant probe.

A workflow carrying `harness.interactive/v1` follows the same continuation loop with `access=observe`. The closed `project_execution_summary` query is resolved inside the Engine from bounded aggregate durable-ledger data and does not execute argv or expose raw event bodies. With Interativo disabled the first observe round pauses once per Main Request root; compatible derived observe rounds inherit that grant, while Interativo enabled auto-authorizes them. Legacy `harness.debug/v1 access=observe` remains readable. `access=modify` is retired and rejected before execution. The interactive loop permits at most 24 materially distinct evidence rounds; it never grants patches, Apply, network, shell, privilege escalation, Docker, host-service control, external access, tool installation or destructive operations.

Protected Host Apply consumes a verified candidate once. The project mutation lock and the durable candidate read form one boundary: every caller reloads the session after acquiring the lock. A duplicate caller therefore returns the no-candidate precondition and MUST NOT reuse a stale in-memory candidate, recreate/extend self-evolution state, merge a deleted branch or trigger planner repair.

Each bounded upload retry MUST cancel and settle its network observation if file selection fails before an upload starts, so an orphan timeout cannot outlive that attempt or surface later as an unrelated failure. The dedicated general-file control is resolved inside the currently usable composer first, through a closed preference ladder headed by its stable upload id; document-wide file-input fallbacks are compatibility-only, and arbitrary inputs or caller-provided selectors are forbidden. The Desktop sets the file exactly once through the browser protocol and MUST NOT replay synthetic `input` or `change` events after that native protocol operation: current composer revisions already consume the selection, and replaying both event paths can attach the same archive twice. A synchronously cleared DOM `FileList` is not by itself a failure: the authoritative confirmation remains the bounded trusted upload network sequence.

For the embedded consumer ChatGPT transport, the remote view MUST finish loading and remain network-stable for a bounded interval before Wharness prepares input, whether or not a user prompt already exists. Every Wharness message submitted to the consumer ChatGPT for an active request — initial planner input, workflow/correction/repair guidance, task comments, automatic delivery continuation, and manual same-request recovery — MUST be materialized as exactly one logical private request-scoped `wharness-input-<request_id>.zip`. Its root `transport.json` uses `wharness.chat-input/v1` and includes the common `request_metadata`; the archive contains the authoritative `prompt/wharness-planner-prompt.md` beginning with the same metadata, the refreshed context ZIP when required by the conversation/hash rule, selected system artifacts, explicit project-file references, and user attachments under separate directories. The complete planner prompt is never pasted as ordinary composer text. Instead, Wharness writes only a bounded bootstrap containing that same request identity and telling ChatGPT to open the logical archive and read the inner planner prompt first. If the logical ZIP exceeds the configured per-part limit, Desktop MUST split its raw byte stream into an ordered set of `wharness.chat-input-part/v1` wrapper ZIPs, keep the canonical request filename on part 1, use deterministic `_part-XX-of-NN.zip` names for continuations, and include a manifest plus `multipart/payload.part` in every wrapper. The bootstrap MUST declare the exact part count and require ordering by `part_index`, concatenation of the payload chunks, verification of the declared total bytes and SHA-256, and only then opening the reconstructed logical ZIP. If the logical ZIP fits the per-part limit, Desktop MUST upload it unchanged as a single archive. Wharness may observe only narrowly scoped request metadata for an allowlisted ChatGPT upload-endpoint family under `/backend-api` (including the historical `process_upload_stream` route and the current staged metadata-plus-`/<file-id>/uploaded` acknowledgement): request identity, owning WebContents, completion status, and network error, never headers or bodies. The allowlist MUST require upload semantics and a mutating HTTP method so unrelated file metadata traffic cannot satisfy the upload-confirmation gate. A metadata-create success starts but MUST NOT complete a staged observation; only the matching final acknowledgement, or a successful allowlisted legacy stream, confirms it. Every request id owned by one observation is detached when it settles. Every required transport-part upload requires an observed successful upload; a failed or non-started upload is retried with bounded exponential backoff, and exhausting the retry cap aborts preparation and MUST NOT submit. Multipart submission is atomic at the request level: all declared parts MUST be attached in order before send becomes eligible. Once that upload is confirmed, the submit MUST reuse the already-prepared composer target atomically; it MUST NOT retarget or reload the page between attachment and dispatch. The Desktop MUST inject that archive through ChatGPT's dedicated general-file input rather than clipboard URI paste, so the browser presents the complete selected transport set, with part 1 using the canonical archive basename and any continuation parts using their deterministic multipart basenames. Clipboard-based file paste is forbidden for the planner request transport because Chromium may materialize anonymous/renamed file objects or duplicate attachment state across retries.

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

A conflict continuation uses the owning Harness chat's immutable ChatGPT affinity, cache key and Supervisor. It MUST NOT create an auxiliary conversation or synthetic `_cf_` surface. Prompt preparation, uploads, pending-request restoration, comments, continuations and bundle supervision therefore share the same serialized transport boundary and the same `workspace_chat_id`; a single request MUST never be split between a write in one conversation and an `AWAIT_RESPONSE` in another. Bundle supervision MUST defer recovery reloads and DOM probes while that boundary is held, and a transient composer-readiness miss inside a bounded upload attempt MUST consume a retry rather than bypassing the retry policy.

While `integration_conflict` remains set, Apply is unavailable regardless of transient state labels or pending-request arrays. A focused resolution is verified against the cumulative candidate formed from every preceding verified change, with only the active conflict paths retired from the exact candidate that owns them. A capsule-owned path may be an incidental collision caused by a predecessor's stale request-base ancestry even when that path is absent from the predecessor's explicit patch/write set; the conflict lineage still supersedes that ancestry. For a Git-native predecessor, the engine materializes the predecessor commit's exact non-conflicting path diff before replay; it MUST NOT discard the whole predecessor merely because it has no legacy `ChangeSet`. Every surviving predecessor delta MUST be re-anchored at the focused resolution request's base before any later branch promotion or host merge; promotion MUST NOT restore the predecessor's original request base. If a dual legacy `ChangeSet`/Git candidate is narrowed into canonical patch bytes, the stale `ChangeSet` representation MUST be discarded. The exact cumulative composition that passes sandbox verification is the composition persisted for host Apply. A failed focused resolution creates a bounded child conflict request by reusing the immutable capsule artifact and attaching the new local failure evidence; it MUST NOT reconstruct an empty ChangeSet conflict from absent Git details.

Every new bundle contains `turn.json` using `harness.turn/v1` plus a non-empty `README.md`. New turns include a concise semantic `chat_title` (maximum 82 characters, no `WHX:` prefix, never transport boilerplate such as `Processar ZIP`) and the mandatory planner `outcome`. After bundle acceptance Wharnex promotes a non-manual provisional title to this planner title and queues the linked ChatGPT rename; only `outcome.status=completed` may proceed to a plan. `failed` or `partial` outcomes omit `plan.json` and patches, are recorded as failed requests, and never reach Policy or execution. `answer`, `clarification`, `investigation`, and `blocked` omit `plan.json` and patches. Completed `workflow` and `change` turns contain `plan.json`; only `change` may contain patches. Legacy bundles without `turn.json` remain compatible, are interpreted as `change`, and synthesize a completed planner outcome.

Required entries for `workflow`:

- `plan.json`: `harness.execution/v2` with `status=ready` and 1..16 command-only operations. Ordinary and interactive-observe workflow use `risk=low|medium`, `requires_approval=false` and `network=false`.
- `README.md`: human explanation of the evidence requested.
- `patches/` MUST NOT exist.

Required entries for `change`:

- `plan.json`: `harness.execution/v2` metadata, including the informed execution contract and a mandatory `commit_message` for `change`: useful permanent Git history derived from the actual patch. It MUST use the most accurate Conventional Commits type (`feat` for new capability/behavior, `fix` for a bug or corrective patch, then `refactor`, `perf`, `docs`, `test`, `build`, `ci`, or `chore` only when nothing more specific applies), SHOULD include a meaningful subsystem scope, and MUST state the concrete implemented/corrected outcome rather than generic process text such as `update files`, `apply patch`, `requested changes`, or `Wharness-verified change`. It becomes the real Git commit that integrates this candidate into the host (see the Git-native host integration section below) after sanitization and appended `Request-Id`/`Plan-Id` trailers; a `workflow` (command-only) plan does not require it. `apply_patch` operations SHOULD use `patch_file` instead of embedding a diff string.
- A change produced from an approved planning-only turn additionally carries `approved_chat_plan` inside `plan.json`: protocol `harness.chat-plan/v1`, the approved parent request id, its SHA-256 and the exact approved Markdown. The engine compares every field with its persisted approval before Policy; omission or alteration is a protocol error. This makes the bundle auditable and lets one approval cover the bound Protected Auto execution and post-verification Apply.
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

Every v2 planner response in a Main Request carries cumulative `summary.md` plus `knowledge/index.json` using protocol `harness.knowledge/v2`. Each indexed knowledge record MUST live at exactly `knowledge/<id>.md`, where `<id>` is lowercase alphanumeric/hyphen and the index carries that file's exact SHA-256. The canonical index top level is exactly `protocol`, `base_revision`, `mode`, and `entries`; newly emitted entries are exactly `id`, `file`, `sha256`, and `category`. `category` is one of `conflict_resolution`, `patch_strategy`, `execution_repair`, `verification`, `runtime_environment`, `protocol_transport`, `product_domain`, or `general`; only the first six are eligible as reusable WHX self-evolution evidence. Historical entries without `category` remain ingestible and are classified conservatively so an upgrade does not strand pending requests. Request/transport metadata such as `request_id` does not belong in the canonical response contract. For compatibility with bundles emitted before this shape was made explicit in the planner prompt, ingestion MAY ignore the single historical top-level `request_id` field while continuing to reject every other unknown top-level field. The index declares `base_revision` and `mode=replace|overlay`; see `AI_PROTOCOL.md` and ADR-0028/ADR-0042 for sharing and commit semantics. The parser validates these artifacts and exposes a staged candidate, but response ingestion does not persist it immediately. At the terminal commit boundary Wharnex persists the reconciled records as separate database rows; `.wharnex/knowledge/` is compatibility input only and is never written. Legacy root `knowledge.md` remains parseable only for an already-pending pre-v2 `knowledge_review`.

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

Task comments sent to the active consumer-Web ChatGPT conversation are serialized per conversation. A queue item cannot be flushed concurrently by the immediate submit path and periodic retry loop. The main process retains bounded recent comment identifiers plus a short semantic fingerprint window to collapse accidental duplicate dispatches while preserving the ability to intentionally repeat guidance later. A duplicate comment never creates a new planner request or changes the canonical request id. The comment guidance and all of its user attachments MUST be written into one logical protocol request ZIP and sent with only the bounded external bootstrap; that logical ZIP MAY use the same configured multipart transport when required. Comment prose and raw attachment uploads MUST NOT be injected separately.

Pending bundle supervision is independent of the visible Inspector/chat. At startup and whenever live chat metadata is restored, the application MUST enumerate all durable pending request ids, re-create their owned ChatGPT views hidden as needed, navigate only to their stored trusted concrete affinities, and immediately probe for the exact expected bundle. During this rehydration, historical assistant turns MUST NOT trigger terminal/recovery actions; only the exact download is actionable until the freshly loaded conversation establishes its current assistant-count baseline and completes a bounded stabilization grace. Re-arming the same request MUST preserve that baseline and gate. Download events MUST be routed by request id at workspace scope so an inactive chat can import, validate, queue, execute and apply in Auto without being selected.

A terminal bundle protocol/transport failure may be retried only as a genuinely new request id with a fresh current context snapshot and immutable request base. The backend owns this transition from durable failure state; the frontend transcript is not authoritative recovery data. The stale plan remains diagnostic history and MUST NOT be resubmitted or rebound to the new request. A rejected retry returns its actionable domain reason to the UI rather than a generic error summary.

In a project automatic mode (`auto` or `auto_approve`), receipt and strict rejection of a bundle is positive terminal evidence, not an ambiguous ChatGPT-processing signal. Wharness MUST prepare at most one automatic fresh-request recovery for that failed chain, preserving the failure as diagnostic evidence and creating a new immutable request base. Desktop submits that prepared request through the owning chat's existing single-flight transport. Older failure actions remain disabled while any newer request in that chat is pending. Transport silence, structural ambiguity, or a still-active ChatGPT conversation request do not qualify for this automatic fresh-request transition.

Each chat's DOM/download supervisor is single-flight. Processing classification MUST combine active conversation transport, assistant-turn progression, composer availability and processing-control presence with a bounded disappearance grace; a single control is not authoritative. Active conversation transport prohibits automatic and manual continuation. Here, active means a request from the current renderer/navigation generation that still has positive lifecycle or structural liveness; a request record whose terminal callback was missed is not allowed to block recovery forever. When its lifecycle record is old and the current trusted surface is structurally idle, Wharness MUST classify it as stale/ambiguous, reconcile the orphaned record, and require explicit human confirmation before any manual continuation; `force` never overrides transport that is still positively active. A persistent control without network/structural progress is ambiguous and raises human attention without interruption. Mere structural silence is also ambiguous and MUST NOT inject an automatic processing-recovery prompt. A concrete conversation-transport interruption, including the request used by ChatGPT to resume an interrupted stream, permits bounded page reload recovery independently of UI language. A structural response-error affordance permits one recovery reload. A positively terminal response without the expected bundle permits at most one automatic same-request delivery continuation; exhaustion raises human attention. A local `Retomar pedido` action MUST first prove from the currently bound conversation DOM that a submitted user turn contains the exact canonical Wharnex request-archive filename for that request. This proof may compare only the engine-owned filename inside a structurally identified user-turn attachment/resource card and MUST NOT read user prompt prose or assistant prose. Durable task state, an armed expectation, upload completion, a spinner, assistant-count progression or a previous POST observation is not sufficient on its own. Only after that DOM proof, structural idleness and the normal transport guards MAY `Retomar pedido` send the short request-scoped recovery/keep-continue bundle. If the proof is absent, it MUST NOT arm response supervision or send a continuation; it MUST retire stale supervision and route the same request through the idempotent full-archive resend path recovered from the persisted input artifact. Every continuation/recovery or full resend remains subject to the same mandatory request-ZIP transport; strings such as `WHARNEX PROCESSING RECOVERY — SAME REQUEST` and `WHARNEX DELIVERY CONTINUATION — SAME REQUEST` belong inside `prompt/wharness-planner-prompt.md`, never as full plain composer text. These decisions MUST remain categorical, rely on language-neutral stable attributes where available, and MUST NOT read generated assistant prose or localized status text.

## Request knowledge artifact

An explicit `Retomar pedido` for an unbound first request MAY route to full persisted-archive delivery at the exact ChatGPT home URL. Before touching ChatGPT, Desktop MUST verify locally that the request is still the session's latest pending request awaiting a plan, the session belongs to that chat, binding recovery has neither a binding nor any conversation candidate, and the durable task ledger has no response observation or active/completed write for the request. Unavailable or ambiguous evidence fails closed. This is first delivery, never a short continuation or automatic restart replay. Confirmed submission MUST establish concrete conversation affinity and durable response supervision (ADR-0091).

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
independently from response waiting. The native title must stabilize before use.
Legacy temporary-title tasks are compatibility sinks and MUST NOT submit a model
request. A title explicitly chosen by the user remains definitive.

Bundle files in the account library are cleanup candidates only after local
persistence/ingestion and the configured retention boundary. A cleanup task must
carry an exact canonical Wharnex filename and, when available, the provider
artifact id. Fuzzy prefixes, truncated UI labels, ambiguous rows, or artifacts
still needed by request recovery/audit fail closed and are never deleted.

## Self-contained derived archives (v1.3.9 — see `adr/ADR-0055`, `adr/ADR-0061`)

Every derived request archive MUST carry the refreshed complete eligible
context in Full mode, or the cumulative selected eligible bodies and maps in
Partial mode, even when the same ChatGPT conversation previously received a
snapshot. It also
carries the root-relative context delta, cumulative redacted execution/recovery
events (including argv, stdout, stderr and exit codes), and every prior response
bundle in the Main Request with a hash/size index. Historical responses are
opaque evidence and MUST NOT be accepted or executed as the active response.
Expired or unreadable history is declared in the index and does not invalidate
the current request.

An execution-plan adjustment is one of those derived archives but has its own
semantic identity. A request classified `execution_plan_adjustment` is exposed
as input bundle type `adjustment`, not as repair/correction. In addition to the
cumulative history above it MUST carry `requests/main.md` with the root Main
Request and `requests/adjustment.md` with the operator's current adjustment
prompt. Consumer-Web archive construction keeps both paths on its fixed
engine-owned continuation allowlist; they are evidence/context only and never
replace `prompt/wharness-planner-prompt.md` as the authoritative planner
instructions.

## Interactive v2 workflow bundles

A planner response may carry a `workflow` plan using `harness.interactive/v2`. The bundle remains subject to the same exact filename, manifest, schema and request-lineage checks as every other provider response. Typed interactive operations are executable evidence steps, never patch carriers and never Apply candidates. Their authorization comes from the validated `debug` capability/scope declaration plus Policy and the persisted Interactive grant; prose in `turn.message`, the plan document or command output grants no authority.

The bundle schema admits typed `shell`, `sql`, `logs`, `filesystem`, `process`, `network`, `container` and `service` operation payloads in addition to `command`. V1 inputs remain valid and continue to require their historical read-only constraints.

## Durable response delivery acknowledgement

A Desktop response download remains in the durable pending inbox until the
owning backend session accepts the delivery or durably records its terminal
protocol rejection. A workspace routing miss, request mismatch
or not-pending response is non-terminal for other requests, but MUST NOT be
converted into successful delivery or acknowledge/delete its bytes. The client
MUST retain/NACK that delivery so its actual owner can import it after project
restoration. Duplicate observation must preserve this same rule: local browser
completion or a renderer return value is not proof of backend acceptance.

### Consumer model selection (2026-10-09)

The composer MAY expose a model choice obtained only from the owned ChatGPT model control and its structurally linked menu. There is no hard-coded model catalog. Inventory is a deliberate human UI action, never a health probe; it and selection refuse Manual mode, authentication, active response expectations, queued drafts/comments and active writes. Scripts return bounded exact model-control labels, disabled/selected metadata and internal geometry only; trusted native input commits a unique offered choice. Missing or ambiguous controls fail closed. Desktop stores only the confirmed preference under the local chat identity. Before upload it revalidates that preference against the current menu and may apply it; immediately before submission it verifies the same choice without changing the model. Mandatory reasoning-effort validation remains independent, so an incompatible model cannot silently submit at an unknown effort. Already submitted adoption remains passive and never changes the model.

### Exact-download observation diagnostics (2026-10-09)

The existing named expected-bundle download operation MAY report bounded structural diagnostics from the same candidate scan it uses to select a control. Its expected filename MUST come from the main-process armed expectation, never from a renderer diagnostic parameter. The diagnostic returns only counts, categorical selection/skip reasons, exact-match booleans and at most 16 control identities (tag/role/testid, disabled/nested/file/download flags); it MUST NOT return control text, URLs, arbitrary attributes or assistant prose. A passive diagnostic variant MUST never click or change liveness. Resident polling MAY record a changed diagnostic or an unchanged diagnostic once per 30 seconds, correlated by chat/request and redacted through the existing operational logger. Diagnostics never grant download trust, extra recovery, navigation or resubmission. The string-returning download-script contract remains compatible for existing callers.

Expected-download diagnosis may additionally count Wharnex response filename labels inside owned conversation resource/file/attachment controls. Main provides the armed canonical name; output contains only booleans for expected name, current chat and current request, never observed filenames or prose. Only download/aria-label/title control metadata and short leaf filename labels under structural resource cards are inspected; user/composer/sidebar/code/markdown/screen-reader regions are excluded. Inspect at most64cards,8labels/card,256controls and6marker ancestors; return at most16resource/control shapes per collection. This passive diagnostic cannot widen activation, infer completion or bypass exact download validation.

One complementary passive expected-download measurement may inspect owned `[role="link"]`, `[download]`, `[data-file-name]`, `[data-filename]` and resource-test-id controls via download/aria-label/title/file-name attributes only. It MUST NOT read textContent or href or activate controls. At most128controls are inspected and16shapes returned, with visibility, capture-scan membership and filename-contract/ZIP booleans. Viewport and root/main scroll measurements contain numbers only, do not move the viewport and do not prove response completion or virtualized content presence. Missing matches require filename/link evidence from the human rather than successive collector expansions.

Measured 2026-10-09: the owned test conversation rendered its exact expected response ZIP in three visible SPAN role=link controls outside the shipped capture selector. Expected-download transport MAY include role-link controls only inside the bound conversation main, excluding user/composer/sidebar controls. For this new path, inspect only bounded download/aria-label/title/data-file-name attributes, at most128controls, never textContent, href or nearby prose. Admit only a complete filename token equal to the engine-owned expected name; missing/wrong/disabled/hidden controls fail closed. Role-link candidates MUST NOT participate in generic latest-turn/assistant fallback. Existing duplicate exact preference and downloaded-byte validation remain authoritative.

Live2026-10-09 10:34:32 showed exact role-link selection but no will-download or bytes after synthetic click, followed by the20second download stall. Role-link download activation MUST therefore locate its exact control and return a bounded viewport point; it MUST NOT use HTMLElement.click. The Supervisor main process revalidates the armed expectation identity/request, slot/owned conversation, manual/login/preparation/delivery guards and a freshly located exact point, then uses the existing scoped trusted renderer input boundary. Only the chosen exact control may be scrolled into view for activation; passive diagnostics MUST NOT scroll. Native input must not focus WebContents or move the OS pointer. Mark download pending only after accepted native dispatch, never after merely locating a control. Legacy string Worker callers fail closed for role-link controls until they integrate a named native activation operation; working legacy artifact controls retain their interface/activation. Bytes still pass strict bundle validation.

Rejeições de input nativo MUST registar apenas uma razão e etapa de enum fechado e geometria estrutural limitada: viewport, retângulo, ponto, hit tag/role e indicação de scroll. Nunca incluir conteúdo, nomes observados, URLs ou labels. Essa observabilidade não pode alterar seleção, input ou progresso. Uma falha de ativação nativa MAY adiar a próxima tentativa por um cooldown main-owned independente de lastDOMClick; não marcar download pendente, progresso, reiniciar TTL nem orçamento de tarefas.

### Diagnóstico do catálogo em dois níveis (2026-10-09)

Imagens fornecidas pelo utilizador comprovaram uma hierarquia de UI: o primeiro popup contém esforço/slider e um controlo abre o catálogo de modelos. As imagens não provam as roles DOM. A operação nomeada de inventário MAY medir passivamente o trigger e o popup explicitamente ligado, até 64 controlos estruturais e retornar até 16 formas com tag/role, aria-haspopup, booleans expanded/selected/disabled, existência/visibilidade/role da ligação aria-controls e geometria numérica limitada. Não ler texto, href, atributos arbitrários ou outros popups. Registar esse diagnóstico correlacionado no gesto de inventário, sem inferir modelos de controlos de esforço e sem abrir o segundo nível antes de confirmar a sua estrutura.
