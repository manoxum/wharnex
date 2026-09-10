# AI Protocol SoT

## Protocol identifiers

- `harness.turn/v1`: classifies one conversational agent outcome.
- `harness.execution/v1`: describes executable work for a `workflow` or `change` turn.
- `harness.conflict/v1`: a Wharness-generated, focused BASE/CURRENT/RESULT capsule for resolving a planner-resolvable conflict. Its `origin` field says which reconciliation is being asked for — `integration` (the historical case, and the default when the field is absent), or `push`/`branch_merge` for a host Git operation the operator started, which additionally carries the `git` block naming the merge to replay (see `adr/ADR-0040`). For an integration conflict it resolves a verified candidate — sourced from a real Git merge conflict's merge-base/host/branch commits for a candidate integrated via the Git-native flow (see `AUTOMATION_BUNDLE.md`), or from a canonical `ChangeSet` for a candidate reconciled from an immutable archived base. Wharnex-managed `.wharnex/knowledge/**` paths never enter this planner capsule: managed-only Git collisions preserve the current host state locally, while mixed collisions expose only ordinary paths.

## Intent-first agent rule

Wharness is a project copilot, not a coding-only agent. Every provider result MUST first normalize to one structured agent turn with one of these kinds:

- `answer`: a complete project-aware answer, recommendation, explanation, comparison, review, brainstorming result, or other ASK outcome;
- `clarification`: one concise question needed because a material user decision is missing;
- `investigation`: non-mutating analysis based on evidence already available in the project context;
- `plan`: a concrete, non-mutating implementation proposal that waits for explicit user approval before any implementation continuation;
- `workflow`: a non-terminal request for bounded local evidence that Wharness can gather safely before the model decides the next step;
- `change`: an explicitly requested project mutation;
- `blocked`: a safe explanation of why the request cannot proceed.

Questions and advice requests SHOULD terminate as `answer` when the attached context is sufficient. Diagnostic/audit requests SHOULD terminate as `investigation` when evidence is sufficient. An explicit request to devise, elaborate, propose, or structure an implementation plan SHOULD terminate as `plan` even when the composer is in Direct mode. Project context, Agent mode, or Auto mode MUST NOT by themselves upgrade ASK/INVESTIGATE intent into CHANGE. Ambiguous mutation intent defaults to non-mutation or clarification.

## Iterative workflow turn

A `workflow` turn exists so one user request can span multiple ChatGPT ⇄ Wharness reasoning rounds without scraping model prose.

A workflow turn carries a normal `harness.execution/v1` plan with stricter semantics:

- status is `ready`;
- risk is `low` or `medium`;
- `requires_approval=false`;
- it contains 1..16 command operations only;
- patch operations are forbidden;
- network is always false;
- execution occurs only in a disposable Protected sandbox copy;
- workflow mutations, if a local tool happens to create any, are discarded and MUST NEVER become host Apply candidates.

After the step, Wharness captures structured argv/cwd/exit/stdout/stderr evidence, refreshes project context, creates a fresh request id, and returns those observations to the same planner conversation. The planner then returns either another materially different `workflow` step or a terminal `answer`, `investigation`, `clarification`, `plan`, `change`, or `blocked` result.

The planner MAY therefore return a `workflow` bundle specifically to request missing local information. Its human explanation states what evidence is needed, while its command-only plan is the complete machine-readable extraction instruction. Wharness classifies this as an **evidence iteration**, executes it locally under the restrictions above, and returns the structured observations to the same Main Request.

The workflow is bounded to six local rounds per original user turn. The final continuation explicitly requires a terminal result. An additional `workflow` bundle after the cap MUST be rejected while leaving the current request pending so a terminal bundle can still be supplied.

Command failure in a workflow is evidence, not an automatic repair trigger. Automatic repair remains specific to a requested `change` plan.

### Effort level and autonomous iteration budget
Every Main Request carries one user-selected `effort_level`: `low`, `medium`, `high`, `extra_high`, `max`, `ultra`, or `loop`. The level is a hard ceiling for autonomous AI resolution attempts across the request chain, including the initial attempt and subsequent automatic repair/conflict rounds: Low=1, Medium=3, High=6, Extra High=10, Max=15, Ultra=30, while Loop has no numeric ceiling. Manual operator-triggered repair is outside this automatic budget. The selected value MUST be included in planner/provider prompts so the model can optimize cost/benefit inside the available budget rather than blindly consuming it.

`extra_high`, `max`, `ultra`, and `loop` also enable continuous improvement after a successful host integration. Each post-success round consumes the same automatic-attempt budget and MUST stay scoped to the original user goal. The planner MUST stop with a terminal `answer` and no change plan when no material, safe, cost-effective improvement remains or no safe automated solution exists. Loop therefore means unbounded opportunity to iterate, not permission for an infinite busy-loop or cosmetic churn.

## AI output rule

The provider returns a structured agent turn. `workflow` and `change` carry a structured JSON `ExecutionPlan`; `plan` is an approval proposal in `turn.message` and carries no execution plan or patches; all remaining kinds also carry no plan. Markdown command extraction and regex-based shell scraping are forbidden.

Every new `harness.turn/v1` result MUST include an `outcome` object with `status=completed|failed|partial`, `retryable`, an optional stable `reason_code`, and a bounded explanatory `message`. This status reports whether the planner actually completed the requested response; it never claims that Wharness executed, verified, or applied host changes. Only `completed` may carry an execution plan. `failed` and `partial` are terminal protocol results: Wharness stores the turn/bundle, removes it from the pending set, marks the request failed, exposes the reason to the transcript, and MUST NOT send any plan to Policy or execution. Legacy plan-only bundles may synthesize `outcome.status=completed`; a new explicit `turn.json` without `outcome` is invalid.

The recovery surface for a non-completed outcome MUST preserve the original goal and offer a new request path. The user can edit the recovery prompt, add context/files, enable another configured transport, or repeat the request. In Auto, a `retryable=true` terminal outcome MAY prepare exactly one bounded fresh-request recovery automatically. A retry is a new correlated request and never silently reclassifies the failed result as successful.

Every request iteration records its immutable `request_id`, `root_request_id`, optional parent, and classification (`standard`, `plan_approval`, `repair`, `improvement`, `evidence`, or `conflict`). A retained candidate that fails to replay/merge cleanly against the current host on planner-patchable paths — whether a ChangeSet replay conflict or a real Git merge conflict on its integration branch — MUST enter the dedicated `harness.conflict/v1` path before generic repair is considered; generating another ordinary repair while the predecessor still fails replay is prohibited. Git conflicts confined to Wharnex-managed `.wharnex/knowledge/**` are local integration drift, not a model task: preserve the current host version and do not spend a planner round on them. Cancelling an active request terminates its pending transport/planner iterations and releases the conversation for a new Main Request. It preserves transcript, evidence, artifacts, and any independently verified Protected candidate; rejecting that candidate remains a separate explicit action.

Only `change` may contain patches or continue to host Apply. `workflow` may execute safe local commands only to improve reasoning.

`turn.message` is user-facing Markdown, not an execution dump. The planner SHOULD lead with the useful conclusion, keep sections and paragraphs compact, and summarize large logs/diffs/status streams rather than repeating structured execution evidence in prose. CHANGE turns still carry the required `## TODO` checklist, but protocol bookkeeping and raw machine detail belong in their structured bundle fields and dedicated Wharnex views.

## Plan proposal and approval continuation

A `plan` turn is deliberately distinct from an executable `change` plan. It contains the concrete proposal the user is approving, including scope, TODO units, risks/trade-offs, and intended verification, but it MUST NOT contain `plan.json`, patches, or project mutations. A `plan_first` composer request forces this outcome, while an explicit semantic request for a plan produces the same outcome even when the composer remains in Direct mode.

Accepting the proposal MUST NOT be submitted through the ordinary Main Request message endpoint. Wharnex creates a fresh derived request with classification `plan_approval`, `parent_request_id` equal to the approved `plan` request, and the same `root_request_id`/Main Request. The approval continuation includes the exact approved proposal as authoritative scope and asks the planner to implement it without silently expanding that scope. Its eventual `workflow`/`change` result remains subject to Policy, Protected execution, verification, and Apply exactly like any other implementation result.

While a plan proposal is waiting for the user, the session is in `awaiting_plan_approval`; the linked transport channel stays associated with the same Main Request. Rejecting the proposal terminates that approval path without mutation and releases the transport channel. Historical plan-first responses created before this protocol addition remain readable, but new `plan_first` responses MUST use `kind=plan`.

## Renderable result artifacts

A manual response bundle MAY carry user-facing, non-executable files under `artifacts/`. This directory is a presentation channel, not an execution channel: `turn.json`, `plan.json`, patches, approvals, commands, secrets, and any reasoning required to understand the result remain in their normal structured locations.

Wharnex advertises this local capability to the planner. Files under `artifacts/` are discovered from the already validated response bundle and MAY be presented inline beside the correlated result in the local chat. The local renderer supports images, audio, video, PDF, Markdown, text/source-code files, sandboxed HTML rendered through an iframe, and Office documents through safe text extraction; unsupported formats retain a download fallback. Nested paths under `artifacts/` are permitted.

Renderable HTML remains untrusted. The browser iframe is sandboxed, preview responses use restrictive CSP/referrer/resource headers, and essential presentation SHOULD be self-contained instead of depending on scripts, forms, top navigation, credentials, or remote network resources. Artifact presentation MUST NOT weaken bundle validation, host Policy, project-root containment, or the distinction between conversational output and executable `change` plans.

### Declarative artifact galleries

A response bundle MAY include `metadata/artifact-presentation.json` with protocol `harness.artifact-presentation/v1`. The manifest is optional, declarative, and non-executable. It groups real same-bundle files under `artifacts/` into one or more galleries and MAY provide labels, descriptions, alt text, a same-bundle preview path, and layout/sizing hints.

Wharnex MUST validate every referenced path against actual ZIP entries, reject traversal/absolute/remote references, bound gallery/item/text counts, and ignore model-supplied attempts to control MIME, headers, sandbox permissions, or viewer capabilities. MIME, size, preview kind, and available tools are derived from Wharnex-owned inspection. Missing or invalid presentation metadata MUST degrade to the safe automatic artifact gallery without hiding valid artifacts.

Supported v1 layout hints are `auto`, `grid`, `masonry`, and `strip`; sizing hints are `uniform` and `adaptive`. These are presentation hints rather than renderer commands. `turn.message` remains the complete primary conversational result even when a gallery is present.

## Commit-history communication

Every `change` execution plan MUST carry a planner-authored `commit_message` that is useful permanent Git history, not a transport label. The planner MUST derive it from the actual delivered patch and classify the dominant change with an accurate Conventional Commits type: `feat` for new behavior/capability, `fix` for a bug or corrective patch, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, or `chore` only when no more specific type applies. A meaningful subsystem scope SHOULD be included when clear.

The subject MUST state the concrete implemented or corrected technical outcome in human-readable language. Messages that only describe process or bookkeeping — for example `update files`, `apply patch`, `requested changes`, `implement task`, `miscellaneous fixes`, `Wharness-verified change`, or a request/plan identifier — are protocol-quality failures even if they are syntactically valid Git subjects. For a multi-file but coherent change, describe the primary behavior/outcome rather than enumerating filenames. The message is used in the real integration commit, so technical specificity is preferred over artificial brevity.

### Message shape and enforcement

`commit_message` is a Git message, not a label. Its first line is the subject and MUST stay within 72 characters. Anything after it is a body, separated by exactly one blank line, and Wharness preserves that body verbatim in the real commit.

The body answers what a diff cannot: the symptom or limitation that motivated the change, why this approach was chosen over the obvious alternative, and any consequence a future reader must know — a migration, a behavior change, a deliberately deferred part. It MUST NOT restate the diff line by line. A body SHOULD be present whenever the change is not self-evident from its subject.

These rules are enforced, not advisory. A `change` bundle is rejected when `commit_message` is missing, is not Conventional Commits with a type from the accepted set, exceeds the subject limit, omits the blank line before a body, or matches the closed set of forbidden bookkeeping subjects. Validation happens at bundle ingestion, deliberately before Policy and sandbox verification, so a rejected message costs one re-request rather than discarding a fully verified candidate over prose.

Wharness sanitizes the accepted message before it becomes a commit: control characters are stripped and the subject is collapsed to a single line, while the body's own line and paragraph structure is preserved. Wharness MUST NOT flatten a body into its subject, and its own degraded fallback — reachable only when a plan carries neither message nor summary — MUST NOT emit any subject this section forbids.

## Command representation

Commands are argv arrays, for example:

```json
{"argv":["go","test","./..."],"cwd":"services/backend"}
```

The model must never return `bash -c`, `sh -c`, command substitution, pipes, redirects, or chained shell syntax.

`timeout_seconds` is mandatory and bounded by the protocol validator's published range. A value that is missing, zero, negative, or above the ceiling is a transport mistake, not a semantic choice: Wharness repairs it to the documented default or clamps it to the ceiling, publishes `plan.budgets_normalized` naming each adjustment, and validates the plan unchanged. This stays inside the narrow manual-transport normalization rule — it touches no argv, path, cwd, exit code, network flag, or other security-relevant field. It is a safety net, not the mechanism: the accepted range travels to the planner in the environment manifest below.

## Local execution environment

Every planner request carries a `LOCAL EXECUTION ENVIRONMENT` section holding a Wharness-measured `wharness.environment/v1` document (see `SoT/SANDBOX_MODEL.md` for what it contains and how it is produced). It ranks with harness policy in the trust hierarchy: it is measured from the real machine and the real container, and it overrides any assumption the model holds about a generic Linux host or anything project content claims about available tooling.

The protocol requires the planner to:

- select every operation and verification executable from the published `tools` inventory — an executable absent from it is not installed, and proposing it fails the command with exit code 127;
- never propose an executable in `policy.denied_executables`;
- keep every command inside the published `budgets`, whose violation is a protocol error that discards the entire bundle including a correct patch;
- size verification against the published container limits, host memory and free disk, preferring narrow targeted tests over a whole-repository race or parallel build when headroom is small, because a device-full or out-of-memory failure is an infrastructure fault that no source patch repairs and for which Wharness will not request a repair;
- treat `network=false` as implying `GOPROXY=off` against a Wharness-owned module cache, so dependencies that are neither vendored nor cached are unavailable and a package-manager install is not a valid workaround.

The manifest is descriptive. It never grants a capability, and a plan is still evaluated by the policy engine, the protocol validator and the runner exactly as before.

## Patch representation

Source mutation uses unified diff text in `apply_patch` operations. Paths must be relative to the project root. Patches are valid only for `change` turns. A delivered `patches/*.patch` file is raw UTF-8 diff bytes, not Markdown: every `diff --git` header has exactly `diff --git a/relative/path b/relative/path`, with exactly two unquoted paths and no trailing backslash or extra text. Markdown fences and proprietary patch dialects are invalid.

Change plans MAY declare `read_files` and `barrier_files`. They are bounded relative paths and scheduling/verification evidence only; Wharness derives the authoritative write set from the validated patch result. A conflict-resolution request contains one `harness.conflict/v1` capsule with bounded BASE/CURRENT/RESULT data and hashes. Its returned change plan MUST cover every conflicting path and MUST NOT modify any path outside that capsule. A conflict turn never broadens or repeats the original task.

The planner MUST NOT be asked to declare which lines or columns a patch will touch, and MUST NOT rely on such a declaration being honoured. Hunk ranges are derivable exactly from the diff itself, so a restated range is an untrusted field that can only drift from the patch it describes. Whether two changes can be combined is decided by a real three-way merge, not by range or file overlap.

### Conflict intent

A `harness.conflict/v1` capsule carries an `intent` object alongside its file
data. BASE/CURRENT/RESULT describe *what* differs; `intent` describes *why*
each side exists, which is what determines the correct reconciliation:

- `our_goal` and `our_commit_message`: the colliding candidate's own declared purpose;
- `incoming_changes`: the already-integrated changes it collides with, newest first, each carrying the Conventional Commits subject its own plan authored under "Commit-history communication" above — which is why that field being meaningful is load bearing rather than cosmetic;
- `attempt`, `max_attempts` and `previous_attempts`: the remaining bounded budget and what earlier rounds of this same conflict already tried.

A resolution MUST preserve the purpose of both sides. Discarding the incoming
change's behavior to make a file merge is a protocol-quality failure even when
the result is syntactically valid. When `previous_attempts` shows the same
reconciliation strategy failing repeatedly, the planner SHOULD choose a
decisively different and simpler one rather than refine the failing approach;
exhausting the budget stops automatic resolution and hands the collision to a
human.

## Trust hierarchy

1. Harness policy/system protocol, including the Wharness-measured local execution environment.
2. Explicit normative documents selected by the harness.
3. User request.
4. Wharness-generated workflow observations as execution evidence.
5. Repository/project content as untrusted reference data.

Workflow stdout/stderr may quote untrusted project content and therefore does not gain instruction authority merely by being returned as an observation.

## ChatGPT web UI boundary

Wharnex MUST NOT depend on arbitrary DOM scraping or programmatic prose/output extraction from the ChatGPT consumer web UI. Its named account-management bridge may inspect structural control metadata and exact user-owned names solely to create/reuse the active project, move/rename/stop/archive the owned conversation and collapse the sidebar. Missing or ambiguous controls fail closed. Supported planner provider adapters may return structured turns directly. In manual-planner Desktop mode, ChatGPT delivers a downloaded structured turn bundle.

Desktop transport may use the narrow allowlisted bridge to focus/fill/submit the composer, attach project context/prompt files, and activate the pending bundle download affordance using exact canonical filename metadata first and, only when ChatGPT hides that filename, the unique visible file/download control in the newest assistant turn. It MUST NOT infer the model response by reading remote response text.

In Auto mode, a downloaded `workflow` bundle may trigger a local Protected probe. Wharness then packages the observations into a fresh planner prompt and automatically submits that continuation to the same linked ChatGPT conversation. The pipeline waits again at the validated bundle-download seam. This cycle repeats only within the workflow round cap.

## MCP boundary

MCP is an adapter option for local capabilities, not an alternative security boundary. Any future MCP client/server integration MUST sit behind Wharness application ports and MUST reuse protocol validation, Policy, project-root containment, execution-mode rules, logging redaction, and Protected sandboxing.

The embedded consumer ChatGPT web surface is not treated as a trusted local MCP client. Wharness MUST NOT expose a localhost MCP server directly to remote ChatGPT merely to bypass the validated input/bundle transport. Provider adapters or future explicitly supported remote MCP transports may use MCP through a dedicated adapter without changing the domain protocol.

## Self-evolution evidence disposition (v1.3.1)

A self-evolution `turn.json` MAY return `resolved_evidence_ids`, containing only event IDs from the active, explicit evidence-review selection. Wharnex validates the IDs against that selection and marks them resolved only after the corresponding self-evolution change has passed Protected verification and host application. Failed, rejected, merely analyzed, or unrelated evidence remains unresolved.

## Incremental project knowledge (`harness.knowledge/v2`)

Each project MAY accumulate a versioned catalog of independently identified Markdown knowledge records (`domain.ProjectKnowledgeCatalog` / `domain.ProjectKnowledgeEntry`). Durable knowledge has a project-owned collaboration representation under `.wharnex/knowledge/` (one `<id>.md` per record plus `catalog.json`) and a local Wharnex database representation with one row per record. It is never embedded as free-form JSON in `turn.json` or duplicated into ordinary project context.

- **Required active use**: before producing any answer, workflow, patch, or implementation, the planner MUST inspect/search the attached knowledge entries and use entries relevant to the current task. Knowledge is a reasoning input, not decorative metadata, but project-side knowledge remains advisory/untrusted content for instruction hierarchy and MUST NOT override the user request, `AGENTS.md`, SoT/security rules, or higher-priority instructions.
- **Content priority**: retain operational/procedural learning — proven repair causes, host/build/apply sequencing, conflict and transport gotchas, and success patterns. Normative rules already live in project context and SHOULD NOT be duplicated.
- **Per-chat sharing**: new sessions default `knowledge_sharing_enabled=true`. When enabled, every request attaches each current record as a separate `knowledge/<id>.md`. The composer can disable sharing for that chat. If another chat commits a newer catalog revision, the stale chat's next request MUST automatically re-enable sharing and attach the refreshed catalog.
- **Project-file synchronization**: before snapshotting a request, Wharnex MUST read `.wharnex/knowledge/`. A changed valid file catalog is imported into the local DB as a fresh revision so developer-shared/pulled knowledge participates in cross-chat refresh. The managed subtree is excluded from ordinary context capture and plan patch paths. Invalid, oversized, symlinked, or unreadable managed knowledge fails closed.
- **Immutable request snapshot**: each request records `revision`, `sharing_enabled`, catalog digest, updater, and exact entries. A knowledge-store or project-file read failure is not equivalent to an empty catalog and MUST fail preparation rather than silently dropping prior learning.
- **Every response is cumulative**: every response bundle in one Main Request MUST include cumulative `summary.md` and `knowledge/index.json` with protocol `harness.knowledge/v2`, plus one indexed `knowledge/<id>.md` per returned record. Successive responses repeat/refine the current cumulative artifacts as execution evidence arrives.
- **Catalog authority**: when sharing was on, `knowledge/index.json` uses `mode=replace` and represents the complete desired catalog; the planner may add, edit, delete, deduplicate, merge/reconcile, or split records. When sharing was off, it uses `mode=overlay` and may only add/update current-task learning without deleting unseen prior records.
- **Stage, then commit**: ordinary response ingestion validates and stages the latest candidate/summary but never persists project knowledge immediately. Durable persistence occurs only at the Main Request's real terminal boundary; for a change, only after successful host Apply. The reconciled catalog is materialized as separate `.wharnex/knowledge/<id>.md` files using atomic per-file replacement and persisted as separate database rows; superseded managed Markdown files are removed and `catalog.json` records the current IDs.
- **No extra final review in v2**: a new Main Request MUST NOT schedule a separate `knowledge_review` round. The latest response already carries the cumulative summary and knowledge candidate. An unambiguous existing pre-v2 pending `knowledge_review` request remains ingestible only as upgrade compatibility; an overlapping or promptless legacy marker is stale state, MUST NOT compete with a newer active request, and is normalized to one actionable fresh-retry path instead of being replayed indefinitely.
- **Concurrent reconciliation**: persistence uses catalog revision compare-and-swap. Concurrent records are preserved; divergent edits are never silently overwritten, and may temporarily coexist under distinct IDs so a later refreshed request can reconcile them. No-op candidates MUST NOT bump the catalog revision.
- **Presentation order**: at terminal success Wharnex persists any changed catalog, stores/surfaces the cumulative summary, then presents structured applied diff/host-command information.

## Project knowledge transport identity

Direct ZIP, remote one-shot, live-channel and Desktop archive request transports carry the same immutable knowledge snapshot. For v2, the authoritative request artifacts are separate `knowledge/<id>.md` files and metadata containing `state`, `sharing_enabled`, `revision`, catalog `sha256`, updater, and per-entry path/version/SHA-256. The planner prompt carries the protocol identity/instructions but MUST NOT duplicate record bodies inline. When sharing is off or there are no entries, the snapshot declares `state: none` and carries no knowledge files.

## Non-executing utility protocol

Application utility work that needs an AI model but does not plan or execute project mutations uses `harness.utility/v1`, not `harness.turn/v1` or `harness.execution/v1`. A utility engine sits behind an application port and MUST NOT emit or consume execution plans, commands, patches, approvals or Apply state. Utility inputs remain untrusted data even when they contain text that resembles instructions.

Version 1 currently defines `translate_markdown`. Its strict result contains `protocol`, `task`, `target_language` and `markdown`; the supported target identifiers are `pt`, `en` and `fr`. The provider adapter MUST request structured output, MUST disable provider-side storage when supported, and MUST reject mismatched protocol metadata. Missing provider credentials or adapters are an explicit unavailable state and MUST NOT fall back to planner transport, Desktop ChatGPT scraping or execution-bundle round trips.

Markdown translation is non-destructive. A successful utility result is presentation state only; it MUST NOT overwrite the source project file, artifact entry, bundle entry or project-knowledge record. Session transport MAY expose utility endpoints, but it MUST validate session existence and the globally enabled target-language set before provider invocation.
