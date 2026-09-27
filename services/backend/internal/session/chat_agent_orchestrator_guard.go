package session

// A project has one mutation slot. A READY Orchestrator task may be claimed
// only when no other execution Worker owns that slot and no other Orchestrator
// task is DOING. The current task remains claimable between observations.
func chatAgentOrchestratorExecutionBlockedSQL(alias string) string {
	return `(` + alias + `.type='ORCHESTRATOR_EXECUTE' AND (
		EXISTS (SELECT 1 FROM harness_tasks o
			WHERE o.source='orchestrator' AND o.project_id=` + alias + `.project_id
			AND o.status='DOING' AND o.task_id<>` + alias + `.chat_id)
		OR EXISTS (SELECT 1 FROM harness_chat_agent_tasks busy
			WHERE busy.type='ORCHESTRATOR_EXECUTE' AND busy.project_id=` + alias + `.project_id
			AND busy.task_id<>` + alias + `.task_id AND busy.status IN ('LEASED','RUNNING')
			AND (busy.lease_expires_at IS NULL OR busy.lease_expires_at>now()))
	))`
}
