# Execution Model SoT

## Informed consent and diagnostic execution (v1.3.11 — see `adr/ADR-0057`)

The first enriched change plan of a Protected Main Request pauses before execution and exposes its complete contract: Markdown plan, dependency inventory, sandbox/host system-tool inventory, exact patches/commands, verification and Policy decision. Accepting it authorizes sandbox execution, post-verification host integration, and compatible correction waves in that request lineage; any later network/package/Git or host-tool impact is a new Policy approval boundary. When a later boundary requires another decision, that decision likewise covers both the resulting Protected execution and its host integration. Rejecting it records the decision and performs no command. Unprotected execution remains a distinct host-direct mode with confirmation for each execution.

A `harness.interactive/v1` workflow is never an Apply candidate or patch carrier. It may gather evidence in the copied sandbox or through the closed read-only host diagnostic allowlist with `network=false`; Interativo enabled is a standing observe grant, while Interativo disabled requires one grant per Main Request root. Legacy `harness.debug/v1 access=observe` remains readable. `access=modify` is retired and rejected. Shells, inline programs, privilege escalation, Docker/host-service control, external access, package/tool installation, destructive operations and Apply remain outside Agent interactive authority.

Wharness supports a per-project execution mode selected in the workspace UI.

## Protected (default)

1. Plans are validated structurally.
2. Policy evaluates each operation.
3. Denied plans never execute.
4. Approved plans execute against an isolated copy.
5. Patches are applied in the sandbox first.
6. Commands/verification run with declared cwd, timeout, network policy, and expected exit codes.
7. After successful sandbox verification, Wharnex automatically starts host integration under the same informed execution decision. Host integration is an engine phase/API, not a second user approval.
8. Host integration re-validates patch paths and re-checks patch applicability before mutation.
9. If host integration cannot complete safely, the verified plan remains a host-pending recovery candidate independent from the next planner turn. A later Protected plan MAY extend that candidate: Wharness replays every earlier pending patch in order in a fresh isolated copy, then applies and verifies the new plan against the cumulative candidate state.
10. The informed execution decision covers the complete ordered candidate produced by that approved boundary. If a later patch fails during host integration, Wharness reverses patches already applied by that attempt before returning the error; the verified candidate remains pending for correction or an explicit integration retry. That retry is recovery of already-authorized work, not a new Apply approval.
11. Reject discards the complete host-pending candidate and resets its execution state without mutating the host. It is distinct from Revert, which acts only after a successful host application.
12. A successful Revert retains the exact applied patch batch as the session's reversible redo candidate instead of discarding it. The user MAY explicitly **Restore** that latest reverted batch; Wharnex forward-replays the retained patches in original order and, if any patch fails, reverses every patch already replayed by that restore attempt before leaving the host.
13. A deterministic Restore that cannot be completed safely MUST create a fresh planner continuation from the current project snapshot rather than retry the stale pre-revert baseline. That continuation uses request-lineage kind `revert_restore`, carries the intended reverted patch batch as reconciliation evidence, preserves unrelated current work, and follows the normal Protected verification/Apply pipeline before changing the host again. Self-evolution restoration always takes this planner path so it cannot bypass the transactional host-build/restart model.

## Unprotected (explicit per project)

1. The project must be switched to `Unprotected` from the workspace UI.
   Any pending Protected integration/recovery candidate must first be integrated or rejected; changing mode MUST NOT carry a hidden pending candidate across the trust-boundary switch.
2. The choice is persisted per project and restored when the workspace is reopened.
3. Plans still require structural validation and Policy Engine approval.
4. Every execution requires an explicit user confirmation even when the plan would not otherwise require approval.
5. Patches, commands, and verification execute directly in the real `project_path`; no copied sandbox is created for the Agent plan.
6. Successful execution moves directly to `applied`; there is no separate Apply step.
7. A failed multi-operation plan can leave partial host changes. Wharness MUST state this risk and MUST NOT attempt an automatic destructive rollback over pre-existing user changes.
8. `ApplyToHost` is unavailable for Unprotected sessions because the plan has already targeted the host.

The Protected/Unprotected switch governs Agent plan execution and MUST NOT change the interactive Editor terminal target. The terminal defaults to Sandbox; Host is a separate explicit human-only selection.

## Patch applicability

Patch execution first uses `git apply --check`. If a generated unified diff has inconsistent hunk line counts, Wharness may retry with `git apply --recount`. If the patch contains Git blob `index` metadata, a conservative `git apply --3way --check` attempt may also be used. A fallback is applied only after its check succeeds. Failed checks surface Git stderr instead of a generic `git apply --check failed` message.

## Interactive IDE terminal

The Editor terminal is a human-initiated execution surface with two explicit targets:

- `Sandbox` (default): a PTY login shell runs in the persistent isolated project copy. Network is disabled by default and is an explicit session choice. Reset recreates the copied workspace from the host.
- `Host`: a PTY login shell runs directly in the real project root as the logged-in operating-system user. Entering this target requires an explicit warning/confirmation and the UI keeps a persistent host-direct warning visible. Host networking is inherited from the machine, so the sandbox network toggle is unavailable.

Sandbox retains the runner's container isolation, capability drop, `no-new-privileges`, resource limits and network-off default. Host opens only after the dedicated confirmation and operates with the workstation user's real project authority. In stack mode the containerized backend MUST NOT own the Host shell: it connects to a checkout-scoped Unix socket and proxies only bounded start/input/resize/output/exit frames to a native `wharnex-host-pty` bridge launched by the Desktop lifecycle coordinator. Because that bridge is a child of the logged-in user session, the shell inherits the workstation's HOME, SHELL, PATH, SSH/session variables and hostname, so host commands see the same user/tooling context as a normal terminal (for example `ahmedjorge@kadafi`). The bridge socket lives under `.harness/bridge`, is mode `0600`, and is available only to the same OS user. Local non-stack backend mode may spawn the Host PTY in-process. PTY sessions remain human-only and MUST NOT be selected or driven by Agent mode, a model plan, automation or a generic command IPC primitive.

The terminal renders through an ANSI-capable emulator with bounded scrollback and automatically fits its viewport. A project session may keep multiple PTYs alive concurrently; each has its own opaque id, target, input, resize stream and close lifecycle. Opening one PTY never closes another. Collapsing the workbench is a visibility operation only: mounted instances keep their event subscription and processes running until the user closes that tab, resets/tears down the session, or the orphan guard applies. Narrow session-scoped operations carry bounded input, resize events, ephemeral output and close. Raw PTY input and output are not durable audit records because they may contain credentials or editor buffers; only lifecycle metadata without command text may be audited. The legacy one-shot terminal endpoint remains argv-only and Policy Engine constrained for compatibility and non-interactive tooling.

Editor file saves and Explorer create/rename/delete actions are explicit human mutations to the host project. File saves use optimistic SHA-256 concurrency checks; all Editor/Explorer filesystem operations retain root containment, secret/excluded-path denial and symlink-escape denial. A live sandbox copy is mirrored best-effort after Explorer mutations so the next interactive sandbox command sees the same tree.

## Git bootstrap

- Opening a project MUST ensure the project root owns a `.git` repository; when absent, Wharness initializes it with `git init` before context capture.
- Wharness MUST NOT create an automatic host commit during bootstrap.
- Protected host apply and Unprotected direct execution MUST re-check Git readiness before patching.
- Every isolated sandbox copy MUST initialize its own Git repository and baseline commit after filtering excluded/secrets. Host `.git` metadata is never copied into the sandbox.
- Read-only verification such as `git diff --check` therefore runs against the sandbox baseline in Protected mode and against the project's own repository in Unprotected mode.

## Human project provisioning (v1.2.17)

Opening, creating, and cloning a project occurs before Agent execution and is driven only by explicit local UI actions. Creating a project makes a new directory and initializes its Git boundary. Cloning uses `git clone --recurse-submodules` into a destination that did not previously exist. These bootstrap actions do not change Protected/Unprotected mode and are never emitted or triggered by a model execution plan.

## Interactive Host terminal semantics (v1.2.17.4, amended v1.2.53)

The human Host terminal is a real PTY rooted at the real project tree and guarded by its dedicated confirmation and persistent warning. In stack mode the Desktop lifecycle coordinator starts `dist/bin/wharnex-host-pty` natively as the logged-in workstation user; the Compose backend reaches it only through `${WHARNESS_BRIDGE_DIR}/host-pty.sock`. The native bridge chooses the user's host shell and starts it as an interactive login shell, preserving the real workstation environment and hostname rather than substituting the backend container's `wharness` user/toolchain. Renderer input remains bounded PTY data tied to the opaque terminal id, and the frontend provides explicit system-clipboard shortcuts (`Ctrl+Shift+C/V`, or `⌘C/⌘V` on macOS). A single project session may own multiple terminal ids at once. Hiding the panel does not destroy those PTYs; switching target reconnects only that tab, explicit tab close closes only that PTY, and reset/session teardown may close the affected sandbox set. Model and automation execution remain on the structured argv protocol.

Remote Git actions initiated explicitly from the project Git UI are a separate, narrow capability. In stack mode `fetch`, full `push`, and selected-commit `push` cross `${WHARNESS_BRIDGE_DIR}/host-git.sock` to the same native helper process so Git can use the logged-in workstation user's credential helpers (including `gh auth git-credential`). The host-Git protocol accepts only the fixed Git operations and validated root/remote/branch/SHA fields; it is not an argv, shell, PTY, planner, or automation execution channel. Local repository inspection, merge and branch operations remain in the backend against the shared checkout.

## Transactional self-evolution (v1.2.23, amended v1.2.34)

The runtime instance identifier is configured through `WHARNESS_INSTANCE_ID`. Opening a different structurally recognized Wharnex checkout is ordinary Protected project work and is labelled as evolution of that instance; it never gains self-evolution authority. The `statable` runtime identifier MUST refuse to open its own canonical root, preventing a statable release from self-evolving.

A session is `self_evolution=true` only when its canonical project root is exactly the canonical root of the currently running Wharness instance. A child directory, another checkout, or another worktree is not self-evolution unless it resolves to that exact runtime root.

Self-evolution is locked to `Protected`; switching that session to `Unprotected` MUST be rejected. Normal sandbox execution and verification happen first. A successful Protected execution that contains patches then uses a self-evolution host batch instead of the generic Apply path:

1. acquire a durable `.harness/self-evolution/active.lock` for the pending activation batch and a short-lived `stage.lock` for the current mutation stage;
2. for the first batch member, snapshot patch-touched source files, root/frontend compiled artifacts, build stamp and known-good lifecycle scripts;
3. apply validated patches to the real root and run `make build-stage` while the old Wharness remains healthy; this may build replacement application images but MUST NOT recreate the running backend/frontend/database/tunnel containers;
4. rollback the whole batch immediately on host Apply/build failure;
5. on success, persist `restart_pending`, keep `active.lock`, and release only `stage.lock`;
6. another verified self-evolution plan MAY extend that same `restart_pending` transaction: it reuses the original runtime rollback baseline, snapshots only newly touched source paths, records its session/plan membership, applies, rebuilds, and returns to `restart_pending`;
7. Apply/build/revert/restart stages remain mutually exclusive through `stage.lock`, so only the idle pending state is batch-extendable;
8. pending activation is represented independently from the current chat task; after the user chooses Later, that session may process another request while retaining the restart control and batch membership;
9. explicit restart confirmation claims the stage lock. In stack mode the backend launches the pre-captured worker inside a detached one-shot supervisor container with the project root and Docker socket mounted; that supervisor is outside the backend container being replaced and therefore survives backend/frontend activation. Non-stack development mode retains the detached host worker;
10. in stack mode the supervisor rolls only backend/frontend with `--no-deps`, never PostgreSQL/tunnel/Desktop. It records the currently running application image IDs before activation; if health checks fail it re-tags/restarts those previous images immediately, then restores the original source/runtime baseline, rebuilds it, and re-activates. Tunnel public URLs and database identity remain unchanged throughout;
11. after restart/rollback, the backend reconciles every recorded batch member to the resulting state without overwriting a newer unrelated chat task, then performs final transaction cleanup;
12. a plan with a recorded successful execution is single-shot: `Execute` MUST reject the same `plan_id` after sandbox verification, host apply, `restart_pending`, `restart_scheduled`, or successful restart reconciliation. Persisted `plan`, policy and execution data remain audit history only; the UI MUST NOT surface an Execute action for those terminal/success states. A new user request must produce a new plan before execution can resume.
13. Host Apply is single-consumer at the project lock boundary: after acquiring that lock, the Engine MUST reload durable session state before deriving pending candidates. A concurrent duplicate that read `verified` earlier observes the candidate as consumed and exits without merge, patch, build, version, transaction or repair side effects.
13. if an extendable pending batch has a `transaction.json` identity mismatch, Wharness MUST fail closed unless it can prove that the retained directory is the status-referenced transaction: the metadata root canonically matches the active root, or the former absolute root no longer exists after a checkout rename/move, the active root resolves to the Git repository top-level (not merely a nested directory of another repository), and the transaction's recorded pre-transaction Git commit is still an ancestor of the active checkout; the status session/plan is still a recorded batch member; required source/runtime/lifecycle rollback artifacts are present; and no separately retained transaction directory matches the stale metadata id. A proven mismatch MAY repair only the metadata identity fields atomically and MUST log the recovery. Existing-but-different roots, relocated metadata without Git-lineage proof, and all other failed proofs remain fail-closed. `self_evolution_transaction_metadata_mismatch` is infrastructure/recovery state, never a reason to request another source patch; a retained verified candidate is offered as an Apply retry after recovery instead of a persistent generic blocked alert.

Model plans MUST NOT own start/stop/restart of Wharness in self-evolution mode. They verify source changes in the Protected sandbox; Wharness owns host build, batching, lifecycle handoff and recovery. Runtime recovery files under `.harness` are not project-mutation targets.

## Parallel ChangeSet integration (v1.3)

The managed-context SHA-256 is provenance and cache identity, not a global project lock. Every planner request retains a bounded immutable context archive keyed by `request_id`. A request remains valid while other chats, humans, or external coding agents edit the host; baseline notices are informational and MUST NOT supersede an in-flight request.

Protected execution reconstructs a stale request from its exact immutable base, applies and verifies the protocol-v1 patch there, then materializes a canonical ChangeSet containing Wharness-derived mutations and base/result blob hashes. Every actual patch, declared read, and barrier path MUST exist in the retained archive before that archive is authoritative. Because the model context may intentionally omit safe source files after conservative content filtering, Wharness completes only missing, non-authoritative verification dependencies from the current safe project copy; it never overwrites archived historical files. `impact_files` is only a scheduling forecast. `read_files` records semantic dependencies and `barrier_files` records inputs whose movement requires broader verification.

All Agent plan execution, whether started manually or by Auto, MUST pass through one FIFO execution queue keyed by canonical project root. At most one plan may execute for a project at a time; different projects may execute concurrently. A queued session MUST be re-read after admission before policy, duplicate-plan, baseline, sandbox, or host-direct work proceeds. Queue admission and release MUST be cancellation-safe and observable through `execution.queued` and `execution.dequeued` events. This execution queue does not serialize ChatGPT planning or transport.

One durable interrupted-execution intent owns a `plan_id` at a time. If bundle delivery, recovery, or renderer reconciliation triggers Auto again while that same intent is running or awaiting recovery, the later trigger MUST join the recorded execution and publish `automation.execution_joined`; it MUST NOT report `automation.execution_failed`, consume a repair round, or start a second runner.

The frontend MUST project this authoritative queue visibly, including ordered position, Harness chat, plan id, and waiting/running state. It may optimistically show a submitted execution, but MUST use backend queue events and terminal responses for reconciliation; it is never a second execution authority.

Before queue admission, Wharness persists the validated plan id and approval as an execution intent. A terminal result clears it. If the request context is cancelled or a process disappears before a terminal result is persisted, the intent survives restart and MUST NOT execute automatically. The workspace presents interrupted intents in a persistent non-modal recovery center and requires an explicit Continue or Discard decision without blocking unrelated chats, the Editor, execution logs, or the ChatGPT surface. Continue is acknowledged quickly, marks only that intent as resuming, and re-enters the same project FIFO in background while the UI supervises its persisted state; duplicate resume requests for the same active intent are idempotent. A retryable execution failure keeps the intent visible with its failure state, successful completion or reconciliation clears it, and Discard clears only a non-running execution intent without mutating the project.

For a pre-v1.3 pending request whose immutable archive does not exist, Wharness MAY use one conservative compatibility pass only for a validated patch-only Protected plan: retarget the plan to a fresh current copied sandbox, apply it there, run its verification, and continue through normal ChangeSet integration. It MUST NOT create another global-baseline continuation. Command-bearing legacy plans without an immutable base fail explicitly and require one fresh request.

Host Apply is serialized only for the short integration phase per canonical project root. Wharness refreshes the host, three-way merges each ordered ChangeSet as BASE/CURRENT/RESULT, stages the complete merged tree in an isolated sandbox, and reruns verification. Clean disjoint-file and disjoint-hunk changes integrate without a new model turn. Changed read/barrier dependencies force semantic or broad re-verification, not automatic replanning.

### Local reconciliation ladder (v1.3.6)

Line granularity is a property of the merge tool, not of the change. Two writers editing different arguments of one long call — the ordinary shape of a JSX prop list or a function signature — do not overlap, yet collide at line granularity. Wharnex MUST therefore exhaust a local ladder before any collision is called a conflict:

1. an unmoved side needs no merge;
2. Git's line-granular three-way merge;
3. for each hunk the line tier conflicted on, and for that hunk alone, the same three-way merge re-run with one token per line, so the tool's line granularity becomes token granularity.

The token tier MUST NOT reach outside a conflicting hunk: everything else comes from the line merge verbatim. Its tokenization MUST be lossless, so a clean merge round-trips to exact bytes and can neither invent nor drop content. Where content could be mistaken for the merge tool's own conflict markers, the marker width is raised above anything the inputs contain; when that is impossible the file stays a conflict rather than being merged from a misread. The merged candidate is still staged and re-verified before any host write, so the ladder never bypasses verification.

`git merge-file` exits with the **number of conflicts**, not a success flag. Reading any status other than 1 as a tool failure turns every file with two or more conflicting hunks into a hard Apply failure, which is a defect and not a conflict outcome.

Each unresolved conflict MUST carry the integrator's own assessment — `mechanical`, `semantic` or `structural`, with the hunk counts behind it — and that assessment travels into the conflict capsule, so a planner round is never asked to re-propose the mechanical union the engine already attempted and refused. Applies that reconciled anything locally publish `integration.reconciled_locally`, naming which paths needed the token tier.

Every host write performs per-path compare-and-swap against the value observed during staging and uses replace semantics. A race triggers at most three restage attempts; Wharness never overwrites an unexpected external value. The integration journal rolls back only values still owned by Wharness. Protocol, policy, transport, verification, race, and merge-conflict outcomes remain distinct.

## Engine-owned VERSION at Apply (v1.3.5)

`VERSION` is host metadata owned by Wharnex rather than a planner patch target. Session preparation ensures the root file exists, using `v0.0.0.0` only when it is absent. A verified `change` carries a `version_increment`; grouped pending changes apply their increments in the same order as their accepted plans.

Wharnex mutates `VERSION` only after source integration and post-integration verification have succeeded, and after the self-evolution host build when that lifecycle applies. In auto-commit mode the version mutation is recorded by an internal Wharnex commit that stages only `VERSION`. In no-auto-commit mode the same internal commit is included in the integration record and then unwound with the source integration, leaving the verified version edit in the operator's working tree.

The session records the exact before/after values used by the successful Apply. Deterministic host revert restores the recorded prior value only when the file is still at the recorded applied value, so Wharnex does not overwrite a later external version edit. An Apply failure after a legacy direct version write restores the prior value before surfacing the failure.

## Commit modes and the Git surface (v1.3.4)

A project chooses what happens to its history after a verified change is
applied (see `adr/ADR-0040`). **Auto-commit** — the default and the historical
behavior — keeps the integration's commits. **No auto-commit** runs the same
full integration (pre-merge snapshot, real merge, post-merge verification) and
then returns the branch to the commit the host was at before Wharnex touched
anything, leaving the change in the working tree as uncommitted work. The
integration is never skipped: the merge is what reconciles the change with host
drift, and skipping it would reintroduce the failure `adr/ADR-0035` removed.

Post-merge verification runs through the host runner — an in-process `exec`,
and therefore Wharnex's own control container — while the same gates were
verified in the Protected runner image. A gate the control container cannot run
at all is recorded as unverified on host and integration continues; see
`SoT/ERROR_MODEL.md` and `adr/ADR-0043`. Every other failure is a real failure.

For a failed post-merge verification, the rollback boundary is the first real
merge's `PreMergeSHA`. When preservation committed dirty operator work just
before that merge, this is the preservation snapshot commit rather than the
older HEAD sampled before Apply began. Resetting to the older commit is
forbidden because it discards the operator work the snapshot was created to
protect and can also erase the visible auto-commit history of the failed batch.

Each integrated candidate is recorded before the unwind with its
planner-authored commit message, its declared paths and its own diff, so the
history the change protocol obliges the planner to write survives even though
the commit does not. Committing that queue — in full or selectively — pushing,
and merging another branch are explicit human actions on the project Git
surface; none of them is reachable from a model plan, which continues through
Policy and Protected execution unchanged.

A push rejected as non-fast-forward is integrated (fetch, merge, push again)
rather than reported as a failure. A conflict on that integration, or on an
explicit branch merge, aborts before returning — Wharnex's own integration
refuses to act on a repository with unresolved paths — and routes into the same
bounded `harness.conflict/v1` resolution, replayed into that exact merge and
committed as its merge commit. Publishing the result remains an explicit push.

A true merge conflict preserves all pending candidates and creates exactly one `harness.conflict/v1` focused resolution request. That request may write only the conflicting paths. Its result replaces only the conflicted mutations; unrelated verified mutations remain queued. Repeated global baseline repair for a merge conflict is forbidden.

## Request-base-rooted integration (v1.3.2)

Every planner request anchors the exact host tree its context was snapshotted
from, as a real commit parented on the host's HEAD, under
`refs/wharnex/base/<request_id>`. The context bundle is what the model reads;
this commit is what the model's patch is authored against.

Capture is non-invasive. Staging happens in a private temporary index, so the
host's index, HEAD, current branch and working tree are never touched and an
operator with a half-staged change is unaffected. Content is exactly what
`git add -A` stages: tracked plus untracked, minus everything `.gitignore`
excludes. The anchor lives outside `refs/heads`/`refs/tags`, so `git branch`,
`git tag` and a default `git log` are unchanged. Anchors are bounded per
session and released as they age out; the underlying commits then become
unreachable and are reclaimed by ordinary Git garbage collection.

Protected execution roots the candidate's integration branch at that base and
applies the plan's patch there. Applying a patch to the tree it was authored
against succeeds by construction, however far the host has advanced in the
meantime. The candidate's commit therefore descends from the request base,
which gives the eventual host merge a meaningful merge-base: real divergence
becomes an ordinary three-way merge, resolved with no model turn whenever the
changes are genuinely compatible.

Whether two changes can be combined is decided by that merge, never by
impact-file, line-range or column overlap. `impact_files` remains a scheduling
forecast; the authoritative write set is still derived from the validated
patch.

A base-rooted run executes a temporary extraction of the archive, and that is
the only thing the temporary directory decides. The canonical project still owns
the run: the private dependency cache and every other project-scoped resource
stay keyed on it, and workspace preparation is told which project that is rather
than inferring it from the tree it receives (`adr/ADR-0045`).

Archive completeness is measured against what the patch modifies, reads and
declares as a barrier. A path the patch creates cannot be in a snapshot taken
before it existed, so it is exempt — and is withheld from base hydration too, so
the base keeps matching the tree the patch was authored against. A peer that
created the same path meanwhile is an ordinary collision for the three-way merge
at Apply, not a patch error.

Capture and rooting are both best effort. A repository with no commit yet, or
any Git refusal, degrades to executing against the host's current tree rather
than failing the user's request.

An advisory preflight (`git merge-tree`) may run before a merge reaches the
host, so a merge already known to be doomed never mutates it and never leaves a
pre-merge snapshot commit behind for a merge that did not happen. It compares
against the host's real current content, including uncommitted state, because
the real merge commits that state first. A Git build that cannot answer yields
"unknown", never "clean"; the atomic merge remains authoritative.

## Submodule integration (v1.3.7)

A superproject cannot hold a submodule's bytes, only a pointer to the commit
that does. A change touching an initialized submodule is therefore verified and
committed as a **repository tree** (`adr/ADR-0039`): touched repositories are
committed deepest-first so each parent records its child's resulting gitlink,
and every candidate branch is published only into the matching local host
repository.

Apply merges the superproject candidate and then advances each affected
submodule, on the branch it was checked out on at verification, to the exact
locally published commit. A submodule that started detached stays detached. A
later merge or verification failure resets the superproject to its pre-Apply
HEAD and restores every affected submodule branch to its recorded base commit,
so Apply stays atomic from the operator's point of view. Temporary nested
integration branches are removed after success.

The advisory superproject preflight excludes the gitlinks of the nested
repositories the same candidate owns. The superproject branch records each
submodule at the commit verification produced, so a dry-run merge of the
superproject alone would otherwise report a pointer conflict whenever that
submodule moved on either side — the very case the mechanism exists to handle,
and one the real repository-tree transaction resolves locally.
If Git still reports that exact owned gitlink during the authoritative merge,
the Engine selects the descendant of the validated base and candidate commits
and commits that resolution locally. No other path is admitted to this rule,
and a mixed ordinary conflict still routes only its ordinary paths through the
bounded conflict protocol.

Repository-tree metadata is durable protocol state. A candidate persisted by
the retired repository-unit implementation under `integration_units` MUST be
adapted losslessly to `submodule_integrations`; silently falling back to a
root-only merge would forget ownership of its gitlinks and recreate a false
managed-state conflict after restart. If an incompatible intermediate version
already rewrote the snapshot without that legacy field, recovery MAY rebuild a
nested record only when three local facts agree: a plan path is owned by the
registered unit, the parent candidate branch records its exact gitlink, and the
same named local branch in that unit points at that commit. Ambiguous or absent
evidence fails closed.

Older unit records did not retain the operator checkout identity, so recovery
measures its branch/detached state and HEAD without mutation and persists that
identity. Apply then proves either that the verified nested commit can
fast-forward from that point or that an earlier partial attempt already
integrated it into the current HEAD. The latter is an idempotent success and
MUST NOT rewind the operator branch. A failed proof retains the candidate and
fails closed as host drift; it never guesses or requests a source-repair turn.

The operator's informed execution decision authorizes this bounded repository
tree as one transaction after successful Protected verification. A host-integration
retry reuses that existing authorization rather than asking for a second Apply
decision. The authorization does not cover remote pushes or unrelated nested Git
repositories, so every repository Wharnex committed into still holds work only
the operator can push.

## Persistent integration race (v1.3.2)

On the legacy compare-and-swap path, a race means the host's value for a path
changed between staging and writing. Retrying is correct for the first few
attempts, because an unrelated one-off write can lose to a restage. Once the
same path has raced through every attempt, the candidate and the host have
genuinely diverged there and Apply is non-convergent: it replays the same diff
against the same host and observes the same mismatch indefinitely.

Such a race is escalated to the same bounded `harness.conflict/v1` resolution a
detected conflict uses, scoped to the racing paths, with the host's current
content as CURRENT. It is not reported as an indefinitely retryable condition.
A race that cannot be attributed to an owning candidate keeps its previous
classification instead of becoming a conflict with no BASE/RESULT to resolve
against.

## Execution concurrency (v1.3.2)

Per-project execution concurrency defaults to one and is adjustable at runtime
from the workspace queue view or through
`WHARNESS_PROJECT_EXECUTION_CONCURRENCY`. Lowering it never interrupts work
already running: the project admits nothing new until it drains under the new
limit. Raising it admits plans already waiting, not only later submissions.
An operator change made through the workspace is durable Wharnex operational
state and survives backend/Desktop restart; the environment value remains the
initial fallback until such a setting is stored.

The ceiling is deliberately small. Each concurrent runner claims a full
container memory allowance plus a complete project clone, so raising it trades
queueing delay — which is recoverable — for out-of-disk and out-of-memory
failures, which are classified as unrepairable by any source patch.

## Orchestrator task scheduling (v1.4)

Orchestrator tasks use the persisted lifecycle `PENDING -> READY -> DOING -> REVIEW -> COMPLETE -> ARCHIVED`, but transitions are not strictly linear. Reopening completed/review work is supported and invalidates downstream dependency evidence. A separate condition describes dependency, plan approval, manual pause, missing context, approval, conflict, failed run or stale dependency blocking.

Generated tasks are persisted as `PENDING` until their plan is approved. The backend readiness evaluator, never the frontend, promotes an unblocked dependency-satisfied task to `READY`. `DOING` can only be entered by the Orchestrator Start action; a running task cannot be manually moved while its Agent run owns it.

V1 has one real mutation slot per project. Start fails while another project task is `DOING`. The created Agent Session also enters the existing canonical-project execution FIFO, so Orchestrator does not weaken ADR-0025 admission, Policy, sandbox, verification, integration, Apply or recovery semantics. `parallelizable` is advisory planning metadata in V1 and does not increase execution concurrency.
