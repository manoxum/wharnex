# ADR-0016 — Transactional self-evolution

## Status

Accepted for Wharness v1.2.23; amended for v1.2.26, v1.2.34 and v1.2.46.

## Context

Wharness may be opened as its own managed project. A normal Protected Apply is insufficient in this case: sandbox verification does not rebuild the host runtime, and restarting from a process that is itself being replaced can terminate the restart logic before recovery completes.

## Decision

Wharness detects self-evolution only when the canonical managed `project_path` is exactly the canonical root of the running Wharness instance. Subdirectories and independent worktrees/copies are normal projects.

Self-evolution is always Protected. After sandbox verification, host Apply becomes a transaction:

1. Acquire one durable self-evolution **batch lock** plus a short-lived **stage lock**.
2. For the first member of the batch, snapshot every patch-touched source file plus the current compiled runtime, build-success stamp and known-good lifecycle scripts. This is the rollback baseline of the runtime that is actually running.
3. Apply only the validated patches to the host and run the real host `make build` while the current runtime is still alive.
4. If Apply/build fails, restore the complete batch to that original running-runtime baseline.
5. If build succeeds, persist the transaction as `restart_pending`, release only the stage lock, and keep the durable batch lock plus rollback data. The current runtime keeps running.
6. While the batch is `restart_pending`, another verified self-evolution Apply MAY acquire the stage lock and extend the same transaction. Newly touched paths are snapshotted only if they were not already in the original rollback set; existing backups are never overwritten. Every participating session/plan is recorded in transaction metadata.
7. Each extension is rebuilt on the real host. A successful extension returns to `restart_pending` and again releases only the stage lock. Concurrent Apply/build/revert/restart stages are still rejected while the stage lock is held.
8. Pending activation is tracked independently from the session's current conversational task. Choosing **Later** therefore releases that chat to accept more requests while keeping its restart affordance and batch membership; later verified self-evolution Applies accumulate without producing `another Wharness self-evolution transaction is already active`.
9. Only after explicit restart confirmation, claim the stage lock and hand the whole pending batch to the detached supervisor copied before the first mutation. If the supervisor cannot stop the current coordinator, release only the stage lock and retain the durable batch/baseline so restart can be retried or the same batch can be safely extended.
10. The supervisor starts the cumulatively built runtime using normal health checks.
11. If the new runtime fails, the single batch rollback restores the original source/runtime and starts the original known-good lifecycle scripts. Dependency reconciliation is attempted once only if needed; rollback failure remains fail-closed behind the durable batch lock for manual recovery.
12. Completed transaction metadata is retained until the restarted backend reconciles all member sessions. Reconciliation clears the pending activation flag for every member without overwriting a newer unrelated request state, then the transaction is removed.
13. The fail-closed hold in step 11 protects the retained rollback baseline/source-backup/pending-plan data inside that transaction's own directory, not the lock file itself. If a later `Prepare` finds the batch lock held by a phase that step 11 deliberately keeps non-reclaimable (`rollback_failed` and the other terminal/in-flight phases), it first confirms that transaction's directory still exists. When the directory is gone — nothing under `.harness/self-evolution/txn-*` can vanish except through this manager's own `Finalize`, so its absence always means the record is orphaned, never a normal in-flight state — there is no baseline left to protect, and refusing forever would only convert a one-time failure into a permanent `self_evolution_transaction_busy` deadlock that no ChatGPT-side patch can resolve, since nothing about that loop can delete a local lock file. The manager reclaims the lock automatically in that case and appends an audit line to `.harness/logs/self-evolution.log` naming the discarded transaction, its phase and the reason. A transaction directory that is still present keeps blocking exactly as before, unresolved until a human inspects it.
14. An extendable `restart_pending`/`restart_failed` batch may also self-heal a `transaction.json` identity mismatch without discarding its rollback baseline. Repair is allowed when the metadata root canonically resolves to the running Wharness root. A stale absolute root from a checkout rename/move is also recoverable only when that former root no longer exists, the active Wharness root is the Git repository top-level rather than a nested directory of another repository, and the transaction's recorded pre-transaction Git commit is still an ancestor of the active checkout. In both cases the metadata must still record the exact session/plan named by runtime status, the retained source/runtime/lifecycle rollback artifacts must be present, and the mismatched metadata id must not name another transaction directory that still exists. Under those proofs, the directory/status identity is authoritative, only the metadata `transaction_id`/canonical `root` fields are rewritten atomically, and `metadata_repaired` is appended to the self-evolution recovery log. An existing-but-different root, a moved root without Git-lineage proof, or any other failed proof remains fail-closed as `self_evolution_transaction_metadata_mismatch`; it must not start a fresh transaction or consume a ChatGPT source-repair round.

The planner receives `SELF-EVOLUTION MODE: true` and must not place Wharness start/stop/restart/process-management commands in model plans. `.harness` recovery state remains runtime-owned and cannot be patched.

## Consequences

- A verified source patch cannot silently leave stale host binaries.
- A successful build no longer implies an immediate restart; activation is an explicit user decision while rollback state remains retained.
- A broken new runtime has a known-good rollback path independent of the process being replaced.
- Concurrent mutation stages are rejected, but an idle `restart_pending` transaction is intentionally extendable as one atomic batch.
- Sessions, chats, browser data and other `.harness` state are preserved across a successful restart.
- The transaction is intentionally Linux/Unix-oriented because the current Wharness lifecycle itself is shell/process-group based.
- Fail-closed rollback failure no longer risks becoming a permanent deadlock once its own protected data is gone: the durable batch lock self-heals from that specific orphaned state while still refusing to touch a transaction directory that is genuinely still present.
- A retained pending batch with a provable metadata-only identity drift can be repaired in place and retried; ambiguous metadata remains fail-closed and is classified as local recovery state rather than a source defect.
