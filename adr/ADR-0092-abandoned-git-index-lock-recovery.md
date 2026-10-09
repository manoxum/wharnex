# ADR-0092 — Autonomous abandoned Git index-lock recovery

## Decision

Wharnex may recover an abandoned `index.lock` as part of an already authorized
Git mutation. This replaces the unconditional no-deletion rule in the
`host_working_state_blocked` error contract; it does not authorize a new commit,
Apply, remote push, planner command or repair round.

The engine retries only an exact index-lock creation failure, with a bounded
wait for transient contention and at most one cleanup and replay per command.
Read-only Git observations disable optional index locking, reducing locks left
behind when an observation is cancelled. Every repository is handled separately,
including initialized submodules and linked worktrees.

Cleanup executes in the existing restricted host Git bridge, never by trusting
the backend container's partial process view. The bridge derives the worktree
and real Git directory itself; callers cannot choose a file to delete. It
requires a regular, empty, singly linked lock owned by its own OS user and at
least fifteen minutes old. All path components must be free of symlinks. The
host process-name/state scan must succeed and find no live Git process. Exited
zombies cannot retain descriptors and do not count as active Git. A Linux
exclusive file lease (`F_SETLEASE/F_WRLCK`) must prove that the exact lock inode
has no other open descriptors, across all processes and namespaces. The lease
is retained through quarantine/removal and a pending lease break aborts cleanup.
This replaces scanning other applications' `/proc/<pid>/fd`, whose ptrace
permissions can deny access even on an otherwise complete host process view.
An unsupported or refused lease is never replaced by age-only inference.
Incomplete visibility, cancellation, a running
Git process, unfinished Git operation or changing lock identity fails closed.

The lock is moved atomically to a unique quarantine name in the same Git
directory. Its device/inode, size and timestamps are checked again before
removal. A raced replacement is restored without overwriting a newer lock and
is never deleted. The live index, worktree, staging and history are untouched.
The original Git command then runs again; all ordinary policy, integration,
hook and verification gates still apply.

Recovery results are classified operational records, correlated when the
calling context carries identities. Only bounded paths, age and reason travel;
process arguments, environments, file contents and credentials never do.

The kernel proof uses only the same-user owned empty regular lock, without
privilege escalation or new host capabilities. It opens without creation or
truncation and revalidates inode identity before proceeding. Concurrent readers
or writers trigger a lease break; the bridge releases the lease promptly on
every success, refusal and cancellation. It never waits for a lease to become
available. See the [Linux lease contract](https://man7.org/linux/man-pages/man2/F_GETLEASE.2const.html).

## Compatibility and limits

The Unix bridge adds the named `recover_index_lock` operation and an optional
structured recovery result. Older helpers reject it safely, retaining the
existing typed host block and manual remedy. An unavailable bridge never falls
back to a container-local process scan. Non-Linux hosts and incomplete process
visibility retain the same refusal. Nonempty locks remain manual recovery data.
No new permission prompt or UI setting is required: this maintenance is scoped
to the Git mutation the operator already requested.

## Implementation scope

Engine Git execution and host connection dispatch are extracted into
`internal/gitops` and its recovery/hostbridge subdomains. The touched concern
and its new tests stay under 200 lines per file. Unrelated legacy measurement
in `hostrepo/topology.go`, candidate plumbing in `sandbox/gitintegration.go`
and remote Git/release plumbing in `sandbox/hostgit_bridge.go` remain named
follow-up size/domain debt; they are not rewritten by this recovery change.
