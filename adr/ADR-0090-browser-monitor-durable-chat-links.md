# ADR-0090 — Durable ChatGPT links in the browser monitor

Status: Accepted (2026-10-05)

## Context

The process-global browser monitor originally listed only live Supervisor and
Worker views. A conversation whose view had been released disappeared from that
list even though its workspace chat or Orchestrator task and bundle history
remained durable. The native view also painted above the bundle explorer modal.

## Decision

The monitor has separate **Instâncias** and **Links GPT** tabs. The link catalog
is read-only backend data: created workspace chats, Orchestrator planning
conversations and Orchestrator task conversations across known projects. It
returns only canonical ChatGPT conversation URLs and local recorded titles.
Archived chats remain visible.
Project-scoped `/g/g-p-…/c/<id>` addresses canonicalize to `/c/<id>` so
resident project conversations still match their durable catalog records.

A selected link already loaded in a real Agent view presents that same view.
Otherwise an explicit operator click creates at most one short-lived, human-only
ChatGPT `WebContentsView` in the trusted monitor. This view uses the dedicated
partition and hardened renderer preferences but joins neither Agent pool nor
the scheduler. It has no transport, account-automation, bundle polling or
remote-content observation. IPC is named and monitor-window-only; URL and
bounds are validated in the main process. New windows and cross-origin
navigation are denied. Switching links or suspending/closing the monitor
destroys the temporary view.

Details use the selected local chat/task as the bundle ownership key. Worker
execution bundles are resolved through the task-run detail lineage instead of
assuming that the queue chat ID is a Harness Session chat ID. Bundles are the
last details section. Opening their explorer first releases the native view,
then draws the modal. The explorer inherits the saved local UI theme.

## Consequences and compatibility

No schema, wire protocol, existing pool capacity, task lease or persisted
identifier changes. Existing Agent presentation remains a visibility operation
without navigation. The human-only temporary view may issue one authenticated
provider navigation when a non-resident link is explicitly selected; it never
does so on background refresh. Legacy Desktop IPC names remain compatibility
boundaries; new monitor-link calls are separate narrow operations.
