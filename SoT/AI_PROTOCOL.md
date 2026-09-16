# AI Protocol SoT

## Protocol identifiers

- `harness.request-metadata/v1`: engine-authored identity repeated in every provider request bundle and its bounded composer bootstrap: `chat_title`, local `chat_id`, context/chat `chat_hash`, and `requested_at`.
- `harness.turn/v1`: classifies one conversational agent outcome.
- `harness.execution/v1`: legacy executable work accepted only for persisted/in-flight compatibility; new planner/provider output does not target it.
- `harness.execution/v2`: describes new executable work for a `workflow` or `change` turn and carries the informed execution contract.
- `harness.debug/v1`: a diagnostic extension carried only by a `workflow` execution plan; it selects a bounded `sandbox` or read-only allowlisted `host` probe and states its rationale.
- `wharness.translation-input/v1`: the request bundle Wharnex uploads for one document translation.
- `harness.translation/v1`: the response bundle ChatGPT returns for that request.
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

Attached material is **read-only by construction**. It is placed under its own `ATTACHMENTS/<slot>-<name>/` namespace in the context, never inside the primary tree, and it MUST NOT appear in any operation, `impact_files` entry, or `cross_project` entry. It has no root a patch could be applied against, and the prompt MUST say so alongside the listing.

Wharnex MUST refuse to read a root where an explicit operator gesture is not sufficient justification: system and kernel surfaces, credential stores, and the bare home and filesystem roots whose whole subtree is everything. One typo in a composer must not be able to put an SSH key into a prompt. Beyond that boundary, an attachment is selected by exactly the engine the project's own context configuration uses — mandatory security exclusions, automatic pruning, the include whitelist, the exclude list, the secret-content scan and the binary detector — so there is one predicate rather than two that can drift.

A directory attachment carries its selection **inside its own marker**, as `|+<include>` and `|-<exclude>` tokens plus an optional `|!auto` opting out of automatic pruning. The selection travels with the prompt text so that what is stored, re-read on a continuation and shown in a transcript is exactly what was sent; a selection kept beside the text is a selection that can disagree with it. Patterns are bounded in count, use the same `*`/`?`/`**` vocabulary as the project configuration, and may not climb out of the attached root.

Every attachment is bounded in file size, total bytes and file count. Hitting a bound MUST be reported as truncation in the prompt rather than silently sending less than the operator asked for, and a refused or unreadable attachment MUST be named as absent rather than degrading to silence.

## Cross-project requests (v1.3.8 — see `adr/ADR-0053`)

`@ref:<project>` in a Main Request's own prompt is also the only way that request acquires authority to change that project. The grant is derived from the operator's own text before the planner is asked, recorded durably against the root request, and inherited unchanged by every continuation — a later round MUST NOT be able to widen it by naming a new project in a bundle.

Referring and changing are separate authorities, and they resolve against different sets. A name resolves against **every project Wharnex has worked on before**, open or closed, folding case and accepting either the context namespace name or the project directory's basename; where a name could mean two projects, one already attached to the session wins it. A resolved project whose context is not yet in the snapshot MUST have it brought in, because a reference the model cannot see is not a reference. An unresolved name MUST be reported to the planner rather than silently dropped.

A **change**, by contrast, requires that project to have a live session, because that session is what carries the Protected/Unprotected and Auto/manual modes deciding how a change reaches that host. A project that is closed has chosen nothing, and the defaults a fresh session would receive are not the operator's decision to inherit on their behalf. The prompt MUST therefore name which granted projects a change cannot currently reach, so the planner spends its effort where it can land instead of returning an entry ingestion is bound to refuse.

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

Questions and advice requests SHOULD terminate as `answer` when the attached context is sufficient. Diagnostic/audit requests SHOULD terminate as `investigation` when evidence is sufficient. An explicit request to devise, elaborate, propose, draft, present, or structure an implementation plan MUST terminate as `plan` even when the composer is in Direct mode. The UI toggle is a convenience hint, not the only way to select planning-only behavior. Project context, Agent mode, or Auto mode MUST NOT by themselves upgrade ASK/INVESTIGATE intent into CHANGE. Ambiguous mutation intent defaults to non-mutation or clarification.

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

The workflow is bounded to six local rounds per original user turn. The final continuation explicitly requires a terminal result. An additional `workflow` bundle after the cap MUST be rejected while leaving the current request pending so a terminal bundle can still be supplied.

Command failure in a workflow is evidence, not an automatic repair trigger. Automatic repair remains specific to a requested `change` plan.

### Debug workflow

A planner MAY attach `debug: {protocol:"harness.debug/v1", target:"sandbox|host", rationale:"…"}` to a `workflow` plan when refreshed local evidence is necessary. Debug never changes the meaning of `workflow`: operations remain argv arrays, patches and network are forbidden, output is untrusted evidence, and the six-round cap applies. A sandbox target uses the isolated copied workspace. A host target is additionally restricted to the Engine's closed read-only diagnostic vocabulary; generic file readers, shells, package mutation, Git mutation, Docker and privilege tools are forbidden.

For aggregate machine-local execution evidence, Debug MAY additionally carry `query:"project_execution_summary"` with `target:"host"`. The Engine resolves that exact name internally from persisted events belonging to the current project and returns bounded counts for sessions, successful/failed executions, Host Apply, pending activation and failure kinds. It exposes no event bodies, command output, credentials, arbitrary SQL or caller-selected paths. This named query may be the only observation in a workflow plan; unknown query names and sandbox targeting are rejected.

Debug mode is an operator-selected composer capability. With it enabled, valid debug rounds may run automatically. With it disabled, the first debug plan for each Main Request root waits for one explicit authorization and descendants of that same root inherit it. That authorization does not approve network, project mutation, package/dependency mutation, system-tool changes, Apply, or Unprotected execution.

### Effort level and autonomous iteration budget
Every Main Request carries one user-selected `effort_level`: `low`, `medium`, `high`, `extra_high`, `max`, `ultra`, or `loop`. The level is a hard ceiling for autonomous AI resolution attempts across the request chain, including the initial attempt and subsequent automatic repair/conflict rounds: Low=1, Medium=3, High=6, Extra High=10, Max=15, Ultra=30, while Loop has no numeric ceiling. Manual operator-triggered repair is outside this automatic budget. The selected value MUST be included in planner/provider prompts so the model can optimize cost/benefit inside the available budget rather than blindly consuming it.

`reasoning_effort` is a separate per-chat provider-depth choice: `instant`, `medium`, or `high`. It MUST NOT change, consume, or be inferred from `effort_level`. Every provider prompt for that chat, including orchestration and continuation prompts, carries the selected value. The OpenAI Responses adapter maps it to a capability supported by the configured model (`instant` maps to that model's lowest supported reasoning mode); the ChatGPT browser adapter MUST structurally observe and, when necessary, set the composer control before submission, then verify the resulting state. A missing, ambiguous, or unverified control fails closed before the prompt is sent. Translation utility work always uses `instant`, independently of the originating chat.

`extra_high`, `max`, `ultra`, and `loop` also enable continuous improvement after a successful host integration. Each post-success round consumes the same automatic-attempt budget and MUST stay scoped to the original user goal. The planner MUST stop with a terminal `answer` and no change plan when no material, safe, cost-effective improvement remains or no safe automated solution exists. Loop therefore means unbounded opportunity to iterate, not permission for an infinite busy-loop or cosmetic churn.

## AI output rule

The provider returns a structured agent turn. `workflow` and `change` carry a structured JSON `ExecutionPlan`; `plan` is an approval proposal in `turn.message` and carries no execution plan or patches; all remaining kinds also carry no plan. Markdown command extraction and regex-based shell scraping are forbidden.

Every newly requested `harness.execution/v2` `change` plan MUST be an informed execution contract: `document` contains the complete Markdown implementation plan, `dependencies` lists every install/update/remove by service/scope and package manager, and `system_tools` lists every sandbox/host tool to use/install/update/configure. Empty lists are explicit when there is no such impact. The exact `operations` patches and commands remain authoritative and must be sufficient for the Plan surface to display every create/modify/delete diff without deriving executable work from prose.

The planning-only **Plano do Chat** and the later **Plano de execução** are distinct. The former is the proposal the model intends to follow and carries no executable payload. The latter is produced only after the remote implementation work and is the complete local contract containing every resulting operation, dependency/tool impact, verification and exact diff. Approving a Plano do Chat records its exact Markdown and SHA-256. Its linked implementation bundle MUST carry that proposal unchanged as `approved_chat_plan`; Wharnex verifies the parent request, digest and bytes before Policy. That one approval authorizes the bound implementation, Protected sandbox verification and, in Auto, the explicit post-verification host Apply. It does not authorize an altered/missing binding, another Main Request, Unprotected execution, or any undeclared scope. An ordinary Direct change instead receives its one informed approval from the complete Plano de execução; after successful sandbox verification, Protected Auto performs Apply without a second prompt.

When a Desktop window binds several projects, the request context MAY carry `harness.related-projects/v1`: the primary project remains at the context root and each companion snapshot is placed below its declared `RELATED_PROJECTS/<slot>-<name>/` namespace. The combined transport identity covers every snapshot, but `ExecutionPlan.base_context_sha256`, all relative paths and every operation in `operations` continue to target exactly the primary project. Cross-project analysis is always allowed. Mutating a companion project is allowed only through `cross_project` and only for a project this request's own prompt granted with `@ref:` (see "Cross-project requests" above); it still runs as a separate plan against that project's own Session, preserving independent Policy, Protected sandbox, verification and Apply decisions. A companion project that was not granted remains reference material only.

Every new `harness.turn/v1` result MUST include a concise `chat_title` plus an `outcome` object with `status=completed|failed|partial`, `retryable`, an optional stable `reason_code`, and a bounded explanatory `message`. `chat_title` names the semantic Main Request (not ZIP/bundle transport), is limited to 82 characters, carries no `WHX:` prefix, and stays stable across continuation rounds; Wharnex uses it as the definitive local title and queues the linked ChatGPT conversation rename after accepting the result. This status reports whether the planner actually completed the requested response; it never claims that Wharness executed, verified, or applied host changes. Only `completed` may carry an execution plan. `failed` and `partial` are terminal protocol results: Wharness stores the turn/bundle, removes it from the pending set, marks the request failed, exposes the reason to the transcript, and MUST NOT send any plan to Policy or execution. Legacy plan-only bundles may synthesize `outcome.status=completed`; a new explicit `turn.json` without `outcome` is invalid.

The recovery surface for a non-completed outcome MUST preserve the original goal and offer a new request path. The user can edit the recovery prompt, add context/files, enable another configured transport, or repeat the request. In Auto, a `retryable=true` terminal outcome MAY prepare exactly one bounded fresh-request recovery automatically. A retry is a new correlated request and never silently reclassifies the failed result as successful. Every failure-driven continuation MUST carry the concrete previous failure reason as authoritative evidence and preserve request lineage so the next planner turn can distinguish a correction from a new task.

`retryable=true` is reserved for conditions where a new request can materially change the available evidence, strategy, or transient capability. A structural repository boundary, policy/infrastructure condition, unsupported project root, or other blocker that requires an operator action outside the current planner turn MUST return `retryable=false`.

`retryable=false` MUST be honoured by every retry path, manual as well as automatic. `reason_code` is matched against a hand-reviewed closed infrastructure allowlist, while an otherwise-unclassified non-retryable result receives Wharnex's own `planner_guidance_required` failure kind; `retryable` is a required boolean the planner is instructed to set accurately, and it therefore remains authoritative without depending on a growing reason-code vocabulary. A bare manual retry of a `retryable=false` outcome MUST be refused, naming the planner's own reason, because it asks the planner to solve a condition it has already declared unsolvable and is answered identically every round. Explicit operator guidance is the deliberate escape: supplying it is the operator stating that something outside the planner's view has changed. Because that refusal is certain, the recovery surface MUST NOT offer a bare retry for such an outcome at all: it withdraws every no-guidance resume action, labels the state as requiring new evidence, and validates a non-empty bounded evidence/guidance field before the request is sent, so the operator is never handed an action whose only possible answer is the refusal. When the missing evidence may contain multi-line diagnostics, the input MUST preserve those lines. When a continuation receives failure evidence, the planner MUST NOT repeat a semantically equivalent plan, blocked target/root, command strategy, or merely restate the same blocker as another retry. It must either choose a materially different approach that addresses the named root cause, or terminate as `blocked` with `retryable=false` and the concrete operator action required.

Every request iteration records its immutable `request_id`, `root_request_id`, optional parent, and classification (`standard`, `plan_approval`, `plan_correction`, `repair`, `improvement`, `evidence`, or `conflict`). A retained candidate that fails to replay/merge cleanly against the current host on planner-patchable paths — whether a ChangeSet replay conflict or a real Git merge conflict on its integration branch — MUST enter the dedicated `harness.conflict/v1` path before generic repair is considered; generating another ordinary repair while the predecessor still fails replay is prohibited. Git conflicts confined to Wharnex-managed `.wharnex/knowledge/**` are local integration drift, not a model task: preserve the current host version and do not spend a planner round on them. Cancelling an active request terminates its pending transport/planner iterations and releases the conversation for a new Main Request. It preserves transcript, evidence, artifacts, and any independently verified Protected candidate; rejecting that candidate remains a separate explicit action.

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

Every planner request carries a `LOCAL EXECUTION ENVIRONMENT` section holding a Wharness-measured `wharness.environment/v1` document (see `SoT/SANDBOX_MODEL.md` for what it contains and how it is produced). It ranks with harness policy in the trust hierarchy: it is measured from the real machine and the real container, and it overrides any assumption the model holds about a generic Linux host or anything project content claims about available tooling.

The protocol requires the planner to:

- select every operation and verification executable from the published `tools` inventory — an executable absent from it is not installed, and proposing it fails the command with exit code 127;
- never propose an executable in `policy.denied_executables`;
- keep every command inside the published `budgets`, whose violation is a protocol error that discards the entire bundle including a correct patch;
- size verification against the published container limits, host memory and free disk, preferring narrow targeted tests over a whole-repository race or parallel build when headroom is small, because a device-full or out-of-memory failure is an infrastructure fault that no source patch repairs and for which Wharness will not request a repair;
- treat `network=false` as implying `GOPROXY=off` against a Wharness-owned module cache, so dependencies that are neither vendored nor cached are unavailable and a package-manager install is not a valid workaround.
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

## Patch representation

Source mutation uses unified diff text in `apply_patch` operations. Paths must be relative to the project root. Patches are valid only for `change` turns. A delivered `patches/*.patch` file is raw UTF-8 diff bytes, not Markdown: every `diff --git` header has exactly `diff --git a/relative/path b/relative/path`, with exactly two unquoted paths and no trailing backslash or extra text. Markdown fences and proprietary patch dialects are invalid.

Change plans MAY declare `read_files` and `barrier_files`. They are bounded relative paths and scheduling/verification evidence only; Wharness derives the authoritative write set from the validated patch result. A conflict-resolution request contains one `harness.conflict/v1` capsule with bounded BASE/CURRENT/RESULT data and hashes. Conflict detection pauses before any model dispatch and requires an explicit operator choice: resolve locally in the three-way workbench or delegate to GPT. A pure GPT resolution MUST cover every conflicting path and MUST NOT modify any path outside the capsule. In hybrid resolution, paths the operator marks resolved are locked: Wharness stores a backend-generated patch authored against CURRENT, removes those paths from the delegated capsule, rejects any GPT patch that touches them, and injects the operator patch into the accepted plan. A fully manual resolution follows the same protected verification/apply path as an ordinary candidate; for a Git-origin conflict it concludes the exact merge the operator started. A conflict turn never broadens or repeats the original task.

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

In Auto mode, a downloaded `workflow` bundle may trigger a local Protected probe. Wharness then packages the observations into a fresh planner prompt and automatically submits that continuation to the same linked ChatGPT conversation. The pipeline waits again at the validated bundle-download seam. This cycle repeats only within the workflow round cap.

## MCP boundary

MCP is an adapter option for local capabilities, not an alternative security boundary. Any future MCP client/server integration MUST sit behind Wharness application ports and MUST reuse protocol validation, Policy, project-root containment, execution-mode rules, logging redaction, and Protected sandboxing.

The embedded consumer ChatGPT web surface is not treated as a trusted local MCP client. Wharness MUST NOT expose a localhost MCP server directly to remote ChatGPT merely to bypass the validated input/bundle transport. Provider adapters or future explicitly supported remote MCP transports may use MCP through a dedicated adapter without changing the domain protocol.

## Self-evolution evidence disposition (v1.3.1)

A self-evolution `turn.json` MAY return `resolved_evidence_ids`, containing only event IDs from the active, explicit evidence-review selection. Wharnex validates the IDs against that selection and marks them resolved only after the corresponding self-evolution change has passed Protected verification and host application. Failed, rejected, merely analyzed, or unrelated evidence remains unresolved.

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
- **Immutable request snapshot**: each request records `revision`, `sharing_enabled`, catalog digest, updater, and exact entries. A knowledge-store or project-file read failure is not equivalent to an empty catalog and MUST fail preparation rather than silently dropping prior learning.
- **Every response is cumulative**: every response bundle in one Main Request MUST include cumulative `summary.md` and `knowledge/index.json` with protocol `harness.knowledge/v2`, plus one indexed `knowledge/<id>.md` per returned record. `summary.md` MUST say explicitly whether the planner proposes new or updated durable knowledge and briefly identify it when it does. Successive responses repeat/refine the current cumulative artifacts as execution evidence arrives.
- **Repair promotion point**: any repair/continuation that receives a Wharnex-measured failure MUST decide durable learning in that same response. Reusable causes, invariants, environment constraints, verification patterns and repair strategies belong in an updated/consolidated knowledge record; transient diagnostics stay in `attempts/ledger.md`. The planner MUST prefer updating an existing record on the same topic over creating a duplicate. This cannot be deferred until after successful Apply because there is no post-success planner turn. Wharnex emits `knowledge.promotion_missing` when a terminal Main Request had measured repair evidence but committed no catalog change, so missed promotion is observable rather than silent.
- **Catalog authority**: when sharing was on, `knowledge/index.json` uses `mode=replace` and represents the complete desired catalog; the planner may add, edit, delete, deduplicate, merge/reconcile, or split records. When sharing was off, it uses `mode=overlay` and may only add/update current-task learning without deleting unseen prior records.
- **Stage, then commit**: ordinary response ingestion validates and stages the latest candidate/summary but never persists project knowledge immediately. Durable persistence occurs only at the Main Request's real terminal boundary; for a change, only after successful host Apply. The reconciled catalog is persisted as separate database rows under catalog-revision compare-and-swap, and nothing is written into the project tree.
- **No extra final review in v2**: a new Main Request MUST NOT schedule a separate `knowledge_review` round. The latest response already carries the cumulative summary and knowledge candidate. An unambiguous existing pre-v2 pending `knowledge_review` request remains ingestible only as upgrade compatibility; an overlapping or promptless legacy marker is stale state, MUST NOT compete with a newer active request, and is normalized to one actionable fresh-retry path instead of being replayed indefinitely.
- **Concurrent reconciliation**: persistence uses catalog revision compare-and-swap. Concurrent records are preserved; divergent edits are never silently overwritten, and may temporarily coexist under distinct IDs so a later refreshed request can reconcile them. No-op candidates MUST NOT bump the catalog revision.
- **Authoritative terminal outcome**: at the terminal boundary Wharnex reconciles the candidate, then canonicalizes the final summary with a terminal `## Conhecimento adquirido` section derived from the real persistence result. It states explicitly whether the durable catalog changed, never merely whether the planner proposed a record.
- **Single terminal package and presentation order**: at terminal success Wharnex surfaces exactly one cumulative GPT summary for the Main Request, immediately followed by the structured applied diff/host-command card. The per-turn GPT message MUST NOT be appended as a second terminal answer, and the diff card is always the final component in that package.

## Project knowledge catalog management (v1.3.5 — see `adr/ADR-0042`)

Because the database is the store, sharing and maintenance are explicit operations rather than side effects of version control.

- **Export/import (`harness.knowledge-export/v1`)**: a portable bundle carries each record's id, content and SHA-256 plus provenance. An import MUST verify content against its digest and refuse a mismatch rather than install an edited or truncated transfer as project truth. Export MAY be whole or selective; a selective bundle MUST be marked as such and MUST NEVER be accepted as a `replace`, because it does not describe the records it omits and its absences are not deletions. Import modes are `replace`, `merge` (import wins a collision) and `merge_keep_local` (the locally proven record wins). Every import MUST report what was added, replaced, kept, removed and skipped.
- **Clearing**: emptying the catalog or removing named records requires explicit confirmation at the API boundary. It destroys learning earned by real execution rounds and MUST NOT be performed implicitly as part of another operation.
- **Consolidation**: a maintenance round whose entire input is the catalog. The planner receives every record and returns the complete reorganized catalog — merging duplicates, splitting records that became several topics, deleting what normative documents already encode, and rewriting each record to open by naming the situation it applies to. It reuses `harness.knowledge/v2` `mode=replace` and therefore inherits the same revision compare-and-swap, validation and bounds. It reads the durable catalog alone, never a staged candidate, and commits on ingestion because it has no execution and therefore no later terminal boundary; it MUST NOT alter the task's `State`, `Plan`, `Policy` or `LastExecution`. An empty consolidation result MUST be rejected: reorganizing is never a way to delete everything.

## Project knowledge transport identity

Direct ZIP, remote one-shot, live-channel and Desktop archive request transports carry the same immutable knowledge snapshot, plus that request's `harness.attempts/v1` and `harness.context-delta/v1` artifacts. Derived request archives also carry the refreshed full context, `harness.execution-history/v1` as `attempts/events.json`, and `harness.response-history/v1` with every prior response bundle in the Main Request. Historical responses are opaque evidence and MUST never be ingested or executed as the active response. For v2 knowledge, the authoritative request artifacts are separate `knowledge/<id>.md` files and metadata containing `state`, `sharing_enabled`, `revision`, catalog `sha256`, updater, and per-entry path/version/SHA-256. The planner prompt carries the protocol identity/instructions but MUST NOT duplicate record bodies inline. When sharing is off or there are no entries, the snapshot declares `state: none` and carries no knowledge files.

## Orchestrator planning delivery

`harness.orchestrator-plan/v1` contains planning metadata only and never executes project operations. When a planner adapter yields a manual prompt, the backend MUST persist an `ORCHESTRATOR_PLAN` task before returning success to the UI. Its payload carries `harness.orchestrator-planning/v1`, the owning project/session/request identities and the bounded backend-authored prompt. The task uses the highest scheduler priority while still respecting live-response residency, provider cooldown and process-wide submission pacing.

Planning delivery is bounded by evidence, not by one lease. A planning lease that reaches its deadline while the conversation is provably still producing the plan MUST return the lease as a passive observation rather than fail: nothing went wrong, nothing was re-sent, and charging that attempt retires a request whose plan is still being written — and sends the next lease to reload a conversation mid-generation. A planning artifact that arrives while no lease is open MUST be retained and imported by the attempt that owns it, never cancelled: ChatGPT delivers when it finishes rather than while a Wharnex lease happens to be open, so discarding the artifact spends another attempt asking for a plan that already exists. The artifact filename carries its own task id, so a retained plan MUST only ever be claimed by that task, MUST stay inside the same bounded size, protocol and UTF-8 validation as a live download, and the retention store MUST be bounded in both count and age.

The Worker requests exactly `whx_orchestrator_plan_<task_id>.json`, reads no assistant prose, rejects invalid UTF-8/JSON or mismatched protocol data, and imports the result only through the ordinary Orchestrator proposal validator. Successful import creates the normal `DRAFT` Plan/Task DAG; it creates no execution plan, command, patch or Apply authority. The durable task and its bounded status projection in Overview survive mode changes and Desktop restart.

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

Before every ChatGPT submission, the owning Supervisor or Worker enforces the task's closed `reasoning_effort` value and verifies it from the composer control. This check is part of the same serialized transport boundary as upload, fill and submit, so another action cannot change the composer between verification and submission. The control is UI chrome: scripts may return only its bounded structural state and normalized level, never conversation content. `TRANSLATE_MARKDOWN` tasks always carry and enforce `instant`; ordinary Agent and Orchestrator tasks carry the owning chat's explicit selection.
