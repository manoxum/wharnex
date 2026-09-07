# ADR-0030 — Host dependency state remediation

## Status

Accepted.

## Context

`domain.FailureKindHostDependencyState` already recognizes a specific host-only failure: a candidate that already passed Protected sandbox verification fails again on the real host because a platform-specific npm optional/native binding never installed correctly under the host's own `node_modules` — the npm optional-dependencies bug tracked as npm/cli#4828, first observed with `rolldown`'s native binding on a real project (SGDP-DEPLOY's `sgdp-formatter` service). By design, this classification already stops Wharness from spending an automatic ChatGPT repair round on it: no source patch can repair host package-manager state.

That design was correct but incomplete. The only outcome exposed to the human was a static notice telling them to fix `node_modules` manually, outside Wharness, and click Apply again. In production this produced a real dead end: the same session retried Apply seven times across roughly ninety minutes, hitting the identical diagnostic every time, because the host's corrupted `node_modules` is never touched by the `git reset --hard` that undoes a failed post-merge verification (`node_modules` is untracked) — the underlying host state simply never changed between attempts.

Wharness already has an established precedent for exactly this shape of problem: `RetryDependencyNetwork` (see `SANDBOX_MODEL.md`, AGENTS.md §3) pauses locally on a classified offline Go module cache failure, requires an explicit human approval, then runs one fixed, hand-reviewed recovery command — never a planner-supplied one.

## Decision

1. `RetryHostDependencyRepair` extends the same pattern to `host_dependency_state`. On explicit human approval it runs a fixed, closed recipe directly against the host project directory — never the sandbox, never a planner-supplied command:
   - `rm -rf node_modules`
   - `rm -f package-lock.json`
   - `npm install`
2. The recipe's working directory comes only from Wharness's own verified pending-plan data (the failing `npm`/`npx`/`node` verification command's `cwd`), never from planner or project text.
3. Each command is evaluated by the same policy profile as the interactive Host terminal (`Engine.EvaluateInteractiveCommand`) — argv-only, no shell, no `sudo`/`su`/privilege escalation, no host-management primitives. This is deliberate reuse, not a new allowlist: that profile already permits ordinary project mutations (`rm`, `npm`) while denying everything AGENTS.md §3 requires denied.
4. `npm install` is the only command in the recipe with network access; that is exactly the scope human approval grants, mirroring the Go case's narrow network grant.
5. After the recipe runs, Wharness reruns the exact verification commands that failed post-merge. If they now pass, the failure classification clears and Apply is retried automatically — no second manual click. If they still fail, the (now-inapplicable) `host_dependency_state` label is cleared and the concrete new error is surfaced, instead of re-blocking under a reason that no longer applies. This recovery spends exactly one attempt per human approval; it never loops on its own.
6. This recipe is closed and specific to the diagnosed npm optional-dependency defect. A host-only failure Wharness cannot recognize still blocks with only a manual notice — unchanged from before this ADR.

## Consequences

- The dead end observed in production is resolved for this specific, already-classified diagnostic: a human can approve one batch of visible commands and Wharness carries the fix through to a repeated Apply, without spending another ChatGPT round.
- No new trust boundary is introduced: every command in the recipe is fixed at compile time and hand-reviewed, exactly like the Go module download precedent. Nothing here accepts a planner-proposed command, and no `sudo`/privileged command is ever included.
- This does **not** generalize to host-only failures Wharness cannot classify today. A fallback that negotiates remediation commands with the planner for genuinely novel host-environment failures was deliberately scoped out: it would require a new non-terminal `harness.turn/v1` kind, a new closed-allowlist validation in `internal/protocol` for planner-*proposed* (not Wharness-fixed) commands, and its own ADR-level review of that larger trust boundary. Tracked as explicit future work, not implied by this change.
- `sudo`/elevated host commands remain out of scope entirely. AGENTS.md §3 rejects privilege-escalation tooling from model plans; extending any approval-gated recovery to elevated commands is a distinct decision this ADR does not make.
