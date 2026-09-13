# ADR-0043 — Host verification environment parity

- Status: accepted
- Supersedes: none
- Amends: `adr/ADR-0029` (post-merge verification), `adr/ADR-0033` (execution environment disclosure)

## Context

Git-native integration (ADR-0029) re-runs a plan's own verification gates
against the real merged host tree, after the same gates already passed in the
Protected sandbox. The two runs happen in **different environments**, and
nothing guaranteed they were comparable:

- Protected verification runs in the runner image, which installs the project
  build toolchain (`build-essential`, `pkg-config`, …).
- Post-merge verification runs through `HostRunner`, an in-process `exec` — so
  it runs inside Wharnex's own backend/control container, whose inventory is
  deliberately narrow (Go, Node, git, make, zip, docker CLI).

Production evidence: `go test -race ./...` passed in the runner and then failed
post-merge in **5 ms**:

```
go: -race requires cgo; enable cgo by setting CGO_ENABLED=1
```

The control container had no C compiler, so its `CGO_ENABLED` resolved to 0 and
the race build refused to start. Wharnex read exit 2 as an ordinary verification
failure: it reverted the host to the pre-merge commit, discarded a verified
candidate, and spent an automatic repair round asking the planner to fix source
that was never implicated. The retry failed identically, because no source patch
adds a C compiler to the container Wharnex itself runs in.

This is the same shape as the offline Go module cache, the disk-full linker and
the npm native-binding failure before it: an infrastructure fault wearing the
costume of a code defect. It is also structural rather than incidental — every
gate needing a tool the control container lacks (`pytest`, `cargo`, a C
compiler) fails this way, every time, for that project.

## Decision

**1. A gate the host verification environment cannot run returns no verdict, and
"no verdict" is not "failed".**

Post-merge verification classifies a failed gate before acting on it. When the
recorded command result proves the environment could not run the command at all
— exit 127 with a missing-executable marker, or a driver reporting that the
requested build mode is unavailable (cgo disabled, no C compiler, an
instrumentation mode unsupported on this platform) — the gate is recorded as
**unverified on host** and integration continues on the Protected verdict it
already holds.

This follows the execution environment disclosure invariant already in force:
an infrastructure fault MUST NOT consume an automatic repair round and MUST NOT
discard a verified executable payload. It is not a gate relaxed to make it pass:
the gate ran, in full, against this exact candidate, in the Protected runner.
What is missing is the host-side corroboration, and that absence is reported
rather than hidden — `integration.verification_unsupported` per gate, plus
`unverified_host_gates` on the terminal `host.applied` event.

**2. The classification is narrow, and silence defaults to failure.**

Only positively recognized environment diagnostics qualify. An ordinary test
failure, a detected data race, a compile error in the merged result, or a runner
error (timeout, cancellation) remains an ordinary post-merge failure that
reverts the host. Classifying too widely would put genuinely unverified code on
the host, which is strictly worse than the defect being fixed.

**3. Skipping is the fallback; parity is the intent.**

The control container gains a C toolchain (`build-base`), so the cgo-dependent
Go gates — `-race` above all, which `AGENTS.md` §5 lists as a required gate —
actually run against the merged host tree instead of being skipped. The
inventory of that container is now load-bearing for verification, not only for
Wharnex's own lifecycle, and MUST be kept wide enough for the gates the projects
it hosts declare.

## Consequences

- A verified candidate is no longer destroyed by a gap in Wharnex's own
  container, and no repair round is spent on a condition a patch cannot reach.
- An Apply may complete with strictly less host-side corroboration than before.
  That is now explicit in the event stream instead of being traded silently.
- The control container is larger. This is the accepted cost of running the
  project's real gates against the real merged result.
- Wharnex still keeps no parallel list of installed tools: the classification
  reads the failing command's own output, never an inventory it maintains.

## Alternatives rejected

- **Run the gate and fail, with better classification only.** It names the cause
  but still reverts a verified change and still blocks every project whose
  toolchain the control container lacks.
- **Run post-merge verification inside the runner image, bound to the host
  tree.** True parity, but it points a container at the operator's real project
  directory and writes build caches into it. That is a sandbox-model change
  needing its own decision; it remains the candidate for a future revision.
- **Baseline attribution on the host path** (re-running the gate at the
  pre-merge commit and comparing, as `SoT/ERROR_MODEL.md` mandates for sandbox
  verification). Strictly more general — it would also absolve pre-existing red
  gates on host — but it requires reverting and re-merging inside an Apply, or a
  throwaway worktree, and it does not remove the need for parity. Deferred, not
  declined.
