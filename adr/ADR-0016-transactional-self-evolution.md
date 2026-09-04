# ADR-0016 — Transactional self-evolution

## Status

Accepted for Wharness v1.2.23; amended for v1.2.26.

## Context

Wharness may be opened as its own managed project. A normal Protected Apply is insufficient in this case: sandbox verification does not rebuild the host runtime, and restarting from a process that is itself being replaced can terminate the restart logic before recovery completes.

## Decision

Wharness detects self-evolution only when the canonical managed `project_path` is exactly the canonical root of the running Wharness instance. Subdirectories and independent worktrees/copies are normal projects.

Self-evolution is always Protected. After sandbox verification, host Apply becomes a transaction:

1. Acquire one exclusive self-evolution lock.
2. Snapshot every patch-touched source file plus the current compiled runtime and build-success stamp.
3. Apply only the validated patches to the host.
4. Run the real host `make build` while the current runtime is still alive.
5. If Apply/build fails, restore source/runtime immediately and keep the current runtime running.
6. If build succeeds, persist the transaction as `restart_pending` and keep the current runtime alive. The UI asks the user to activate the new build.
7. Only after explicit restart confirmation, hand restart to the detached supervisor copied into the transaction before mutation. Choosing **Later** preserves the pending transaction and exposes a restart-required indicator.
8. The supervisor stops the old coordinator and starts the new runtime using its normal health checks.
9. If the new runtime fails, restore the previous source/runtime and start the known-good lifecycle scripts. Dependency reconciliation is attempted once only if needed.

The planner receives `SELF-EVOLUTION MODE: true` and must not place Wharness start/stop/restart/process-management commands in model plans. `.harness` recovery state remains runtime-owned and cannot be patched.

## Consequences

- A verified source patch cannot silently leave stale host binaries.
- A successful build no longer implies an immediate restart; activation is an explicit user decision while rollback state remains retained.
- A broken new runtime has a known-good rollback path independent of the process being replaced.
- Concurrent self-updates are rejected.
- Sessions, chats, browser data and other `.harness` state are preserved across a successful restart.
- The transaction is intentionally Linux/Unix-oriented because the current Wharness lifecycle itself is shell/process-group based.
