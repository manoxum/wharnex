# Project execution audit logs

- The project-wide **Execuções** view must use the durable backend audit history as its primary source. Reconstructing a timeline only from `ExecutionResult` loses transport, Policy, repair, verification, workflow and host-Apply events.
- Historical logs are loaded on demand as a bounded snapshot (currently the 2,000 most recent session events). For the active chat, merge that snapshot with the live SSE event cache and de-duplicate by event id.
- Execution scope is correlated by `plan_id`, `request_id`, or `root_request_id`; a separate whole-session scope is useful when diagnosing lifecycle failures that are not attached directly to a plan.
- Raw event details may be exposed to the operator only from the existing audit stream, which already applies audit sanitization/redaction and per-string truncation. `ExecutionResult` remains a compatibility fallback when durable history is unavailable.
