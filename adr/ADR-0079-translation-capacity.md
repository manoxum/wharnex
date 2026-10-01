# ADR-0079 — Translation capacity follows due work

- Status: Accepted; amended by `adr/ADR-0082` (Workers no longer claim translations; the utility pool never counts free Workers as capacity)
- Related: `adr/ADR-0036`, `adr/ADR-0052`, `SoT/ARCHITECTURE.md`.

## Context

The Translator already owned one ephemeral hardened browser per claimed task,
but its scheduler had exactly one claim loop. Two due translations therefore ran
serially even when persistent Workers were idle or at their configured ceiling.
The dedicated role remains necessary because translation uses a different
provider cadence and must run while ordinary Workers are suspended.

## Decision

An idle persistent Worker may claim the highest-priority translation first.
The Translator scheduler grows to one loop for every due translation beyond
eligible free Worker capacity plus one for each translation already running
there. The backend's `translator-N` identity
range bounds simultaneous loops at 64. Every claim creates a task-owned browser
and destroys it after settlement. The pool returns to one idle claim loop when
the queue drains. Persistent Worker limits and suspension do not constrain overflow.
The global translation pacer still applies to each provider action, so adding
browsers does not bypass provider pacing or authentication gates.

The durable queue remains the source of eligibility. Deferred, guarded, and
leased tasks are excluded from due demand; active tasks retain their loop until
they settle.
