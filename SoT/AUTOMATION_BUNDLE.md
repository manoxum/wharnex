# Automation and Execution Bundle SoT

## Automation mode

Wharness has a per-project automation mode independent from the Agent UI mode:

- `manual`: importing a plan/bundle only validates it. The user explicitly runs Protected/Unprotected execution and Protected Apply.
- `auto` (default when a project is opened/restored): valid allowed execution bundles are executed immediately in **Protected** sandbox. Only a successful verified execution may be applied automatically to the host.

Auto may automate two distinct branches:

- `change`: Policy -> Protected sandbox -> verification -> host Apply.
- `workflow`: Policy -> disposable Protected sandbox command probe -> capture observations -> fresh planner continuation. Workflow steps never Apply to host.

Answers, clarifications, investigations, and blocked outcomes are imported into the Harness transcript and never enter execution, even when Auto is active. Supported provider adapters return turn results directly and can advance the same bounded workflow loop without browser downloads.

`auto` MUST NOT coexist with `Unprotected`. Enabling Auto forces/needs Protected; switching to Unprotected disables/requires disabling Auto. Policy validation is never bypassed. Auto is a persistent project state and counts as approval to execute/apply a policy-allowed bundle. Project-defined build/test/runtime commands that are confined to the Protected sandbox may raise the plan to medium risk for visibility, but MUST NOT by themselves create a second per-plan approval gate that stalls Auto. Explicit planner approval, network access, package mutation, Git mutation, denied commands and high-risk policy outcomes retain their dedicated approval/deny semantics. Project open/restore initializes Auto only together with Protected execution; denied plans never run.

If automatic change execution fails, the bounded repair loop may prepare and submit a repair request to the same linked ChatGPT conversation. A repaired bundle downloaded while Auto is still enabled repeats the sandbox -> verify -> host-apply cycle. The repair attempt cap remains authoritative.

For iterative investigation, a valid `workflow` bundle is executed only in a disposable Protected sandbox. Its argv/cwd/exit/stdout/stderr results are converted to `LOCAL WORKFLOW OBSERVATIONS`, the current project context is refreshed, and a fresh planner request is submitted to the same linked ChatGPT conversation. The loop accepts at most six workflow rounds for one original user request. Command failures are observations and do not enter the change-repair loop. The sixth continuation MUST terminate as answer, investigation, clarification, change, or blocked.

For the embedded consumer ChatGPT transport, the remote view MUST finish loading and remain network-stable for a bounded interval before Wharness prepares input, whether or not a user prompt already exists. In local-attachment mode, one planner turn MUST be materialized as exactly one private request-scoped `wharness-input-<request_id>.zip`. Its root `transport.json` uses `wharness.chat-input/v1`; the archive contains the authoritative `prompt/wharness-planner-prompt.md`, the refreshed context ZIP when required by the conversation/hash rule, selected system artifacts, explicit project-file references, and user attachments under separate directories. The complete planner prompt is never pasted as ordinary composer text. Instead, Wharness writes only a bounded bootstrap telling ChatGPT to open the single archive and read the inner planner prompt first. Wharness may observe only narrowly scoped request metadata for ChatGPT's `process_upload_stream` endpoint (request identity, owning WebContents, completion status, and network error), never headers or bodies. The one archive upload requires an observed successful upload; a failed or non-started upload is retried with bounded exponential backoff, and exhausting the retry cap aborts preparation and MUST NOT submit.

This request ZIP is the single **inbound bundle** whenever ZIP transport is enabled, including ZIP+tunnels mode. All planner prompts, context files, explicit `@file` selections, user attachments and selected Wharness artifacts MUST be entries of that one archive; no second prompt/file attachment may accompany it. When tunnels are also enabled, their ordered verification bootstrap is embedded inside the inbound bundle rather than pasted separately. In tunnels-only mode there is no inbound archive: the composer receives only the bounded protocol bootstrap and ordered authorized endpoints, while the full prompt and files remain retrievable resources. In every transport combination, ordinary composer text MUST contain only instructions for entering/using the chosen Wharness protocol; it MUST NOT contain the full user request, generated planner prompt, serialized attachments, or project context.

Consumer ChatGPT Web defaults to one direct local input archive because its file runtime cannot reliably fetch arbitrary public binary URLs. The archive contains every prompt, context, attachment, artifact and explicit project-file selection. It may also contain an ordered advisory list of every eligible configured Tunnel Provider. Each provider publishes the same persisted secret live channel for the request chain, with independently retrievable prompt, state/hash, immutable context, generation-specific attachments, `diff-check.json`, bundle contract and read-only SSE resources. The consumer tries a tunnel only after validating its exact status endpoint and advances to the next on DNS, connection or 5xx failure. Whenever tunnels are enabled, immediately before bundle delivery it MUST repeat this ordered selection, read the freshest diff check/state/file map, derive touched paths from the actual patch, and verify the patches against current touched files. If every final tunnel check fails, it uses the attached archive without blocking when one exists. A tunnel never supersedes the archive as the fallback baseline. Permanent providers retain one configured DNS origin and rehydrate active channels after restart; all Harness chats share only the origin, never request state. Workflow/correction/repair prompts update that same request channel; unrelated main requests never reuse it.

After transport-confirmed uploads, Auto focuses the composer and submits with a layout-independent native `Enter` input after a bounded settle delay. Submission is successful only after the trusted ChatGPT conversation endpoint starts its POST request; absence of that signal triggers bounded focus-and-submit retries, and exhaustion leaves the request unsubmitted. This confirms transport, not model completion: Wharnex reads only allowlisted structural controls and exact account-management labels, never response prose. The execution pipeline resumes only after a matching bundle download is initiated and intercepted by the validated download seam. Fully deterministic unattended planning uses the supported provider adapter instead of consumer-web automation.

## Execution bundle transport

Primary manual Desktop delivery is:

`wharness-bundle-<request_id>.zip`

The planner prompt MUST state the exact canonical filename, require the generated file basename/attachment metadata to use it, prohibit icon-only/prose-only substitutes, require the ZIP root layout, and require the model to self-check the archive before attaching it. The Desktop records the expected request id when a draft is submitted. Automatic download activation first matches canonical filename metadata, including non-visible link attributes. If ChatGPT renders the generated result without exposing that filename, Desktop MAY activate a fallback only when the newest assistant turn contains exactly one visible enabled file/download affordance; zero or multiple candidates fail closed. This narrow fallback identifies only the download control, never reads response prose to infer completion. If ChatGPT nevertheless downloads a generic ZIP name while exactly that request is pending in the active chat, the Desktop MAY rename the transport file to the canonical filename before backend submission. The same normalization MAY remove only Chromium's bounded duplicate-download suffix `(n)` or ` (n)` from a canonical bundle basename when the embedded request id exactly equals the active expected request. A different valid Wharness request id is never rewritten, and normal bundle/request validation remains authoritative.

Every new bundle contains `turn.json` using `harness.turn/v1` plus a non-empty `README.md`. The turn includes the mandatory planner `outcome`; only `outcome.status=completed` may proceed to a plan. `failed` or `partial` outcomes omit `plan.json` and patches, are recorded as failed requests, and never reach Policy or execution. `answer`, `clarification`, `investigation`, and `blocked` omit `plan.json` and patches. Completed `workflow` and `change` turns contain `plan.json`; only `change` may contain patches. Legacy bundles without `turn.json` remain compatible, are interpreted as `change`, and synthesize a completed planner outcome.

Required entries for `workflow`:

- `plan.json`: `harness.execution/v1` with `status=ready`, `risk=low|medium`, `requires_approval=false`, 1..16 command-only operations, and `network=false` for every operation/verification command.
- `README.md`: human explanation of the evidence requested.
- `patches/` MUST NOT exist.

Required entries for `change`:

- `plan.json`: `harness.execution/v1` metadata. `apply_patch` operations SHOULD use `patch_file` instead of embedding a diff string.
- `README.md`: human explanation of the user problem, solution, affected files, operations, verification, risks, and expected result.
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

## Host execution observability and regression (v1.2.31)

Protected host Apply MUST emit execution lifecycle events before and after each patch replay, including a stable run id, target and touched paths; elapsed duration is emitted when the runner reports it. The same rule applies to reverse patch replay. Self-evolution build phases remain explicit host events. Renderer timelines correlate these events instead of inventing execution state from transcript prose.

A user-requested regression is allowed only for the current successfully executed/applied Protected plan and only when deterministic patch reversal is available. Wharness validates patch paths again, performs `git apply --reverse --check` before mutation, reverses multiple patches from last to first, and attempts to restore already-reversed patches if a later reverse step fails. Plans containing host-replayed Git mutation commands are not presented as deterministically reversible. A pending self-evolution transaction uses its transaction rollback rather than ad-hoc source replay.

Task comments sent to the active consumer-Web ChatGPT conversation are serialized per conversation. A queue item cannot be flushed concurrently by the immediate submit path and periodic retry loop. The main process retains bounded recent comment identifiers plus a short semantic fingerprint window to collapse accidental duplicate dispatches while preserving the ability to intentionally repeat guidance later. A duplicate comment never creates a new planner request or changes the canonical request id.

Pending bundle supervision is independent of the visible Inspector/chat. At startup and whenever live chat metadata is restored, the application MUST enumerate all durable pending request ids, re-create their owned ChatGPT views hidden as needed, navigate only to their stored trusted concrete affinities, and immediately probe for the exact expected bundle. During this rehydration, historical assistant turns MUST NOT trigger terminal/recovery actions; only the exact download is actionable until the freshly loaded conversation establishes its current assistant-count baseline and completes a bounded stabilization grace. Re-arming the same request MUST preserve that baseline and gate. Download events MUST be routed by request id at workspace scope so an inactive chat can import, validate, queue, execute and apply in Auto without being selected.

A terminal bundle protocol/transport failure may be retried only as a genuinely new request id with a fresh current context snapshot and immutable request base. The backend owns this transition from durable failure state; the frontend transcript is not authoritative recovery data. The stale plan remains diagnostic history and MUST NOT be resubmitted or rebound to the new request. A rejected retry returns its actionable domain reason to the UI rather than a generic error summary.

In project Auto mode, receipt and strict rejection of a bundle is positive terminal evidence, not an ambiguous ChatGPT-processing signal. Wharness MUST prepare at most one automatic fresh-request recovery for that failed chain, preserving the failure as diagnostic evidence and creating a new immutable request base. Desktop submits that prepared request through the owning chat's existing single-flight transport. Older failure actions remain disabled while any newer request in that chat is pending. Transport silence, structural ambiguity, or a still-active ChatGPT conversation request do not qualify for this automatic fresh-request transition.

Each chat's DOM/download supervisor is single-flight. Processing classification MUST combine active conversation transport, assistant-turn progression, composer availability and processing-control presence with a bounded disappearance grace; a single control is not authoritative. Active conversation transport prohibits automatic and manual continuation. A persistent control without network/structural progress is ambiguous and raises human attention without interruption. Mere structural silence is also ambiguous and MUST NOT inject an automatic processing-recovery prompt. A concrete conversation-transport interruption, including the request used by ChatGPT to resume an interrupted stream, permits bounded page reload recovery independently of UI language. A structural response-error affordance permits one recovery reload. A positively terminal response without the expected bundle permits at most one automatic same-request delivery continuation; exhaustion raises human attention. A local `Retomar pedido` action MAY send a request-scoped recovery prompt when structurally idle, or after explicit human override of an ambiguous stale processing control. These decisions MUST remain categorical, rely on language-neutral stable attributes where available, and MUST NOT read generated assistant prose or localized status text.
