# Execution Model SoT

Wharness supports a per-project execution mode selected in the workspace UI.

## Protected (default)

1. Plans are validated structurally.
2. Policy evaluates each operation.
3. Denied plans never execute.
4. Approved plans execute against an isolated copy.
5. Patches are applied in the sandbox first.
6. Commands/verification run with declared cwd, timeout, network policy, and expected exit codes.
7. Host application is a separate endpoint/action and is allowed only after successful sandbox verification.
8. Host application re-validates patch paths and re-checks patch applicability before mutation.

## Unprotected (explicit per project)

1. The project must be switched to `Unprotected` from the workspace UI.
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

- `Sandbox` (default): argv executes in the persistent isolated project copy. Network is disabled by default and is an explicit per-command user choice. Reset recreates the copied workspace from the host.
- `Host`: argv executes directly in the real project root. Entering this target requires an explicit warning/confirmation and the UI keeps a persistent host-direct warning visible. Host networking is inherited from the machine, so the sandbox network toggle is unavailable.

Both targets remain shell-string-free and pass through the Policy Engine, but human terminal commands use a dedicated interactive profile rather than the stricter model-plan profile. That profile may allow normal development mutations such as Git staging/commits, package-manager operations, language runtimes executing project files, and file removal. Shell interpreters, privilege escalation, container/host administration, destructive storage/process management, and inline-code evaluator flags remain denied. Terminal Host is a human-only exception and MUST NOT be selected or driven by Agent execution mode, a model plan, or automation.

Editor file saves and Explorer create/rename/delete actions are explicit human mutations to the host project. File saves use optimistic SHA-256 concurrency checks; all Editor/Explorer filesystem operations retain root containment, secret/excluded-path denial and symlink-escape denial. A live sandbox copy is mirrored best-effort after Explorer mutations so the next interactive sandbox command sees the same tree.

## Git bootstrap

- Opening a project MUST ensure the project root owns a `.git` repository; when absent, Wharness initializes it with `git init` before context capture.
- Wharness MUST NOT create an automatic host commit during bootstrap.
- Protected host apply and Unprotected direct execution MUST re-check Git readiness before patching.
- Every isolated sandbox copy MUST initialize its own Git repository and baseline commit after filtering excluded/secrets. Host `.git` metadata is never copied into the sandbox.
- Read-only verification such as `git diff --check` therefore runs against the sandbox baseline in Protected mode and against the project's own repository in Unprotected mode.

## Human project provisioning (v1.2.17)

Opening, creating, and cloning a project occurs before Agent execution and is driven only by explicit local UI actions. Creating a project makes a new directory and initializes its Git boundary. Cloning uses `git clone --recurse-submodules` into a destination that did not previously exist. These bootstrap actions do not change Protected/Unprotected mode and are never emitted or triggered by a model execution plan.

## Interactive Host terminal submit semantics (v1.2.17.4)

The human Host terminal remains a direct argv executor rooted at the real project. Submission is available through both Enter/form submit and an explicit run button. This UI affordance does not introduce a shell: tokenization remains client-side argv parsing, backend interactive policy validation remains mandatory, and the Host runner executes the selected executable directly with the project-relative cwd.

## Transactional self-evolution (v1.2.23, amended v1.2.34)

A session is `self_evolution=true` only when its canonical project root is exactly the canonical root of the currently running Wharness instance. A child directory, another checkout, or another worktree is not self-evolution unless it resolves to that exact runtime root.

Self-evolution is locked to `Protected`; switching that session to `Unprotected` MUST be rejected. Normal sandbox execution and verification happen first. A successful Protected execution that contains patches then uses a self-evolution host batch instead of the generic Apply path:

1. acquire a durable `.harness/self-evolution/active.lock` for the pending activation batch and a short-lived `stage.lock` for the current mutation stage;
2. for the first batch member, snapshot patch-touched source files, root/frontend compiled artifacts, build stamp and known-good lifecycle scripts;
3. apply validated patches to the real root and run `make build` while the old Wharness remains healthy;
4. rollback the whole batch immediately on host Apply/build failure;
5. on success, persist `restart_pending`, keep `active.lock`, and release only `stage.lock`;
6. another verified self-evolution plan MAY extend that same `restart_pending` transaction: it reuses the original runtime rollback baseline, snapshots only newly touched source paths, records its session/plan membership, applies, rebuilds, and returns to `restart_pending`;
7. Apply/build/revert/restart stages remain mutually exclusive through `stage.lock`, so only the idle pending state is batch-extendable;
8. pending activation is represented independently from the current chat task; after the user chooses Later, that session may process another request while retaining the restart control and batch membership;
9. explicit restart confirmation claims the stage lock and hands the complete pending batch to the pre-captured detached supervisor; a failed stop/handoff keeps the durable batch lock and returns the batch to an extendable/retryable pending state;
10. the supervisor activates the cumulative build and, if health checks fail, restores the original running-runtime baseline rather than an intermediate pending build;
11. after restart/rollback, the backend reconciles every recorded batch member to the resulting state without overwriting a newer unrelated chat task, then performs final transaction cleanup.

Model plans MUST NOT own start/stop/restart of Wharness in self-evolution mode. They verify source changes in the Protected sandbox; Wharness owns host build, batching, lifecycle handoff and recovery. Runtime recovery files under `.harness` are not project-mutation targets.
