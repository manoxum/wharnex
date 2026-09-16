# Auto-evolution bundle-engine incident — 2026-09-16

## Scope

Correlated workspace hash: `4b746dee87244f8d1c183a7faae6c5cdee03cac11ae49a0d64a861a300ab193d`.

- Chat `b3757675-a5eb-49ee-b326-832032272fdb`
- Chat `827a1f1a-d86f-4a17-b9fd-4dbabfb6d62e`
- Chat `b4461847-ab18-45b6-ba5b-f0a947bf114d`

## Evidence and conclusions

The first chat needed several repair rounds. A concurrent automatic trigger also reached the same plan while its durable execution intent was still active and emitted a misleading `automation.execution_failed`. Later `BOT_WRITE` tasks exhausted six attempts because MinIO returned `XMinioStorageFull`; the UI and task history obscured that local capacity failure behind generic transport guidance.

The dirty host worktree was not discarded. Wharnex captured it in snapshot commit `7cfeead` before merging the verified candidate as `a257df0`; the final version commit was `fe96e23`. The third chat was subsequently integrated as `b2e418b` and versioned by `cc918f5`; the second chat's repair was integrated as `f37b905` and versioned by `bdc5b2c`. The usability defect was lack of visible provenance, not loss of files.

The long-chat reproduction mounted every page ever loaded. A 200-item transcript grew to 200 live message articles, explaining progressively heavier scroll and chat switching even though Markdown parsing was memoized and CSS paint containment was enabled.

The native Engine view is an Electron `WebContentsView`, so renderer z-index cannot cover it. Overlay detection previously waited for a React state commit and effect before hiding the native view, leaving a compositor race. Closing the last project exposed a second lifecycle gap: the project renderer unmounted while its Supervisor or an interactive Worker was still visible, allowing the native surface to cover the project chooser.

## Permanent rules

- Artifact-capacity errors retain their machine code, run one bounded expired-artifact cleanup/retry, then enter human attention without blind provider retries.
- A second Auto trigger for the same recorded plan execution joins that intent; it is not a new failure or repair round.
- Transcript history remains durable, while its mounted DOM is a bidirectional bounded window.
- A trusted overlay hides the native view directly from the mutation-observer callback.
- Closing or switching the active project hides its Supervisor and interactive Worker in Desktop before project ownership changes; this does not retire background supervision.
- Dirty host state is integrated only after a named snapshot commit is recorded in the durable ledger; diagnostics must report that commit when users question preservation.

## Regression coverage

- Long transcript traversal asserts no more than 60 message articles are mounted and that newer history remains reachable.
- Scheduler classification asserts `artifact_storage_full` transitions directly to attention on attempt one.
- Execution single-flight exposes a typed `ErrExecutionInProgress`, allowing Auto convergence to be distinguished from execution failure.
- Existing native-overlay tests verify hide/restore behavior; the implementation now removes the React-effect delay from the hide path.
