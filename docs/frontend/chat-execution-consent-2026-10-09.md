# Chat consent and extraction execution visibility

Chat now offers informed execution and debug approval for its own current
validated plan. It displays exact argv/typed operations, target, network,
rationale and Policy effects/host impact before the human action. The Chat and
Plan surfaces share `ExecutionConsentAction` and their existing callbacks;
there is no additional grant or host-Apply approval. Successful, running,
policy-denied and stale chat/session bindings cannot expose the action.
Sudo remains host-direct only, ephemeral, and clears after the attempt.

Execução now includes `execution.recorded` and typed interactive operation
results. The projection rebuilds missing command cards and both bounded/redacted
streams after live event expiry or workflow continuation clears the snapshot.
It reconciles live/recorded results by plan, timestamps and ordered argv/cwd
occurrence, preserves repeated commands, and shows exact argv, exit status,
duration, rationale and typed-operation error/truncation/redaction evidence.
New output expands automatically; explicit collapse stays respected.
The inspector refreshes its durable ledger for every request/continuation id,
including rounds sharing one Main Request root, so the bounded live event window
cannot erase rounds received after the initial history fetch. Outgoing session
history is hidden while the newly selected chat is still loading. Human PTY
output remains outside the Agent history.

The historical workflow bug writing `plan_id` in the ledger's `request_id` was
reported to the backend owner. Frontend legacy reads resolve that identity from
`plan.recorded`; new backend records must carry the real request identity.

New UI uses Tailwind theme tokens. The maintained ExecutionApprovalPanel styles
were migrated and their old selectors removed. Named styling exception:
existing Execução card/output layout remains unchanged; the exact-argv child
alone uses new Tailwind styling. Shared interrupted-recovery credential CSS and
unrelated Plan controls remain untouched. Extracted consent/composition/evidence
files are focused and below 200 lines; legacy Inspector/ChatPanel/AgentWorkspace
retain unrelated existing concerns as follow-up debt.

Verification evidence lives in `.harness/maintenance/chat-execution-20261009/`.
Focused consent, owner-binding, historical/live extraction, repeated commands,
stream separation and recovery tests pass. Typecheck, scoped lint and production
build pass. Offline Playwright QA passed Light/Dark at 960px and Dark at 420px,
with no horizontal page overflow or browser errors; argv/stdout/stderr all visible.
Full lint still reports the three known pre-existing Drawio errors. Full suite ran against the evolving source: 79 failures/1203 passes across
50 failed/247 passing files. It reproduced 58 fixed-baseline cases. Two own
failures came from source loaded before the RFC3339 and optional-handler fixes;
final focused tests cover both fixes, including the unchanged seven original
Plan adjustment assertions. Two effort source assertions are independently
known baseline debt. Of the other 17 differences, 15 pass isolated recheck and
library/pagination fail identically in baseline and current checkouts. No
assertion, test or timeout was weakened/deleted. The full suite is not green.

This change was built and reviewed locally; it did not restart Desktop, backend
or containers. Activation belongs to the coordinating session after current
provider submissions and Protected integration settle.

Read-only real-history validation used 3254 events from the original chat:
seven ledger executions contain 18 argv commands plus 11 typed operations.
Removing every live command event and clearing the snapshot still renders
18 argv cards and 11 typed result cards. First/second projection preserve the
same 18 command ids/run ids. Five historical request_id=plan_id records resolve
to their request ids using the plan ledger. Metrics contain counts/identities
only; command outputs were not copied into the QA report.
