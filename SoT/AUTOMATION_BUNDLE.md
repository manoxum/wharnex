# Automation and Execution Bundle SoT

## Automation mode

Wharness has a per-project automation mode independent from the Agent UI mode:

- `manual`: importing a plan/bundle only validates it. The user explicitly runs Protected/Unprotected execution and Protected Apply.
- `auto` (default when a project is opened/restored): valid allowed execution bundles are executed immediately in **Protected** sandbox. Only a successful verified execution may be applied automatically to the host.

Auto may automate two distinct branches:

- `change`: Policy -> Protected sandbox -> verification -> host Apply.
- `workflow`: Policy -> disposable Protected sandbox command probe -> capture observations -> fresh planner continuation. Workflow steps never Apply to host.

Answers, clarifications, investigations, and blocked outcomes are imported into the Harness transcript and never enter execution, even when Auto is active. Supported provider adapters return turn results directly and can advance the same bounded workflow loop without browser downloads.

`auto` MUST NOT coexist with `Unprotected`. Enabling Auto forces/needs Protected; switching to Unprotected disables/requires disabling Auto. Policy validation is never bypassed. Auto is a persistent project state and counts as approval to execute/apply a policy-allowed bundle. Project open/restore initializes that state to Auto only together with Protected execution; denied plans never run.

If automatic change execution fails, the bounded repair loop may prepare and submit a repair request to the same linked ChatGPT conversation. A repaired bundle downloaded while Auto is still enabled repeats the sandbox -> verify -> host-apply cycle. The repair attempt cap remains authoritative.

For iterative investigation, a valid `workflow` bundle is executed only in a disposable Protected sandbox. Its argv/cwd/exit/stdout/stderr results are converted to `LOCAL WORKFLOW OBSERVATIONS`, the current project context is refreshed, and a fresh planner request is submitted to the same linked ChatGPT conversation. The loop accepts at most six workflow rounds for one original user request. Command failures are observations and do not enter the change-repair loop. The sixth continuation MUST terminate as answer, investigation, clarification, change, or blocked.

For the embedded consumer ChatGPT transport, the remote view MUST finish loading and remain network-stable for a bounded interval before Wharness pastes any attachment, whether or not a user prompt already exists. The complete prepared planner prompt MUST be materialized as a private temporary `wharness-planner-prompt.md` file; it is never pasted as ordinary composer text and ChatGPT does not choose its transport representation. Context, user files, and the Markdown prompt are pasted one at a time. Wharness may observe only narrowly scoped request metadata for ChatGPT's `process_upload_stream` endpoint (request identity, owning WebContents, completion status, and network error), never headers or bodies. Every input requires an observed successful upload. A failed or non-started upload is retried with bounded exponential backoff; exhausting the retry cap aborts preparation and MUST NOT submit.

After transport-confirmed uploads, Auto focuses the composer and submits with a layout-independent native `Enter` input after a bounded settle delay. Submission is successful only after the trusted ChatGPT conversation endpoint starts its POST request; absence of that signal triggers bounded focus-and-submit retries, and exhaustion leaves the request unsubmitted. This confirms the upload and submission transports, not the remote DOM or model completion: Wharness never inspects the remote DOM or response content. The remote site does not expose a trusted model-completion signal to Wharness, so the execution pipeline resumes only after a matching bundle download is initiated and intercepted by the existing validated download seam. Fully deterministic unattended planning uses the supported provider adapter instead of consumer-web automation.

## Execution bundle transport

Primary manual Desktop delivery is:

`wharness-bundle-<request_id>.zip`

The planner prompt MUST state the exact canonical filename, require the generated file basename/attachment metadata to use it, prohibit icon-only/prose-only substitutes, require the ZIP root layout, and require the model to self-check the archive before attaching it. The Desktop records the expected request id when a draft is submitted. Automatic download activation first matches canonical filename metadata, including non-visible link attributes. If ChatGPT renders the generated result without exposing that filename, Desktop MAY activate a fallback only when the newest assistant turn contains exactly one visible enabled file/download affordance; zero or multiple candidates fail closed. This narrow fallback identifies only the download control, never reads response prose to infer completion. If ChatGPT nevertheless downloads a generic ZIP name while exactly that request is pending in the active chat, the Desktop MAY rename the transport file to the canonical filename before backend submission. A different valid Wharness request id is never rewritten, and normal bundle/request validation remains authoritative.

Every new bundle contains `turn.json` using `harness.turn/v1` plus a non-empty `README.md`. `answer`, `clarification`, `investigation`, and `blocked` omit `plan.json` and patches. `workflow` and `change` contain `plan.json`; only `change` may contain patches. Legacy bundles without `turn.json` remain compatible and are interpreted as `change`.

Required entries for `workflow`:

- `plan.json`: `harness.execution/v1` with `status=ready`, `risk=low|medium`, `requires_approval=false`, 1..16 command-only operations, and `network=false` for every operation/verification command.
- `README.md`: human explanation of the evidence requested.
- `patches/` MUST NOT exist.

Required entries for `change`:

- `plan.json`: `harness.execution/v1` metadata. `apply_patch` operations SHOULD use `patch_file` instead of embedding a diff string.
- `README.md`: human explanation of the user problem, solution, affected files, operations, verification, risks, and expected result.
- `patches/*.patch`: raw UTF-8 standard unified diffs referenced by `patch_file`.

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
- a patch operation cannot specify both non-empty inline `patch` and `patch_file`;
- the resolved execution plan still passes the normal protocol validator and Policy Engine.

Clipboard/raw JSON remains a legacy fallback only.

### Narrow consumer-web bundle normalization

Before executable validation, the parser MAY normalize only transport/layout mistakes that do not invent execution semantics: remove one common top-level wrapper directory, synthesize missing README documentation from an already valid structured turn/plan message, and canonicalize a root-level `.patch` referenced by an otherwise safe patch basename to `patches/<name>.patch`. Missing `plan.json`, missing executable patches, request-id mismatches, unsafe paths, malformed JSON, or policy violations remain hard failures.

## Host execution observability and regression (v1.2.31)

Protected host Apply MUST emit execution lifecycle events before and after each patch replay, including a stable run id, target and touched paths; elapsed duration is emitted when the runner reports it. The same rule applies to reverse patch replay. Self-evolution build phases remain explicit host events. Renderer timelines correlate these events instead of inventing execution state from transcript prose.

A user-requested regression is allowed only for the current successfully executed/applied Protected plan and only when deterministic patch reversal is available. Wharness validates patch paths again, performs `git apply --reverse --check` before mutation, reverses multiple patches from last to first, and attempts to restore already-reversed patches if a later reverse step fails. Plans containing host-replayed Git mutation commands are not presented as deterministically reversible. A pending self-evolution transaction uses its transaction rollback rather than ad-hoc source replay.

Task comments sent to the active consumer-Web ChatGPT conversation are serialized per conversation. A queue item cannot be flushed concurrently by the immediate submit path and periodic retry loop. The main process retains bounded recent comment identifiers plus a short semantic fingerprint window to collapse accidental duplicate dispatches while preserving the ability to intentionally repeat guidance later. A duplicate comment never creates a new planner request or changes the canonical request id.
