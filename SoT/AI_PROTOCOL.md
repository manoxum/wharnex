# AI Protocol SoT

## Protocol identifiers

- `harness.request-metadata/v1`: engine-authored identity repeated in every provider request bundle and its bounded composer bootstrap: `chat_title`, local `chat_id`, context/chat `chat_hash`, and `requested_at`.
- `harness.turn/v1`: classifies one conversational agent outcome.
- `harness.execution/v1`: legacy executable work accepted only for persisted/in-flight compatibility; new planner/provider output does not target it.
- `harness.execution/v2`: describes new executable work for a `workflow` or `change` turn and carries the informed execution contract.
- `harness.interactive/v1`: the public interactive observation extension carried only by a `workflow` execution plan. It declares a bounded `sandbox|host` target and rationale; it is read-only. `harness.debug/v1` is a legacy observe-only compatibility spelling.
- `wharness.translation-input/v1`: the request bundle Wharnex uploads for one document translation.
- `harness.translation/v1`: the response bundle ChatGPT returns for that request.
- `harness.git-context/v1`: engine-authored, read-only Git working-state and local-unpushed-commit context carried with planner requests under `git-context/`; `harness.git-context-worktree/v1` and `harness.git-context-commit/v1` identify its bounded worktree and per-commit records.
- `harness.conflict/v1`: a Wharness-generated, focused BASE/CURRENT/RESULT capsule for resolving a planner-resolvable conflict. It travels as the fixed `conflict/capsule.json` entry of the single request ZIP and is referenced, never duplicated, by the bounded prompt. Its `origin` field says which reconciliation is being asked for — `integration` (the historical case, and the default when the field is absent), or `push`/`pull`/`branch_merge` for a host Git operation the operator started, which additionally carries the `git` block naming the merge to replay (see `adr/ADR-0040`). For an integration conflict it resolves a verified candidate — sourced from a real Git merge conflict's merge-base/host/branch commits for a candidate integrated via the Git-native flow (see `AUTOMATION_BUNDLE.md`), or from a canonical `ChangeSet` for a candidate reconciled from an immutable archived base. Wharnex-managed `.wharnex/knowledge/**` paths never enter this planner capsule: managed-only Git collisions preserve the current host state locally, while mixed collisions expose only ordinary paths.

## Composer directive language (v1.3.10 — see `adr/ADR-0053`)

An operator points at things from inside the prompt, with four directives sharing one grammar: `@file` names a path in this request's own project, `@ref` names another project Wharnex has worked on before, optionally one file inside it, `@attach` names a file or directory outside every project, and `@see` spotlights one exact file already visible to the request. What is typed is `@file:<path>` / `@ref:<project>[/<path>]` / `@attach:<absolute path>` / `@see:<search>`, bracketed as `<<…>>` when the value contains a space; what is sent is the canonical `@{[file]…}` / `@{[ref]…}` / `@{[attach]…}` / `@{[see]…}`. Every accepted spelling MUST parse, because a prompt can be re-submitted after a round trip and has to mean the same thing twice, and canonicalization MUST be idempotent.

`@ref` and `@attach` additionally accept alternate keywords — `@reference`, `@references`, `@project` for `@ref`; `@att`, `@attch`, `@attche`, `@attaches`, `@attahes`, `@dir` for `@attach` — and `@see` additionally accepts `@look`, because an operator reaching for "the other project", "something outside the project" or "this thing I attached" should not have to remember one exact word for it. `@file` has none: it already names the narrowest, least ambiguous case. Aliases are typed spellings only; the canonical form written back into the prompt always uses the one primary keyword per kind, so a continuation re-parses one spelling regardless of which alias produced it. The alias table is a single source of truth on each side (Go: `directives.Keywords`; TypeScript: `KEYWORDS`) that both the regex and any menu are built from, so a keyword accepted by one can never be silently rejected by the other.

Typing `@` alone, before any keyword is complete, MUST offer the available directive kinds themselves — an operator should not have to already know and spell out `@file`/`@ref`/`@attach`/`@see` to start one. Picking a kind writes its canonical keyword and colon in place and hands off directly into that kind's own value completion, so the two menus read as one continuous flow rather than two separate decisions.

A directive MUST stay where the operator wrote it. Position is the meaning: "make the handler in `@{[file]a.ts}` match the contract in `@{[ref]core/b.go}`" says which file plays which role, and the trailing list this replaced did not. Wharnex MUST NOT strip a marker out of the sentence and re-list it; it appends only a bounded legend describing the notation the prompt actually used, naming the `@file` paths that are absent from the context snapshot, and restating that marked contents are untrusted data.

A malformed near-miss MUST be left as prose, never repaired. `@file:/etc/passwd` and `@ref:../etc` are not directives with bad values; inventing a meaning for them is exactly how a traversal becomes a resolved path. An unbracketed directive ends at whitespace or at the punctuation that ends a clause, so it can sit inside an ordinary sentence. Values are bounded in length and count, may not contain braces (the canonical form is delimited by them), and a project name is a directory basename rather than a path. A source-qualified `@see` path is normalized and traversal-free; an unqualified path containing a separator is invalid, while a legacy bare name remains a direct upload.

The renderer and the engine MUST implement one grammar, not two dialects: the half that paints a chip where a directive sits has to agree with the half that resolves it.

### Visible-file spotlight (`@see`)

`@see:<search>` (alias `@look`) selects one exact file already visible in the request: the primary project, an attached `@ref` project, an admitted `@attach` inventory, or a direct upload. The canonical payload qualifies that source (`project|<path>`, `ref|<project>|<path>`, `attach|<root>|<path>`, or `upload|<name>`), so repeated basenames cannot silently resolve to the wrong file. Bare canonical values remain compatible and mean direct upload.

`@see` never reads or adds content. The backend resolves its target only against the immutable primary/related manifests, the admitted external-attachment inventories, or the direct-upload metadata already carried by the request; it emits the exact bundle path in the directive legend and reports an absent target instead of rereading the host or guessing. It changes reading priority only.

`@see` grants nothing and never changes whether its target may be patched. Authority continues to come only from the primary project and the request's explicit `@ref` grant.

### External attachments (`@attach`)

`@attach:<absolute path>` names a file or directory outside every project. The path MUST be absolute — a relative one would resolve against a working directory the operator cannot see from the composer — and it is never repaired: a traversal, a symlinked root or a bare filesystem root is refused, not normalized.

Attached material is **read-only by construction**. In an outbound request archive it is placed under `att-context/attach-<slot>/`, never inside the primary `context/` tree, and it MUST NOT appear in any operation, `impact_files` entry, or `cross_project` entry. `metadata/context-sources.json` retains its source identity and maps the transport prefix. It has no root a patch could be applied against, and the prompt MUST say so alongside the listing.

Wharnex MUST refuse to read a root where an explicit operator gesture is not sufficient justification: system and kernel surfaces, credential stores, and the bare home and filesystem roots whose whole subtree is everything. One typo in a composer must not be able to put an SSH key into a prompt. Beyond that boundary, an attachment is selected by exactly the engine the project's own context configuration uses — mandatory security exclusions, automatic pruning, the include whitelist, the exclude list, the secret-content scan and the binary detector — so there is one predicate rather than two that can drift.

A directory attachment carries its selection **inside its own marker**, as `|+<include>` and `|-<exclude>` tokens plus an optional `|!auto` opting out of automatic pruning. The selection travels with the prompt text so that what is stored, re-read on a continuation and shown in a transcript is exactly what was sent; a selection kept beside the text is a selection that can disagree with it. Patterns are bounded in count, use the same `*`/`?`/`**` vocabulary as the project configuration, and may not climb out of the attached root.

Every attachment is bounded in file size, total bytes and file count. Hitting a bound MUST be reported as truncation in the prompt rather than silently sending less than the operator asked for, and a refused or unreadable attachment MUST be named as absent rather than degrading to silence.

## Cross-project requests (v1.3.8 — see `adr/ADR-0053`)

`@ref:<project>` in a Main Request's own prompt is also the only way that request acquires authority to change that project. The grant is derived from the operator's own text before the planner is asked, recorded durably against the root request, and inherited unchanged by every continuation — a later round MUST NOT be able to widen it by naming a new project in a bundle.

Referring and changing are separate authorities, and they resolve against different sets. A name resolves against **every project Wharnex has worked on before**, open or closed, folding case and accepting either the context namespace name or the project directory's basename; where a name could mean two projects, one already attached to the session wins it. A resolved project whose context is not yet in the snapshot MUST have it brought in, because a reference the model cannot see is not a reference. An unresolved name MUST be reported to the planner rather than silently dropped.

A **change**, by contrast, requires that project to have a live session, because that session is what carries the Protected/Unprotected/Full and automation modes deciding how a change reaches that host. A project that is closed has chosen nothing, and the defaults a fresh session would receive are not the operator's decision to inherit on their behalf. The prompt MUST therefore name which granted projects a change cannot currently reach, so the planner spends its effort where it can land instead of returning an entry ingestion is bound to refuse.

A response changes a granted project through `plan.json`'s `cross_project` array: one self-contained entry per project, each with `project` (the granted reference name, never a path), its own mandatory `commit_message` under the same Conventional Commits contract as the primary plan, its own `operations`, and its own `verification`. It is a list of whole changes rather than a `project` tag on each operation because a change to another project needs its own commit message — it becomes that project's Git history — and its own verification, which runs in that project's sandbox against that project's tree. Patch paths inside an entry are relative to that project's root and `patch_file` resolves from the same `patches/` directory. Entries are validated exactly as the primary plan is; an entry declaring no operations MUST be rejected rather than ignored, because dropping it would leave the response claiming a change that never happened.

Authorization is fail-closed and runs at ingestion, before Policy and before any sandbox: an entry naming a project the prompt did not grant, a `cross_project` array with no grant at all, two entries for one project, or a granted project that is no longer open or already holds unfinished work of its own are all refusals. Refusing there costs one re-request; the same refusal after verification would discard a verified candidate over a condition that was knowable before anything ran. A busy or closed target is a typed local condition, not a source defect, and MUST NOT reach the repair loop.

Each granted entry executes as a **derived request on its own project**: that project's own Protected sandbox, its own verification, its own Git-native host integration, anchored on a request base captured in that project when the prompt was submitted. Writing to a project is an authority that belongs to that project and does not change because the patch arrived through another project's chat. The target project's own modes decide what follows — Protected + Auto runs and applies, anything else leaves the plan installed for the operator to act on from that project's own surface. Entries run only after the primary project's own work has settled, in declaration order, stopping at the first failure, and every outcome is reported including the entries that were never attempted.

## Intent-first agent rule

Wharness is a project copilot, not a coding-only agent. Every provider result MUST first normalize to one structured agent turn with one of these kinds:

- `answer`: a complete project-aware answer, recommendation, explanation, comparison, review, brainstorming result, or other ASK outcome;
- `clarification`: one concise question needed because a material user decision is missing;
- `investigation`: non-mutating analysis based on evidence already available in the project context;
- `plan`: a concrete, non-mutating implementation proposal that waits for explicit user approval before any implementation continuation;
- `workflow`: a non-terminal request for bounded local evidence that Wharness can gather safely before the model decides the next step;
- `change`: an explicitly requested project mutation;
- `blocked`: a safe explanation of why the request cannot proceed.

Questions and advice requests SHOULD terminate as `answer` when the attached context is sufficient. Diagnostic/audit requests SHOULD terminate as `investigation` when evidence is sufficient. An explicit request to devise, elaborate, propose, draft, present, or structure an implementation plan MUST terminate as `plan` even when the composer is in Direct mode. The UI toggle is a convenience hint, not the only way to select planning-only behavior. Project context, Agent mode, or an automatic execution mode MUST NOT by themselves upgrade ASK/INVESTIGATE intent into CHANGE. Ambiguous mutation intent defaults to non-mutation or clarification.

## Acceptance evidence for corrective changes

For a reported runtime defect, the planner MUST distinguish a prepared change,
Protected test evidence, host integration evidence, and observed runtime
acceptance. An `applied` session, a successful build, or a mocked query test
alone MUST NOT be described as proof that the live symptom is resolved.
Acceptance checks MUST cover the reported entry points and a valid unaffected
case. Missing local evidence is requested through a bounded workflow; host
rollout remains behind the engine's informed-command approval boundary. The
terminal summary MUST name checks that actually ran and checks still pending.
These reporting requirements add no command authority or wire fields.

Diagnostic workflows MUST preserve bounded stage identifiers, native error
codes (including SQLSTATE where available), and successful partial evidence.
Client wrapper codes alone MUST NOT replace the underlying failure. They MUST
NOT emit credentials, connection strings, raw business records or unbounded
error messages. A process exit zero or `workflow.completed` does not establish
that every diagnostic stage passed: the planner MUST inspect stage failure
flags and missing prerequisites before claiming diagnostic or runtime success.

## Iterative workflow turn

A `workflow` turn exists so one user request can span multiple ChatGPT ⇄ Wharness reasoning rounds without scraping model prose.

A workflow turn carries a normal `harness.execution/v2` plan with stricter semantics:

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

The workflow is bounded to six executed local steps per original user turn (interactive protocols: twenty-four). Partial context increments are planner-paced snapshot reads, not executed steps: they never spend this budget and have no round ceiling of their own (`SoT/CONTEXT_PROTOCOL.md`). The final executed-step continuation explicitly requires a terminal result. An additional `workflow` bundle after the cap MUST be rejected while leaving the current request pending so a terminal bundle can still be supplied.

Command failure in a workflow is evidence, not an automatic repair trigger. Automatic repair remains specific to a requested `change` plan.

### Interactive workflow

A planner MAY attach `debug: {protocol:"harness.interactive/v1", target:"sandbox|host", access:"observe", rationale:"…"}` to a `workflow` plan when refreshed local evidence is necessary. The field name remains for persisted compatibility, but the user-facing protocol is **Interativo**. `harness.debug/v1` remains readable only as a legacy observe protocol. Neither protocol permits patches, Apply, network, host mutation, inline programs or arbitrary host readers; every operation remains an argv array whose stdout/stderr/exit status returns to the same Main Request as untrusted evidence.

When Debug mode is on and the answer depends on machine-local runtime state, the planner MUST emit a targeted executable debug workflow before a terminal answer whenever a Policy-accepted local probe can resolve the uncertainty. Its command list is the GPT-authored instruction set and Wharnex feeds stdout/stderr/exit evidence back into the same Main Request. Engine-owned queries may supplement this path for durable ledger facts, but must not replace a relevant executable probe.

`observe` preserves the original diagnostic boundary. A sandbox target uses the isolated copied workspace. A host target is restricted to the Engine's closed read-only diagnostic vocabulary; generic file readers, shells, package mutation, Git mutation, Docker and privilege tools are forbidden, `network=false`, risk is low/medium, and `requires_approval=false`. For aggregate machine-local execution evidence, observe MAY additionally carry `query:"project_execution_summary"` with `target:"host"`. The Engine resolves that exact name internally from persisted events belonging to the current project and returns bounded counts for sessions, successful/failed executions, Host Apply, pending activation and failure kinds without arbitrary SQL, raw event bodies, credentials or caller-selected paths.

Legacy `access:"modify"` is retired and rejected before execution. Destructive or external work requires a reviewed dedicated typed-operation module with inventory, immutable candidate manifest, preflight, scoped approval, revalidation and postcondition verification; no generic argv path may provide it.

Interativo is an operator-selected composer capability. With it enabled, compatible observe rounds may run automatically. With it disabled, the first observe plan for each Main Request root waits for one explicit authorization and descendants of that same root inherit it. The interactive evidence budget is 24 materially distinct rounds; ordinary workflow remains capped at six.

### Structured interview

Whenever a material user decision is missing, any Main Request or continuation MAY return a terminal `clarification` with `interview: {protocol:"harness.interview/v1", questions:[…]}`. It contains 1..8 questions and 2..8 short options per question. The selected option is copied to the user's composer and requires an ordinary explicit send; an interview is never an approval or execution command.

### Effort level and autonomous iteration budget
Every Main Request carries one user-selected `effort_level`: `low`, `medium`, `high`, `extra_high`, `max`, `ultra`, or `loop`. The level is a hard ceiling for autonomous AI resolution attempts across the request chain, including the initial attempt and subsequent automatic repair/conflict rounds: Low=1, Medium=3, High=6, Extra High=10, Max=15, Ultra=30, while Loop has no numeric ceiling. Manual operator-triggered repair is outside this automatic budget. The selected value MUST be included in planner/provider prompts so the model can optimize cost/benefit inside the available budget rather than blindly consuming it.

`reasoning_effort` is a separate per-chat provider-depth choice: `instant`, `medium`, or `high`. It MUST NOT change, consume, or be inferred from `effort_level`. Every provider prompt for that chat, including orchestration and continuation prompts, carries the selected value. The OpenAI Responses adapter maps it to a capability supported by the configured model (`instant` maps to that model's lowest supported reasoning mode); the ChatGPT browser adapter MUST structurally observe and, when necessary, set the composer control before submission, then verify the resulting state. A missing, ambiguous, or unverified control fails closed before the prompt is sent. Translation utility work always uses `instant`, independently of the originating chat.

The effort budget applies only while the Main Request is unresolved: the initial attempt plus automatic repair/conflict/reconciliation rounds before terminal success. A successful host integration is the terminal boundary for a change Main Request; Wharnex MUST NOT schedule a post-success continuous-improvement planner round. Any further improvement after Apply is a new user-authored Main Request with its own effort budget. `loop` therefore means no numeric ceiling on materially different pre-success correction rounds, not an open-ended post-success optimization loop.

## AI output rule

The provider returns a structured agent turn. `workflow` and `change` carry a structured JSON `ExecutionPlan`; `plan` is an approval proposal in `turn.message` and carries no execution plan or patches; all remaining kinds also carry no plan. Markdown command extraction and regex-based shell scraping are forbidden.

Every newly requested `harness.execution/v2` `change` plan MUST be an informed execution contract: `document` contains the complete Markdown implementation plan, `dependencies` lists every install/update/remove by service/scope and package manager, and `system_tools` lists every sandbox/host tool to use/install/update/configure. Empty lists are explicit when there is no such impact. The exact `operations` patches and commands remain authoritative and must be sufficient for the Plan surface to display every create/modify/delete diff without deriving executable work from prose.

The planning-only **Plano do Chat** and the later **Plano de execução** are distinct. The former is the proposal the model intends to follow and carries no executable payload. The latter is produced only after the remote implementation work and is the complete local contract containing every resulting operation, dependency/tool impact, verification and exact diff. Approving a Plano do Chat records its exact Markdown and SHA-256. Its linked implementation bundle MUST carry that proposal unchanged as `approved_chat_plan`; Wharnex verifies the parent request, digest and bytes before Policy. That one approval authorizes the bound implementation, Protected sandbox verification and the post-verification host integration regardless of Manual/Auto/Auto + Aprovar automation mode. It does not authorize an altered/missing binding, another Main Request, host-direct Unprotected/Full execution, or any undeclared scope. An ordinary Direct change instead receives its one informed approval from the complete Plano de execução; after successful sandbox verification, Protected execution integrates into the host without a second prompt. A later Policy boundary that genuinely requires another decision renews this same execution-plus-integration authorization; it never creates a separate Apply decision.

When a Desktop window binds several projects, the internal workspace context MAY carry `harness.related-projects/v1`, but the outbound request archive MUST expose the primary project only under `context/` and each companion snapshot under `ref-context/<slot>-<name>/`; `metadata/context-sources.json` records the source mapping and authority. The combined transport identity covers every snapshot, but `ExecutionPlan.base_context_sha256`, all relative paths and every operation in `operations` continue to target exactly the primary project. Cross-project analysis is always allowed. Mutating a companion project is allowed only through `cross_project` and only for a project this request's own prompt granted with `@ref:` (see "Cross-project requests" above); it still runs as a separate plan against that project's own Session, preserving independent Policy, Protected sandbox, informed execution decisions and host integration. A companion project that was not granted remains reference material only.

Every new `harness.turn/v1` result MUST include a concise `chat_title` plus an `outcome` object with `status=completed|failed|partial`, `retryable`, an optional stable `reason_code`, and a bounded explanatory `message`. `chat_title` names the semantic Main Request (not ZIP/bundle transport), is limited to 82 characters, carries no `WHX:` prefix, and stays stable across continuation rounds; Wharnex uses it as the definitive local title and queues the linked ChatGPT conversation rename after accepting the result. This status reports whether the planner actually completed the requested response; it never claims that Wharness executed, verified, or applied host changes. Only `completed` may carry an execution plan. `failed` and `partial` are terminal protocol results: Wharness stores the turn/bundle, removes it from the pending set, marks the request failed, exposes the reason to the transcript, and MUST NOT send any plan to Policy or execution. Legacy plan-only bundles may synthesize `outcome.status=completed`; a new explicit `turn.json` without `outcome` is invalid.

The recovery surface for a non-completed outcome MUST preserve the original goal and offer a new request path. The user can edit the recovery prompt, add context/files, enable another configured transport, or repeat the request. In Auto, a `retryable=true` terminal outcome MAY prepare exactly one bounded fresh-request recovery automatically. A retry is a new correlated request and never silently reclassifies the failed result as successful. Every failure-driven continuation MUST carry the concrete previous failure reason as authoritative evidence and preserve request lineage so the next planner turn can distinguish a correction from a new task.

`retryable=true` is reserved for conditions where a new request can materially change the available evidence, strategy, or transient capability. A structural repository boundary, policy/infrastructure condition, unsupported project root, or other blocker that requires an operator action outside the current planner turn MUST return `retryable=false`.

`retryable=false` MUST be honoured by every retry path, manual as well as automatic. A blocker that only Wharnex's integration layer can remove MUST be reported with `kind=blocked`, `retryable=false` and `reason_code=integration_action_required`, and the instruction MUST tell the planner so; Wharnex performs that recovery itself rather than waiting for operator guidance (`SoT/ERROR_MODEL.md`). `reason_code` is matched against a hand-reviewed closed infrastructure allowlist, while an otherwise-unclassified non-retryable result receives Wharnex's own `planner_guidance_required` failure kind; `retryable` is a required boolean the planner is instructed to set accurately, and it therefore remains authoritative without depending on a growing reason-code vocabulary. A bare manual retry of a `retryable=false` outcome MUST be refused, naming the planner's own reason, because it asks the planner to solve a condition it has already declared unsolvable and is answered identically every round. Explicit operator guidance is the deliberate escape: supplying it is the operator stating that something outside the planner's view has changed. Because that refusal is certain, the recovery surface MUST NOT offer a bare retry for such an outcome at all: it withdraws every no-guidance resume action, labels the state as requiring new evidence, and validates a non-empty bounded evidence/guidance field before the request is sent, so the operator is never handed an action whose only possible answer is the refusal. When the missing evidence may contain multi-line diagnostics, the input MUST preserve those lines. When a continuation receives failure evidence, the planner MUST NOT repeat a semantically equivalent plan, blocked target/root, command strategy, or merely restate the same blocker as another retry. It must either choose a materially different approach that addresses the named root cause, or terminate as `blocked` with `retryable=false` and the concrete operator action required.

Every request iteration records its immutable `request_id`, `root_request_id`, optional parent, and classification (`standard`, `plan_approval`, `plan_correction`, `execution_plan_adjustment`, `repair`, `improvement`, `evidence`, `post_integration_evidence`, or `conflict`). A retained candidate that fails to replay/merge cleanly against the current host on planner-patchable paths — whether a ChangeSet replay conflict or a real Git merge conflict on its integration branch — MUST enter the dedicated `harness.conflict/v1` path before generic repair is considered; generating another ordinary repair while the predecessor still fails replay is prohibited. Git conflicts confined to Wharnex-managed `.wharnex/knowledge/**` are local integration drift, not a model task: preserve the current host version and do not spend a planner round on them. Cancelling an active request terminates its pending transport/planner iterations and releases the conversation for a new Main Request. It preserves transcript, evidence, artifacts, and any independently verified Protected candidate; rejecting that candidate remains a separate explicit action.

Only `change` may contain patches or continue to host Apply. `workflow` may execute safe local commands only to improve reasoning.

### Engine-owned project version

Every project root MUST contain `VERSION`. Wharnex creates a missing file as `v0.0.0.0`; the planner never creates, patches, renames, copies, or otherwise mutates it. A patch that targets root `VERSION` is rejected at protocol validation, and `VERSION` must not appear in `impact_files`.

Every `change` execution plan MUST carry `version_increment` with exactly two fields: `component` and `amount`. `component` is one of `major`, `medium`, `minor`, or `patch`; `amount` is an integer from 1 through 1000. The canonical version is `vA.B.C.D`, where those component names map to A/B/C/D respectively. Applying an increment raises the selected component by `amount` and resets all lower components to zero. A `workflow` plan MUST omit `version_increment`.

The metadata is an instruction to Wharnex, not part of the candidate patch. Wharnex applies the ordered increments only after the candidate has integrated with the current host and post-integration verification has succeeded. If the host integration fails, `VERSION` does not advance. This keeps version history coupled to accepted project state instead of planner output generation.

`turn.message` is user-facing Markdown, not an execution dump. The planner SHOULD lead with the useful conclusion, keep sections and paragraphs compact, and summarize large logs/diffs/status streams rather than repeating structured execution evidence in prose. CHANGE turns still carry the required `## TODO` checklist, but protocol bookkeeping and raw machine detail belong in their structured bundle fields and dedicated Wharnex views.

## Plan proposal and approval continuation

A `plan` turn is deliberately distinct from an executable `change` plan. It contains the concrete proposal the user is approving, including scope, TODO units, risks/trade-offs, and intended verification, but it MUST NOT contain `plan.json`, patches, or project mutations. A `plan_first` composer request forces this outcome, while an explicit semantic request for a plan produces the same outcome even when the composer remains in Direct mode.

Accepting the proposal MUST NOT be submitted through the ordinary Main Request message endpoint. Wharnex creates a fresh derived request with classification `plan_approval`, `parent_request_id` equal to the approved `plan` request, and the same `root_request_id`/Main Request. The approval continuation includes the exact approved proposal as authoritative scope and asks the planner to implement it without silently expanding that scope. Its eventual `workflow`/`change` result remains subject to Policy, Protected execution, verification, and Apply exactly like any other implementation result.

Requesting a correction follows the same continuation rule but stays planning-only. Wharnex creates a fresh derived request with classification `plan_correction`, mode `correct_plan`, the pending proposal as parent, and the same Main Request root. The continuation includes the current proposal plus the user guidance and MUST return a new `kind=plan` without `plan.json`, patches, workflow commands, or project mutation. Creating the correction continuation immediately supersedes the parent proposal, which can no longer be approved or corrected; the revised proposal requires a new explicit decision.
This extension requires no persisted schema migration because request lineage classification and `last_request_mode` are string-valued; historical plan proposals remain readable and keep their existing approval/rejection semantics.

Adjusting an unexecuted **Plano de execução** is a different continuation. While a
`change` plan is still in `planned` state, the execution-contract surface MAY
offer `Ajustar` beside reject and execute. Choosing it prepares the current plan
inside the ordinary composer as a request-local Markdown attachment so the
operator can use the same directives, attachments and `@see` references as any
other prompt. Submitting that draft creates a fresh derived request classified
`execution_plan_adjustment`, with mode `adjust_plan`, the current executable
plan request as parent and the same Main Request root. Its input bundle type is
`adjustment`, never `correction`/`plan_correction`.

An explicit operator adjustment MAY also replace a failed Protected execution of the latest plan, but only when its matching execution result is unsuccessful, no execution is in flight, and no host candidate is pending. It MUST NOT adjust successful, integrated or host-direct executed work. This is operator-authored review guidance, never an automatic source repair for infrastructure failure; the failure evidence remains in the durable history and the replacement stays in the original Main Request lineage.

An operator MAY request `post_integration_evidence` after the latest Protected change is actually integrated and its matching verification succeeded. This is a derived request in the same Main Request, carrying the integration receipt and operator's runtime-check guidance; it does not execute or integrate the source again. The initial response MUST be a bounded workflow, context request, clarification or blocked result, never another patch or an unsupported claim of runtime success. Protocol-repair and context continuations MUST retain this observation requirement until an engine-owned workflow/evidence continuation carries actual execution results back to the planner; repairing an invalid response is not runtime evidence. Host rollout and runtime access retain their normal exact-plan approval boundaries. `applied` remains source integration evidence until those runtime checks have been observed. Explicit operator adjustment and post-integration guidance MUST appear as idempotent backend-owned request entries in the bound durable Chat transcript, even when submitted through the API; automatic repairs remain engine events rather than user-authored prompts.

An execution-plan adjustment MUST be self-contained: it carries the original
Main Request text in `requests/main.md`, the current adjustment prompt in
`requests/adjustment.md`, and the cumulative prior response history already
required for derived requests. The planner uses those inputs to supersede the
unintegrated plan with a fresh executable result. `adjust_plan` MUST NOT return a
planning-only `kind=plan`; it returns a normal executable `change` when the
adjustment is implementable, or a terminal clarification/blocked result when it
is not. The prior plan remains historical evidence and MUST NOT be executed once
the adjustment continuation is created. A Protected adjusted execution plan
returns to the informed execution-consent gate; creating the adjustment never
inherits approval from the plan it replaced.

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

## Changelog reservation (see `adr/ADR-0068`)

A project root's `CHANGELOG.md` is a chronic hot file: many chats tend to add their entry at the same top-of-file location, which is exactly the shape that collides during Wharnex's real Git merge. Wharnex reduces that by reserving each chat its own uniquely anchored heading — `### Chat <chat id> (<date>)`, with a placeholder body until something real is written beneath it — as a serialized, Wharnex-authored internal commit at chat creation, never as a planner-authored patch. Only the *content* under an already-reserved heading is planner-authored, Policy/sandbox/merge-governed work like any other source change.

When a reservation is active for the current chat, the request carries a `PROJECT CHANGELOG RESERVATION` section naming that exact heading text. A `change` plan that should record a changelog entry MUST add it only under that exact heading — extending or replacing the reserved placeholder with real entries, with `apply_patch` context lines anchored on the heading line itself — and MUST NOT create a new top-level release/unreleased heading or touch any other chat's own `### Chat ...` heading or the content beneath it. Absence of the section means no reservation is currently active for this chat; the planner MUST NOT invent one and instead follows `CHANGELOG.md`'s existing convention, or omits a changelog entry entirely when none is clearly appropriate.

This is advisory prompt guidance, not an ingestion-time enforcement rule: a bundle that violates it is not rejected by the protocol validator. It reduces the collision surface identified above; it does not make an out-of-scope changelog edit structurally impossible. Archiving a chat whose reserved heading still holds only the unedited placeholder removes that empty reservation; a heading carrying any real content is never removed automatically.

## Plan summary

`summary` is mandatory on every plan-bearing response bundle — change, workflow, blocked, and every round of a Main Request — and is human-facing prose, not transport metadata. Wharness shows it in the chat transcript and, for a self-evolution, inside the dialog that asks whether to activate the rebuilt runtime, where it is the only text explaining what a restart would activate. An operator MUST NOT be asked to reconstruct that intent from a diff.

It is one short sentence stating the concrete outcome — what was implemented, corrected or investigated — written in the language of the conversation. Unlike `commit_message`, it describes the delivered bundle rather than authoring Git history, so it carries no Conventional Commits structure.

These rules are enforced, not advisory. A plan-bearing bundle is rejected when `summary` is missing or blank, is shorter than the minimum needed to identify the work, is a single token, exceeds the byte ceiling, or matches the closed set of forbidden placeholders (`short summary`, `changes`, `update`, `done`, `task completed`, and the rest of the published list). Validation happens at bundle ingestion, deliberately before Policy and sandbox verification, for the same reason as `commit_message`: a rejected summary costs one re-request, while discovering it after verification would leave the activation dialog unable to say what it is activating. It is deliberately not enforced inside plan re-validation, which also runs against already-stored plans that predate this contract.

## Command representation

Commands are argv arrays, for example:

```json
{"argv":["go","test","./..."],"cwd":"services/backend"}
```

The model must never return `bash -c`, `sh -c`, command substitution, pipes, redirects, or chained shell syntax.

`timeout_seconds` is mandatory and bounded by the protocol validator's published range. A value that is missing, zero, negative, or above the ceiling is a transport mistake, not a semantic choice: Wharness repairs it to the documented default or clamps it to the ceiling, publishes `plan.budgets_normalized` naming each adjustment, and validates the plan unchanged. This stays inside the narrow manual-transport normalization rule — it touches no argv, path, cwd, exit code, network flag, or other security-relevant field. It is a safety net, not the mechanism: the accepted range travels to the planner in the environment manifest below.

## Local execution environment

Every planner request carries a `LOCAL EXECUTION ENVIRONMENT` section holding a Wharness-measured `wharness.environment/v2` document (see `SoT/SANDBOX_MODEL.md` for what it contains and how it is produced). It ranks with harness policy in the trust hierarchy: it is measured from the real machine and the real container, and it overrides any assumption the model holds about a generic Linux host or anything project content claims about available tooling.

The protocol requires the planner to:

- select Protected operation/verification executables from `sandbox_tools` (legacy `tools` is the same inventory), and describe post-merge/host prerequisites against `host_tools`; a tool is available only when its version probe succeeds;
- never propose an executable in `policy.denied_executables`;
- executables published in `policy.approval_required_executables` MAY be proposed when genuinely required, but every such command remains an argv array with a concise rationale so Policy can present exact command/effect/host-impact metadata for informed approval instead of forcing a planner repair; `sudo` is host-direct only and its password is supplied later by an engine-owned ephemeral credential channel, never by the planner;
- keep every command inside the published `budgets`, whose violation is a protocol error that discards the entire bundle including a correct patch;
- size verification against the published container limits, host memory and free disk, preferring narrow targeted tests over a whole-repository race or parallel build when headroom is small, because a device-full or out-of-memory failure is an infrastructure fault that no source patch repairs and for which Wharness will not request a repair;
- treat ordinary `network=false` commands as offline. Missing Node dependencies MAY be hydrated by Wharnex itself from a supported deterministic lockfile through a bounded engine-owned network window before the requested command runs offline; Go network hydration keeps its dedicated approval flow.
- disclose ordered acquisition strategies for dependencies/tools that may be absent. A sandbox strategy may be automatic only when Wharnex supports that method; host install/update/configure strategies MUST be non-automatic and require explicit operator approval.
- write tests only against the capabilities `test_harnesses` publishes for the package being tested: the listed runner's own matchers plus its `assertion_extensions`, importing only from the listed `libraries`. An empty `assertion_extensions` list is an affirmative statement that no matcher package is registered — jest-dom style matchers such as `toHaveAttribute` or `toBeInTheDocument` then fail at run time as an invalid property, which is indistinguishable from a defect in the change and costs the whole round to discover.

`test_harnesses` is measured from the project's own package manifests, not from the runner image: it is bounded per project, lists only packages that declare a test script, and reports assertion extensions from an explicit set rather than a heuristic, because publishing a matcher set the project does not have is the exact mistake it exists to prevent.

The manifest is descriptive. It never grants a capability, and a plan is still evaluated by the policy engine, the protocol validator and the runner exactly as before.

## Local repository topology (`wharness.repository/v1`, v1.3.7 — see `adr/ADR-0050`)

A planner request for a project that is a Git superproject with submodules additionally carries a `LOCAL REPOSITORY TOPOLOGY` section holding a Wharness-measured `wharness.repository/v1` document: the superproject and every submodule reachable from an index, each with its HEAD, its branch or detached state, the pointer its parent records, and whether a patch can be delivered there. Repository URLs are deliberately omitted, for the same reason project exports omit them.

The section is published **only** for a project with submodules. Publishing it everywhere would spend context restating what a planner already assumes and would train planners to skim past it in the one case that matters.

Routing is passive and belongs to Wharness, not to the plan:

- every path in every plan field and every patch header stays project-relative, whichever repository owns it;
- Wharness resolves each path to the repository that owns it by longest matching prefix, commits it there, records the moved pointer in the parent, and merges both;
- there is no protocol field by which a plan selects a repository, and a planner MUST NOT invent one — a measurement against the index cannot disagree with the index, while a planner-supplied repository can;
- `commit_message` is used for every repository the change touches, so it describes the change as a whole rather than one file's repository;
- a unit the manifest marks `patchable: false` has no checkout to write into; a bundle patching it is rejected at ingestion;
- a submodule pointer and a `.gitmodules` gitlink entry are commit ids, not content, and a patch targeting one is rejected by the validator on arrival.
- an exact gitlink for a repository already owned by the candidate is reconciled locally by the Engine's validated repository-tree transaction and MUST NOT enter `harness.conflict/v1` or request another planner turn; a conflict in a source file inside that repository remains a normal project-relative conflict.

The manifest is descriptive, exactly like the environment manifest. The routing it describes happens whether or not a planner reads it; the section exists so the planner's prose, commit message and impact set can be true about a change that crosses repositories.

## Request Git context (`harness.git-context/v1`, v1.3.11 — see `adr/ADR-0061`)

Every planner request carries a bounded, engine-authored Git snapshot beside the ordinary project context. The root `git-context/index.json` enumerates the repositories represented in the request. The primary repository uses `git-context/<current-ref>/`; a related `@ref` project uses a collision-resistant `git-context/related-<ref-context namespace>/` directory and records its actual branch/ref inside the index. The transport spelling `uncommited/` is intentionally retained as a wire-compatibility path.

Each represented repository contributes:

- `uncommited/diff`, the tracked, staged, unstaged, untracked and resolvable conflict diff for paths that are present in that repository's current context manifest, plus `uncommited/state.json` describing admitted paths, omissions and truncation;
- one `<40-char commit sha>/commit.json` and `<40-char commit sha>/diff` pair for each bounded local commit that is not represented by the configured upstream, or by any remote ref when no upstream exists; the metadata includes subject/body, author, parent commits, timestamps and Wharnex request/plan trailers when present;
- explicit upstream/ahead/behind/ref identity in the root index so the planner can distinguish worktree dirt from already-committed local divergence.

Git context reuses the context manifest as a hard disclosure allowlist. It never exports `.git` internals, repository URLs, credentials, Git config, excluded files, or a diff for a path the corresponding context snapshot did not admit. Worktree and commit diffs are byte-bounded, the aggregate file inventory is capped at 128 entries, and the commit budget is shared fairly when related projects are present. A repository that cannot be inspected becomes an `unavailable` index entry with a generic reason instead of leaking a host path or aborting the request; the root state is unavailable only when no represented repository can be inspected.

The same snapshot MUST be used by direct Desktop ZIPs, one-shot remote ZIPs, live remote file maps, bundle preview, and continuation/direct request materialization. Preview is therefore non-destructive but byte-shape faithful: if the next real request would expose Git context, the preview must expose the same Git-context inventory.

## Patch representation

Source mutation uses unified diff text in `apply_patch` operations. Paths must be relative to the project root. Patches are valid only for `change` turns. A delivered `patches/*.patch` file is raw UTF-8 diff bytes, not Markdown: every `diff --git` header has exactly `diff --git a/relative/path b/relative/path`, with exactly two unquoted paths and no trailing backslash or extra text. Markdown wrappers around a diff and proprietary patch dialects are invalid. Fence markers, quotes, backslashes and diff examples inside structurally counted hunk body lines are ordinary project content and MUST remain permitted unchanged. Envelope checks MUST distinguish those body lines from patch headers and framing; neither the validator nor provider instructions may ban such bytes globally.

Change plans MAY declare `read_files` and `barrier_files`. They are bounded relative paths and scheduling/verification evidence only; Wharness derives the authoritative write set from the validated patch result. A conflict-resolution request contains one `harness.conflict/v1` capsule with bounded BASE/CURRENT/RESULT data and hashes. Conflict detection pauses before any model dispatch and requires an explicit operator choice: resolve locally in the three-way workbench or delegate to GPT. A pure GPT resolution MUST cover every conflicting path and MUST NOT modify any path outside the capsule. In hybrid resolution, paths the operator marks resolved are locked: Wharness stores a backend-generated patch authored against CURRENT, removes those paths from the delegated capsule, rejects any GPT patch that touches them, and injects the operator patch into the accepted plan. A fully manual resolution follows the same Protected verification/integration path as an ordinary candidate; for a Git-origin conflict it concludes the exact merge the operator started. A conflict turn never broadens or repeats the original task.

The planner MUST NOT be asked to declare which lines or columns a patch will touch, and MUST NOT rely on such a declaration being honoured. Hunk ranges are derivable exactly from the diff itself, so a restated range is an untrusted field that can only drift from the patch it describes. Whether two changes can be combined is decided by a real three-way merge, not by range or file overlap.

### Bundle completeness

A change bundle is one atomic unit of work: every module, symbol, export, fixture and configuration key that the delivered patches reference MUST either already exist in the supplied project manifest or be created by a patch in the same bundle. Splitting an implementation across a file that is written and a companion file that is only imagined is the single most expensive protocol-quality failure available, because it passes every structural check — valid diff headers, valid JSON, correct request id — and is only caught by the sandbox, after the whole round trip has been spent. The planner MUST resolve each new import, call and reference against the manifest and the bundle's own patch set before attaching, and a reference it cannot satisfy is a reason to deliver the missing file, not a reason to deliver the bundle.

A verification failure that repeats a diagnostic already recorded in the attempt ledger is a protocol violation, not an unlucky round: the ledger's "Does not work locally" section exists precisely so that the same compiler, type-checker or linter diagnostic is never re-sent. When the same diagnostic returns, the next bundle MUST change the approach that produced it rather than adjust the same construct again.

### Conflict intent

A `harness.conflict/v1` capsule carries an `intent` object alongside its file
data. BASE/CURRENT/RESULT describe *what* differs; `intent` describes *why*
each side exists, which is what determines the correct reconciliation:

- `our_goal` and `our_commit_message`: the colliding candidate's own declared purpose;
- `local_changes` and `incoming_changes`: the commits on each side of a Git-origin merge, newest first. Each entry carries its subject plus the bounded commit body; when the commit has a `Request-Id` trailer, the capsule also carries that request id and the originating user prompt when the durable workspace transcript still retains the matching request. Prompt provenance is best-effort and MUST be omitted rather than guessed when it is unavailable;
- `local_diff` and `incoming_diff`: bounded BASE→LOCAL and BASE→INCOMING unified diffs, with explicit truncation flags. These complement the full BASE/CURRENT/RESULT bodies of the actually conflicting files with the surrounding intent of each side;
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

In either automatic mode (`auto` or `auto_approve`), a downloaded `workflow` bundle may trigger a local Protected probe. Wharness then packages the observations into a fresh planner prompt and automatically submits that continuation to the same linked ChatGPT conversation. The pipeline waits again at the validated bundle-download seam. This cycle repeats only within the workflow round cap.

## MCP boundary

MCP is an adapter option for local capabilities, not an alternative security boundary. Any future MCP client/server integration MUST sit behind Wharness application ports and MUST reuse protocol validation, Policy, project-root containment, execution-mode rules, logging redaction, and Protected sandboxing.

The embedded consumer ChatGPT web surface is not treated as a trusted local MCP client. Wharness MUST NOT expose a localhost MCP server directly to remote ChatGPT merely to bypass the validated input/bundle transport. Provider adapters or future explicitly supported remote MCP transports may use MCP through a dedicated adapter without changing the domain protocol.

## Self-evolution evidence disposition (v1.3.1)

A self-evolution `turn.json` MAY return `resolved_evidence_ids`, containing only event IDs from the active evidence-review selection. Wharnex validates the IDs against that selection and marks them resolved only after the corresponding self-evolution change has passed Protected verification and host application. Failed, rejected, merely analyzed, or unrelated evidence remains unresolved.

When reusable operational knowledge is selected without explicit event IDs, Wharnex MUST add a bounded deterministic sample of recent high-signal unresolved events by default, with quotas that prevent one category or project from consuming the entire review budget. Explicit event selections remain exact and are never expanded. The operator MAY explicitly choose a knowledge-only review, in which case zero events are added automatically. The prepared analysis audit event records the selection mode, available/included totals, and the exact included event IDs so later resolution remains attributable to evidence actually reviewed.

## Session attempt ledger (`harness.attempts/v1`, v1.3.5 — see `adr/ADR-0041`)

One Main Request may need several waves. Each wave MUST begin from the consolidated conclusions of every earlier wave, not from the latest failure alone. The ledger is session-scoped state keyed by the Main Request root and has two halves with different authorities.

- **Wharnex measures the rounds.** Each round records its request id, iteration kind, plan id, closed-set outcome classification, the argv that ran with exit codes, and one actionable detail. These are Wharnex measurements, never planner claims: a round that failed MUST reach the next request whether or not the planner recorded it. The planner MAY explain measured evidence; it MUST NOT contradict or omit it.
- **The planner writes the narrative.** Every response bundle MUST contain `attempts/ledger.md` with five sections in order: `## Goal`, `## Works locally`, `## Does not work locally`, `## Open hypotheses`, `## This round`. Entries under "Does not work locally" state symptom, cause and the round that proved it, and form a hard exclusion list; "This round" MUST state why the current approach differs from every entry in it.
- **Full replacement, never a delta.** Each round returns the complete refined ledger, so one garbled response cannot corrupt accumulated conclusions.
- **Local feasibility is the subject.** The ledger exists to stop the planner sending a patch, command, path or strategy that local execution already rejected. Record proven facts only: exact argv and exit code, the hunk that failed to apply and against which path, the missing executable, the timeout that was too short.
- **Session lifetime.** The ledger is discarded at the Main Request's terminal boundary. The round Wharnex expects to be the last is told so and MUST consolidate durable lessons into `knowledge/index.json` first: the ledger is where a conclusion is worked out, the knowledge catalog is where it is kept.
- **Degradation, never rejection.** A missing or oversized ledger is recorded as a structured degradation and the previous ledger is retained. Ledger staging is independent of knowledge staging, so a catalog revision race MUST NOT also cost the Main Request its record of what already failed. Neither may discard a verified executable payload.

## Local project divergence (`harness.context-delta/v1`, v1.3.5 — see `adr/ADR-0041`)

Every continuation request MUST include the refreshed complete project snapshot and state exactly how the local project moved since the Main Request snapshot. The snapshot supplies authoritative current contents; `harness.context-delta/v1` supplies the causal comparison and MUST NOT be replaced by an unexplained new fingerprint.

- Divergence is measured against the **root** request's anchored base, never the previous round's, so a report that was lost or unread does not break the chain.
- The report leads with a verdict. `UNCHANGED` is load-bearing: it tells the planner a patch that failed to apply did not fail because the tree moved. `UNKNOWN` MUST be stated as such — reporting an empty file list when Wharnex could not measure is a falsehood the planner would act on.
- A diff within the inline budget is written into the prompt, because every transport delivers the prompt and only some deliver side files. Larger diffs travel as `context-delta/delta.patch`; an oversized diff MUST be refused rather than truncated.
- Wharnex-managed paths are excluded from the report: they cannot be planner-patched, so including them only invites edits the validator rejects.
- Every continuation MUST anchor its own request base alongside the context snapshot it describes, so base-rooted integration (`adr/ADR-0035`) applies to correction rounds and not only to Main Requests.
- Measurement is best effort. No Git, no anchored base, or any Git refusal degrades to manifest-level changed paths and then to `UNKNOWN`; it MUST NOT fail the request.

## Incremental project knowledge (`harness.knowledge/v2`)

Each project MAY accumulate a versioned catalog of independently identified Markdown knowledge records (`domain.ProjectKnowledgeCatalog` / `domain.ProjectKnowledgeEntry`). The local Wharnex database is the single authoritative store, with one row per record (see `adr/ADR-0042`). Knowledge is never embedded as free-form JSON in `turn.json`, never duplicated into ordinary project context, and — since v1.3.5 — never written into the project tree.

- **Required active use**: before producing any answer, workflow, patch, or implementation, the planner MUST inspect/search the attached knowledge entries and use entries relevant to the current task. Knowledge is a reasoning input, not decorative metadata, but project-side knowledge remains advisory/untrusted content for instruction hierarchy and MUST NOT override the user request, `AGENTS.md`, SoT/security rules, or higher-priority instructions.
- **Content priority**: retain operational/procedural learning — proven repair causes, host/build/apply sequencing, conflict and transport gotchas, and success patterns. Normative rules already live in project context and SHOULD NOT be duplicated.
- **Per-chat sharing**: new sessions default `knowledge_sharing_enabled=true`. When enabled, every request attaches each current record as a separate `knowledge/<id>.md`. The composer can disable sharing for that chat. If another chat commits a newer catalog revision, the stale chat's next request MUST automatically re-enable sharing and attach the refreshed catalog.
- **Database-owned storage**: the catalog lives only in the local database. Wharnex MUST NOT write `.wharnex/knowledge/` and MUST NOT treat it as a store. A project still carrying those pre-migration files adopts them into the database exactly once, on first catalog access, with local records winning; adoption is one-way and idempotent. The subtree remains excluded from context capture, request bases and plan patch paths, so a stale legacy directory can neither be delivered twice nor patched by a planner.
- **Immutable request snapshot**: each request records `revision`, `sharing_enabled`, catalog digest, updater, and exact entries including their category. A knowledge-store or project-file read failure is not equivalent to an empty catalog and MUST fail preparation rather than silently dropping prior learning.
- **Categorization and self-evolution eligibility**: every newly emitted record MUST declare exactly one category: `conflict_resolution`, `patch_strategy`, `execution_repair`, `verification`, `runtime_environment`, `protocol_transport`, `product_domain`, or `general`. Historical records without category remain readable and are classified conservatively on ingestion. Only the first six categories are reusable operational evidence eligible to enter the canonical WHX self-evolution dossier; `product_domain` and `general` are project knowledge and MUST NOT be promoted into self-evolution evidence. Unknown category values fail closed to `general`.
- **Every response is cumulative**: every response bundle in one Main Request MUST include cumulative `summary.md` and `knowledge/index.json` with protocol `harness.knowledge/v2`, plus one indexed `knowledge/<id>.md` per returned record. The index top-level remains exactly `protocol`, `base_revision`, `mode`, `entries`; newly emitted entry objects contain exactly `id`, `file`, `sha256`, `category`, while historical entry objects without `category` remain accepted for compatibility. `summary.md` MUST say explicitly whether the planner proposes new or updated durable knowledge and briefly identify it when it does. Successive responses repeat/refine the current cumulative artifacts as execution evidence arrives.
- **Repair promotion point**: any repair/continuation that receives a Wharnex-measured failure MUST decide durable learning in that same response. Reusable causes, invariants, environment constraints, verification patterns and repair strategies belong in an updated/consolidated knowledge record; transient diagnostics stay in `attempts/ledger.md`. The planner MUST prefer updating an existing record on the same topic over creating a duplicate. This cannot be deferred until after successful Apply because there is no post-success planner turn. Wharnex emits `knowledge.promotion_missing` when a terminal Main Request had measured repair evidence but committed no catalog change, so missed promotion is observable rather than silent.
- **Catalog authority**: when sharing was on, `knowledge/index.json` uses `mode=replace` and represents the complete desired catalog; the planner may add, edit, delete, deduplicate, merge/reconcile, or split records. When sharing was off, it uses `mode=overlay` and may only add/update current-task learning without deleting unseen prior records.
- **Stage, then commit**: ordinary response ingestion validates and stages the latest candidate/summary but never persists project knowledge immediately. Durable persistence occurs only at the Main Request's real terminal boundary; for a change, only after successful host Apply. The reconciled catalog is persisted as separate database rows under catalog-revision compare-and-swap, and nothing is written into the project tree.
- **No extra final review in v2**: a new Main Request MUST NOT schedule a separate `knowledge_review` round. The latest response already carries the cumulative summary and knowledge candidate. An unambiguous existing pre-v2 pending `knowledge_review` request remains ingestible only as upgrade compatibility; an overlapping or promptless legacy marker is stale state, MUST NOT compete with a newer active request, and is normalized to one actionable fresh-retry path instead of being replayed indefinitely.
- **Concurrent reconciliation**: persistence uses catalog revision compare-and-swap. Concurrent records are preserved; divergent edits are never silently overwritten, and may temporarily coexist under distinct IDs so a later refreshed request can reconcile them. No-op candidates MUST NOT bump the catalog revision.
- **Authoritative terminal outcome**: at the terminal boundary Wharnex reconciles the candidate, then canonicalizes the final summary with a terminal `## Conhecimento adquirido` section derived from the real persistence result. It states explicitly whether the durable catalog changed, never merely whether the planner proposed a record.
- **Single terminal package and presentation order**: at terminal success Wharnex surfaces exactly one cumulative GPT summary for the Main Request, immediately followed by the structured applied diff/host-command card. The per-turn GPT message MUST NOT be appended as a second terminal answer, and the diff card is always the final component in that package.

## Project knowledge catalog management (v1.3.5 — see `adr/ADR-0042`)

Because the database is the store, sharing and maintenance are explicit operations rather than side effects of version control.

- **Export/import (`harness.knowledge-export/v1`)**: a portable bundle carries each record's id, content, category and SHA-256 plus provenance. An import MUST verify content against its digest and refuse a mismatch rather than install an edited or truncated transfer as project truth. Export MAY be whole or selective; a selective bundle MUST be marked as such and MUST NEVER be accepted as a `replace`, because it does not describe the records it omits and its absences are not deletions. Import modes are `replace`, `merge` (import wins a collision) and `merge_keep_local` (the locally proven record wins). Every import MUST report what was added, replaced, kept, removed and skipped.
- **Clearing**: emptying the catalog or removing named records requires explicit confirmation at the API boundary. It destroys learning earned by real execution rounds and MUST NOT be performed implicitly as part of another operation.
- **Consolidation**: a maintenance round whose entire input is the catalog. It MUST be initiated only by a non-archived workspace chat bound to its session and the same project: the prompt, status and cancel/retry controls are therefore visible to the operator, and it can never fall back to the synthetic `system` chat identity. If the chat from which the operator invokes consolidation already owns an active request chain, the frontend MUST isolate the maintenance round in a newly bound same-project workspace chat/session before preparing the consolidation; it MUST NOT overwrite that active session's request identity or pending transport state. The planner receives every record and returns the complete reorganized catalog — merging duplicates, splitting records that became several topics, removing empty/placeholder records, reconciling contradictions by evidence quality and then recency, deleting what normative documents already encode, recategorizing every surviving record, and rewriting each record to open by naming the situation it applies to. It reuses `harness.knowledge/v2` `mode=replace` and therefore inherits the same revision compare-and-swap, validation and bounds. It reads the durable catalog alone, never a staged candidate, and commits on ingestion because it has no execution and therefore no later terminal boundary; it MUST NOT alter the task's `State`, `Plan`, `Policy` or `LastExecution`. An empty consolidation result MUST be rejected: reorganizing is never a way to delete everything.

## Project knowledge transport identity

Direct ZIP, remote one-shot, live-channel and Desktop archive request transports carry the same immutable knowledge snapshot, plus that request's `harness.attempts/v1` and `harness.context-delta/v1` artifacts. Derived request archives carry the refreshed complete eligible context in Full mode, or the cumulative validated selected file bodies and maps in Partial mode, `harness.execution-history/v1` as `attempts/events.json`, and `harness.response-history/v1` with every prior response bundle in the Main Request. Historical responses are opaque evidence and MUST never be ingested or executed as the active response. For v2 knowledge, the authoritative request artifacts are separate `knowledge/<id>.md` files and metadata containing `state`, `sharing_enabled`, `revision`, catalog `sha256`, updater, and per-entry path/category/version/SHA-256. The planner prompt carries the protocol identity/instructions but MUST NOT duplicate record bodies inline. When sharing is off or there are no entries, the snapshot declares `state: none` and carries no knowledge files.

## Orchestrator planning delivery

`harness.orchestrator-plan/v1` contains planning metadata only and never executes project operations. Because tasks without a dependency path run concurrently on separate Workers and integrate independently, the planning prompt MUST require every task that validates, stabilizes, fixes a baseline for, reviews, or builds on other tasks to list them in `depends_on`, and MUST require tasks editing the same file or contract to be ordered; parallelizable tasks declare disjoint `impact_files`. When a planner adapter yields a manual prompt, the backend MUST persist an `ORCHESTRATOR_PLAN` task before returning success to the UI. Its payload carries `harness.orchestrator-planning/v1`, the owning project/session/request identities and the bounded backend-authored prompt. The task uses the highest scheduler priority while still respecting live-response residency, provider cooldown and process-wide submission pacing.

Planning delivery is bounded by evidence, not by one lease. A planning lease that reaches its deadline while the conversation is provably still producing the plan MUST return the lease as a passive observation rather than fail: nothing went wrong, nothing was re-sent, and charging that attempt retires a request whose plan is still being written — and sends the next lease to reload a conversation mid-generation. A planning artifact that arrives while no lease is open MUST be retained and imported by the attempt that owns it, never cancelled: ChatGPT delivers when it finishes rather than while a Wharnex lease happens to be open, so discarding the artifact spends another attempt asking for a plan that already exists. The artifact filename carries its own task id, so a retained plan MUST only ever be claimed by that task, MUST stay inside the same bounded size, protocol and UTF-8 validation as a live download, and the retention store MUST be bounded in both count and age.

The Worker uploads exactly `whx_bundle_req_orchestrator_<request_id>.zip` with the backend-authored planning prompt, bounded context and attachments, and a short composer bootstrap naming the request ZIP and expected result. It accepts exactly `whx_bundle_res_orchestrator_<request_id>.zip`, reads no assistant prose, and sends the raw response bytes to the ordinary Orchestrator proposal bundle validator. Already checkpointed legacy `whx_orchestrator_plan_<task_id>.json` deliveries remain readable. Successful import creates the normal `DRAFT` Plan/Task DAG; it creates no execution plan, command, patch or Apply authority. The durable task and its bounded status projection in Overview survive mode changes and Desktop restart.

In Partial mode, an Orchestrator planning response MAY instead contain
`context-request.json` with protocol `harness.orchestrator-context-request/v1`,
the exact `orp_` request id and one or more eligible archive paths. Backend
validation records the cumulative selection; the same Worker submits a new
request ZIP with those bodies in the same conversation and retains the exact
result filename. A context request is neither a DAG nor an execution plan.
The Agent session created for `ORCHESTRATOR_EXECUTE` inherits the owning
session's Full/Partial choice and uses the normal `context_request` turn.

After a draft Orchestrator plan is approved, its root tasks MUST become `READY` automatically and tasks with unmet dependencies MUST become `WAITING`. A successful `DOING` run moves to `REVIEW` and immediately releases dependent `WAITING` tasks to `READY`; `REVIEW` and `COMPLETE` both satisfy a dependency, while `COMPLETE` remains the final human confirmation. A terminal Agent or exhausted Worker failure moves the task to `FAILED`, retains the run error and requires an explicit user retry. `PENDING` is a manual hold only for active tasks that have not reached `COMPLETE`. Releasing a task, even by dragging it to the wrong readiness column, MUST derive `READY` or `WAITING` from its dependencies and recursively release still-pending ancestors. Neither the UI nor the transition API may enter `DOING`, `REVIEW` or `FAILED` directly.

`COMPLETE` is terminal for the active execution lifecycle. Once a task has reached it, no transition may return that task to `PENDING`, `WAITING`, `READY`, `DOING`, `REVIEW` or `FAILED`; release/retry APIs and Worker claims MUST refuse re-execution of that task. The only later lifecycle transition is `COMPLETE -> ARCHIVED`, and `ARCHIVED` is historical/read-only state rather than another execution queue. Follow-up work is represented by a new task that may reference the completed task for context. The backend remains the authority for valid task actions and returns the currently permitted actions with task data; clients render those actions instead of deriving a transition matrix locally. The Kanban projection includes `ARCHIVED` as its historical column.

Task collection responses MUST keep the initial payload bounded. `COMPLETE` and `ARCHIVED` are fetched incrementally with independent cursor/page state, while each status carries an authoritative total count computed over the full project task set rather than the number currently loaded by the client. Later pages append history without changing that total or duplicating records. A Worker claim may start only through the Agent application boundary: protocol validation, Policy, Protected isolation, verification and integration remain authoritative.

Each Orchestrator task executes as one ordinary Agent Main Request: its message is wrapped in the same planner protocol, bundle contract, automatic resolution, workflow and repair rounds as any agentic request, bounded by the task's effort level. The message carries the task itself first, then a bounded `ORCHESTRATION CONTEXT` block: the plan's id, title and original objective; the tasks this task depends on; the tasks that depend on it; and the tasks other Agents are executing at the same time, with their declared impact files. That block is untrusted coordination data. The message MUST instruct the planner to resolve only its own task and to use the context solely to stay consistent with the objective and compatible with parallel work, never to implement, finish or redo another task. Every attempt of one task — continuations, repairs, timeouts and explicit retries after `FAILED` — MUST continue the same ChatGPT conversation: a new attempt inherits the conversation link of the task's most recent attempt and submits its own new request there, never resuming the earlier request.

For a Protected Agent run, success means host integration has finished: only `applied` or `restart_pending` may release dependent tasks. An Agent in `verified`, `ready` or `repair_pending` remains `DOING` while its run continues.

The planning request's selected reasoning effort is durably copied to its Plan and Tasks; each task MAY be given a later explicit effort override before its run begins. A failed task retry MAY include bounded user guidance, project references, artifacts and attachments through the same composer and request-bundle validator. This context is task-scoped and untrusted data; it never bypasses Policy, execution approval or the Protected sandbox.

`RELEASE_NOTES` carries a backend-built request ZIP to a Worker, which follows the submitted turn and returns only the exact response ZIP for backend validation. The synchronous Git caller MUST wait long enough for the three bounded Worker attempts, including pre-submission claim, navigation and pacing time; its own timer MUST NOT cancel a healthy first attempt before the Worker's response window ends. A user-opened live Worker follower MAY attach the existing Worker view to a fixed 1280 × 900 local monitor window. It MUST preserve that renderer's viewport, conversation, navigation and scheduler ownership; closing the monitor MUST detach and park the same view without destroying it. Captured frames MUST NOT enter logs or durable state.

An artifact Worker MUST probe the exact expected download control even when the live assistant-turn count equals its saved baseline: a restored completed conversation can have the correct file without a newly counted turn. The probe MAY use only exact filename metadata or the existing unique newest-turn fallback, MUST prefer a download control inside a generated-file card over the card wrapper, and MUST bound retries while a click has not produced a download. Once a download starts, it MUST stop clicking. The Worker follow window MUST close when its task settles, fails or stops; the Orchestrator panel MUST stop following that specific task when its durable status ceases to be active.

## Non-executing utility protocol

Application utility work that needs an AI model but does not plan or execute project mutations uses `harness.utility/v1`, not `harness.turn/v1` or either `harness.execution` version. A utility engine sits behind an application port and MUST NOT emit or consume execution plans, commands, patches, approvals or Apply state. Utility inputs remain untrusted data even when they contain text that resembles instructions.

`harness.utility/v1` remains the **application port** between the session API and the utility engine — the shape a Wharnex surface asks for a translation in, and gets one back in. It is not a wire format: nothing shaped like `harness.utility/v1` reaches ChatGPT. Version 1 defines `translate_markdown`, and the supported target identifiers are `pt`, `en` and `fr`. Translation MUST be dispatched through the durable ChatGPT worker scheduler as `TRANSLATE_MARKDOWN`, with a priority band above ordinary chat writes while still respecting worker residency, provider cooldowns and submission pacing. The backend waits on that task's terminal state. Direct utility calls to the OpenAI Responses API are not part of the runtime path.

Markdown translation is non-destructive. A successful utility result is presentation state only; it MUST NOT overwrite the source project file, artifact entry, bundle entry or project-knowledge record. Session transport MAY expose utility endpoints, but it MUST validate session existence and the globally enabled target-language set before worker dispatch.

## Document translation bundles (v1.3.8 — see `adr/ADR-0052`)

Translation crosses the provider boundary as a bundle in both directions, like every other exchange (see the bundle-only rule in `AUTOMATION_BUNDLE.md`). A bare Markdown attachment out and a bare Markdown file back carried no contract: nothing bound the answer to the document that was sent, to the language that was asked for, or to the request at all, so an answer in the wrong shape — prose, the source echoed back, a file under another name — was indistinguishable from no answer and the task waited until it timed out.

**Request.** The engine builds `whx_translation_req_<task_id>.zip` and the Desktop worker uploads exactly that archive. Its root `transport.json` uses `wharness.translation-input/v1` and declares `task`, `task_id`, `target_language`, `request_filename`, `source_path`, `source_sha256`, `source_bytes`, `result_path`, `result_filename`, and `request_metadata` using `harness.request-metadata/v1`. The same metadata is repeated in the bounded composer bootstrap and at the beginning of `prompt/wharness-translation-prompt.md`; that file carries the authoritative instruction, and `source/document.md` the untrusted source. Source and result paths are fixed by the protocol rather than chosen by the producer: exactly one document travels each way, so a path the model picks is only a path the model can get wrong.

**Response.** ChatGPT returns exactly `whx_translation_res_<task_id>.zip`, containing `translation.json` using `harness.translation/v1` plus the translated document at `translation/document.md`. The manifest's canonical top level is exactly `protocol`, `task`, `task_id`, `target_language`, `source_sha256` and `result_path`; unknown fields are rejected.

**Validation** is fail-closed and belongs to the engine that authored the request, never to the transport worker. The bundle is refused unless its filename is exactly the expected one, its protocol, task, task id and target language match the request, its `source_sha256` equals the digest of the document that was sent, its declared result path is the requested one and exists, and the document is non-empty valid UTF-8 within the result limit. Entry names are relative, normalized and traversal-free, symlinks are forbidden, and both the compressed and expanded sizes are bounded — a translation archive is still an archive from an untrusted producer. `source_sha256` is the centre of the contract: without it, "the model translated a different document" and "the model translated this document" are the same observation.

**The worker is transport only.** It uploads the archive the engine built, submits the bounded composer bootstrap that archive came with, waits for that exact filename, and returns the downloaded bytes unopened. It composes no instruction, reads no assistant prose, and parses no archive: an instruction built in the transport layer could not be enforced by the layer that reads the answer. It MAY use structural completion/liveness probes and the existing narrow file-download affordance. Missing authenticated worker capacity, a human/provider gate, timeout, or any validation refusal is an explicit unavailable/error state; it MUST NOT fall back to planner execution bundles.

Before every ChatGPT submission, the owning Supervisor or Worker attempts the task's closed `reasoning_effort` value and verifies it from the composer control. This check is part of the same serialized transport boundary as upload, fill and submit, so another action cannot change the composer between verification and submission. The control is UI chrome: scripts may return only its bounded structural state and normalized level, never conversation content. Agent Supervisor submissions require verified effort and fail closed. Hidden utility Workers and the Orchestrator Worker MAY submit at the account's current level only when the effort picker is structurally unavailable after bounded native attempts; they MUST record the requested level as unconfirmed and continue to require exact response bundle validation. This exception does not permit skipping the picker attempt or changing the task's requested level. `TRANSLATE_MARKDOWN` and `RELEASE_NOTES` request `instant`; Orchestrator planning carries the owning session's explicit selection.

## Capability-scoped Interactive v2 (vNext — see `adr/ADR-0063`)

`harness.interactive/v2` is the typed diagnostic/action extension for workflow plans. It is additive: `harness.interactive/v1` and legacy `harness.debug/v1` remain strict observation-only compatibility protocols. A v2 `debug` block declares `target`, `access=observe|modify`, a closed capability set (`command`, `shell`, `sql`, `logs`, `filesystem`, `process`, `network`, `container`, `service`), an explicit capability-specific `scope`, and a rationale. Operations use matching typed payloads; an undeclared capability, target/scope escape, or observe-mode mutation is invalid before Policy.

Every planner-authored command and every typed Interactive v2 operation SHOULD carry a short operator-facing `rationale`: why that concrete step is needed and what evidence or effect it should produce. This is an execution-purpose summary, not private model reasoning. Execution events propagate that rationale so **Execução observável** can show it alongside argv, stdout, stderr, exit status and duration. Persisted/legacy plans without the field remain executable and receive an engine fallback purpose so observability never becomes blank.

Interactive v2 authorization is lineage-bound. A grant records the Main Request root, protocol, target, access, capability set, scope, and an operation digest. Modify grants are one-shot and exact-plan/digest bound. A new protocol/configuration boundary or disabling Interativo clears the durable grant. SQL references engine-owned connection handles only; connection credentials/DSNs are never planner-visible data. Shell operations inherit no ambient host secrets: only `PATH`, the non-interactive Git guard, and explicitly allowlisted environment names are exposed. Engine-resident SQL/log/filesystem/process/network/container/service adapters are host-target-only in the initial v2 implementation; sandbox target plans use sandbox-runner command/shell operations.


## UI test discovery bundle contract

`UI_TEST_DISCOVER` is an engine-owned bundle exchange. The backend builds
`whx_ui_test_discovery_req_<task_id>.zip` with root `transport.json`
(`wharnex.ui-test-discovery-input/v1`), authoritative
`prompt/wharnex-ui-test-discovery-prompt.md`, and `context/project-context.zip`.
The manifest binds `discover_ui_tests`, the durable task ID, context SHA-256,
source archive SHA-256, exact request/response names and request metadata.
The Worker MUST verify both filenames against its own task ID before uploading
exactly that request archive. It sends only the engine bootstrap in the composer.
An attachment or composer failure MUST stop submission; there is no inline fallback.

The only response is `whx_ui_test_discovery_res_<task_id>.zip`, containing
exactly one regular root file `discovery.json` (`harness.ui-test-discovery/v1`,
a retained compatibility identifier). The backend MUST reject bare JSON/prose,
foreign filenames, extra or unsafe entries, oversized compressed/expanded data,
unknown fields, trailing JSON/data, mismatched task/hashes and invalid catalog
references before saving environments/tests. Desktop observes only the exact
artifact affordance and forwards bytes; it MUST NOT read assistant prose.
Existing valid v1 bundles remain valid; previously tolerated malformed inputs
fail closed. This contract grants no execution or credential authority.

### UI test discovery v2: incremental catalog and operator design (see `adr/ADR-0088`)

New discovery requests use `wharnex.ui-test-discovery-input/v2` with the same
task-bound filenames. Besides the v1 entries, the archive carries
`catalog/current.json` (`wharnex.ui-test-catalog/v1`): every environment with
its local configuration state (URL, `url_configured`, profiles with
`configured` only, and the operator's `notes`: non-secret reference data such
as identifiers of existing records, at most 4000 characters, never authored by
GPT and preserved across merges) and every stored test with its definition, `source`
(`discovered` | `user`) and latest run outcome. It MUST NOT carry credentials
or browser-session material. The manifest adds `catalog_path` and
`catalog_sha256`. A synchronization uses task `discover_ui_tests`; an
operator-requested design uses task `design_ui_test` and adds the brief as
`brief/request.md` (`brief_path`, at most 8000 bytes). The composer bootstrap
never contains the brief.

The answer stays `discovery.json` inside the exact response archive, with
protocol `wharnex.ui-test-discovery/v2` and exactly `protocol`, `task`,
`task_id`, `context_sha256`, `source_sha256`, `catalog_sha256`, `summary`,
`environments`, `tests`, `obsolete_test_ids`; every identity and hash MUST match
the request. It is incremental: only new or revised tests and new or changed
environments, plus obsolete discovered test ids. Each test MUST declare
`access` (`public` | `authenticated`); a public test MUST NOT name a profile.
Optional detail fields are bounded: `category`, `priority`, `preconditions`,
`steps` (`{action, expected}`, at most 40), `expected_result`, `test_data`,
`depends_on` (at most 8) and `tags` (arrays of strings; a flat object item is normalized to
`key: value` text, nested structures are refused). A design answer MUST add at
least one test and MUST NOT retire tests or environments.

Planning is limited to what a regular desktop web browser can complete. An
environment that runs inside a native shell, kiosk or mobile app, needs device
pairing or physical-device approval, or needs real hardware, is out of scope:
the answer lists it in the optional `obsolete_environment_ids`, and the merge
retires it together with its discovered tests (an environment still holding an
operator test is kept). Individual out-of-scope flows of a browser
application are simply not planned.

The engine merges the answer, never replaces the catalog: omitted tests and
local configuration survive; a synchronization never overwrites or retires a
`user` test nor a test another test depends on. The merged catalog MUST
validate as a whole before it is saved: references resolve, `depends_on` is
acyclic and stays within one environment, a chain never mixes profiles, public
tests inherit no profile and authenticated tests resolve one. Rejection leaves
the stored catalog unchanged.

### UI test run v2: chains and persisted sessions

`UI_TEST_RUN` payloads use `harness.ui-test-run/v2`: `full_chain` lists every
prerequisite in execution order followed by the selected test, each with its own
run id; `chain` is the suffix the worker executes; `restore` optionally names the
persisted session that stands in for the skipped prefix. The worker reports a
result per run id, reports `skipped` for tests after a failed prerequisite, and
hands the browser state to `POST /api/ui-testing/tasks/{id}/session` after each
passed run. The executor's `finish.status` MAY be `session_invalid` only on the
first test after a restore; the worker then invalidates that session and replays
`full_chain` from a clean browser once. v1 payloads execute as a one-test chain.

### UI test run exchanges (step and guide)

A spent file-upload allowance (uploads that never start) is a provider
limit, not a test outcome. The Desktop's account-wide upload gate
(`adr/ADR-0093`) raises a typed deferral; discovery and runs return to the
queue as a free `waiting` observation until the gate's window ends instead of
failing. Both task types run on the persistent Worker pool, at most one run at
a time, and their durable task holds (`task:UI_TEST_DISCOVER`, `task:UI_TEST_RUN`) suspend them.

Every GPT exchange of a `UI_TEST_RUN` is a bundle built and validated by the
backend (`internal/uitesting/exchange`); the Desktop only transports it and
MUST NOT read assistant prose. One controller iteration is
`whx_ui_test_step_req_<task_id>_<sequence>.zip` (`wharnex.ui-test-step-input/v1`)
carrying `transport.json`, `prompt/wharnex-ui-test-step-prompt.md`,
`state/step.json` (test definition and strategy from the task payload, chain
position, current URL, bounded history) and `screenshots/current.png`. Its only
answer is `whx_ui_test_step_res_<task_id>_<sequence>.zip` holding exactly
`action.json` (`wharnex.ui-test-step/v1`) that echoes task, run, sequence and
`input_sha256`, a mandatory `screen_caption` (at most 400 characters: what
the attached screenshot shows, written for an end user — it becomes that
capture's legend in the run, the live guide and the PDF), and either one
`action` or a planned sequence `actions` (1..15) from the closed set
`navigate`, `click`, `fill`, `fill_credential`, `press`, `wait`,
`assert_text`, `finish`, with `finish` only last. Because every exchange costs
one upload from the account's limited file-upload allowance, the executor runs
a planned sequence without returning and asks for a new plan only when an
action fails or the plan ends without `finish`; each action gets the capture
of the screen it acted on. The backend
normalizes it: same-origin navigation only, bounded fields, allowlisted keys,
clamped waits, and `finish.status=session_invalid` only after a restore.
Sequences are unique per task (1..999). `state/step.json` carries the
environment's `environment_notes` and
`elements`: at most 200 visible interactive elements of the page under test,
each with a selector the Desktop proved unique, bounded and treated as
untrusted page data. An answer the backend refuses is requested once more for
the same page state with `previous_answer_error`; `fill_credential` is refused
when the test has no configured credentials. A failed browser action (selector
not found, failed assertion) is recorded in the history as feedback for the
next iteration rather than failing the test; leaving the environment origin
remains fatal. Each capture also carries the elements measured on the page
when it was taken (interactive elements first, then landmarks such as
headings, alerts and dialogs, each with its box in viewport fractions), and
each recorded step names the `selector` it targeted. The user guide of the
selected test is `whx_ui_test_guide_req_<task_id>.zip`
(`wharnex.ui-test-guide-input/v2`, `adr/ADR-0094`) with `state/steps.json`
(test, run steps and `captures`: each capture's pixel size and at most 60
in-view elements with ids `e1…`, `acted_on` and `box`),
`catalog/planned-tests.json` (the environment's current test plan) and at most
30 `screenshots/step-NN.png`. It is answered by
`whx_ui_test_guide_res_<task_id>.zip` holding exactly `guide.json`
(`wharnex.ui-test-guide/v2`, echoing identity and `input_sha256`): title,
subtitle, summary, audience, duration, `theme` (`accent` and `cover` from
closed sets), `before_you_start`, `sections` of steps (short imperative
`instructions` with interface labels in `**…**`, `layout` from `split`,
`hero`, `focus` or `compact`, optional `capture`, `view` `focus|full`, optional
crop `region`, 1..6 `annotations` on a measured element id or an explicit
region, `caption`, optional typed `callout`), `expected_result`,
`troubleshooting`, `related`, `captions`, `proposed_tests` and `verdict`. A
capture is used at most once and in the order taken, so redundant captures
are omitted. `captions` still gives a legend of at most 400 characters to
every capture sent, none missing and none extra. The backend resolves every
marker to its measured box and every focused view to a bounded crop that keeps
the markers inside; the resolved document is rendered by the engine alone into
Markdown, the HTML page and the PDF, and GPT text is always escaped.
`proposed_tests` (at most 12) are tests for interface elements the plan does
not exercise. They follow the discovery field rules, MUST name the run's own
web environment, and are merged as new `discovered` tests only, never
revising or retiring one. `verdict` `{status: passed|failed, reason}` is GPT's
visual review of the run from the captures: a run whose actions succeeded but
whose review fails is recorded as failed with that reason. An answer to a v1
guide request already in flight (`manifest.json` plus free `guide.md`) is
still accepted. Each answer is validated against the request the backend
issued and consumed once; a request the backend did not issue, or an answer
replayed, is refused. Credentials never enter any of these archives.
