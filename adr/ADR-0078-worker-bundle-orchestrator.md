# ADR-0078 — Orchestrator planning uses Worker request and response bundles

## Decision

`ORCHESTRATOR_PLAN` belongs to the persistent Worker pool. The durable claim
partition routes it there before an attempt is charged. The Agent's
`BOT_WRITE`, `RECOVERY_WRITE`, and `AWAIT_RESPONSE` remain on chat-bound
Supervisors.

New Orchestrator planning exchanges upload one canonical request ZIP. It
contains a transport manifest, the backend-authored planning prompt, and any
bounded project context and attachments. The composer contains only a short
bootstrap naming that ZIP and the exact response ZIP. A Worker follows the
conversation until it can download that response, then sends the bytes
unchanged to the backend Orchestrator bundle validator. Re-delivery after an
expired artifact is another bounded request ZIP in the same conversation.
When a bounded observation confirms the response is still being generated,
the Worker keeps that conversation resident through its durable `WAITING`
interval. The next observation resumes the already loaded page; an idle-lane
release must not force a cross-chat navigation while the bundle is being made.

When the strict validator refuses an Orchestrator execution `plan.json`
only because of one unknown field, the Worker MAY ask for a corrected ZIP in
the same conversation, at most three times per task. The correction prompt
carries only that bounded field name and the exact expected filename, never
bytes or prose from the rejected bundle. A corrected download must come from
a newer assistant turn. The validator stays strict; a field the plan schema
allows MUST also be accepted by the decoder, or no correction can succeed.

`TRANSLATE_MARKDOWN` remains on its one-task Translator Worker, and
`RELEASE_NOTES` remains on a persistent Worker; both already exchange request
and response ZIPs. This change does not grant any of these tasks command,
patch, or Apply authority.

Workers attempt the requested reasoning level before submit. The hidden
renderer can leave the native effort menu closed despite a bounded press on
the structurally located control. Utility and Orchestrator Workers then record
the level as unconfirmed and may submit at the current account level; the
strict response ZIP validator remains mandatory. Agent Supervisors retain
their verified-effort precondition. The release-notes HTTP waiter covers its
three bounded Worker attempts, including claim and pacing before each
response window.
For a hidden Worker's effort picker, Desktop MAY temporarily emulate an active
page through the Chrome DevTools Protocol while dispatching its bounded,
trusted control events. It MUST clear that emulation afterward, and MUST NOT
focus the remote WebContents or move the operating-system pointer.

## Compatibility

An Orchestrator task checkpointed under the historical JSON result contract
continues to finish through that exact JSON artifact. New tasks use the ZIP
pair. Existing durable task identities, leases, and response import endpoints
do not change.

## Worker viewport during automation

The native **Interagir aqui** pane resizes the same WebContentsView into a
small responsive viewport. A running task must keep the hidden 1280×900
automation viewport, so opening that pane during a task is refused. A Worker
already in direct interaction skips new claims. A hidden WebContentsView does
not reliably deliver compositor or renderer screenshots, even under bounded
capture deadlines. Live follow therefore attaches that same view to a
separate user-opened 1280×900 window. The Worker keeps its conversation and
scheduler lease, and closing the window parks it again without a navigation.
The monitor creates no additional ChatGPT WebContents and does not read or
persist generated output.
The monitor closes when that Worker's task settles, and the Orchestrator panel
tracks the task identity so it cannot keep showing a finished or reassigned
Worker. A restored conversation may already contain its exact response ZIP
while the saved assistant-turn count equals the live count. Artifact Workers
therefore probe the exact file affordance independently of that count and
retry a click only after a bounded wait if no download starts. A started
download stops further clicks; ChatGPT's generated-file card is considered
when locating the exact control.

## Attempt accounting for execution tasks

An execution attempt whose Orchestrator task is no longer READY or DOING —
already in REVIEW, FAILED, moved back or archived — settles when it starts.
`worker-start` reports that status instead of an error, because an error
returned the attempt to the queue to be claimed again indefinitely.
After an accepted response bundle leaves the task DOING, the Agent's next
round (workflow evidence, repair, continuation) is bounded by the task's
effort level exactly as in an agentic Main Request. Reaching it is an
observation and does not spend the Worker's transport attempt budget.

When a response window ends with no bundle and no sign of generation, the
Worker sends the agentic delivery continuation in the same conversation, at
most twice, before raising attention. An attempt that ends in ATTENTION holds
no lease and delivers nothing further, so it ends the task's run like FAILED:
the task leaves DOING with that error instead of staying there unserved.
