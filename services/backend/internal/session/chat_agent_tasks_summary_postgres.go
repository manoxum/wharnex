package session

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// postgresChatAgentQueueSummary partitions one pass over the live queue into
// this project's work and everybody else's, so the scoped counters and the
// other-project total can never be computed from two different readings.
func (s *Store) postgresChatAgentQueueSummary(projectID string) (ChatAgentQueueSummary, error) {
	rows, err := s.db.Query(`WITH classified AS (
		SELECT t.status,t.not_before,t.attempt,t.max_attempts,t.created_at,
			($1='' OR t.project_id=$1) AS mine,
			((NOT `+chatAgentTaskForSupervisorSQL("t")+` AND NOT `+chatAgentTaskEphemeralSQL("t.type")+` AND EXISTS (
				SELECT 1 FROM harness_chat_agent_provider_state p
				WHERE p.provider='chatgpt' AND p.paused=true
				  AND (p.paused_until IS NULL OR p.paused_until>now())
			)) OR `+chatAgentBlockedByActiveTaskSQL("t")+`) AS guarded
		FROM harness_chat_agent_tasks t
		WHERE t.status IN ('PENDING','LEASED','RUNNING','WAITING')
	)
		SELECT status, count(*) FILTER (WHERE mine),
			count(*) FILTER (WHERE mine AND not_before<=now() AND attempt<max_attempts AND NOT guarded),
			count(*) FILTER (WHERE mine AND not_before>now() AND attempt<max_attempts),
			count(*) FILTER (WHERE mine AND not_before<=now() AND attempt<max_attempts AND guarded),
			count(*) FILTER (WHERE mine AND attempt>=max_attempts),
			min(created_at) FILTER (WHERE mine AND not_before<=now() AND attempt<max_attempts AND NOT guarded),
			min(not_before) FILTER (WHERE mine AND not_before>now() AND attempt<max_attempts),
			count(*) FILTER (WHERE NOT mine)
		FROM classified GROUP BY status`, projectID)
	if err != nil {
		return ChatAgentQueueSummary{}, fmt.Errorf("summarize chat agent queue: %w", err)
	}
	defer rows.Close()
	summary := ChatAgentQueueSummary{Counts: make(map[string]int)}
	for rows.Next() {
		var status string
		var total, due, scheduled, guarded, blocked, others int
		var oldestDue, nextNotBefore sql.NullTime
		if err := rows.Scan(&status, &total, &due, &scheduled, &guarded, &blocked, &oldestDue, &nextNotBefore, &others); err != nil {
			return ChatAgentQueueSummary{}, fmt.Errorf("scan chat agent queue summary: %w", err)
		}
		// A settled task has left the queue; only work still in it is depth.
		if !chatAgentTaskActive(status) {
			continue
		}
		summary.OtherProjects += others
		summary.Queued += total
		// A status group can exist purely because another project holds work in
		// it. Recording a zero would publish a state this project is not in.
		if total > 0 {
			summary.Counts[status] = total
		}
		// Only the claimable statuses carry backlog semantics; a LEASED or
		// RUNNING task is already being worked.
		if !chatAgentTaskClaimable(status) {
			continue
		}
		summary.Due += due
		summary.Scheduled += scheduled
		summary.Guarded += guarded
		summary.Blocked += blocked
		if oldestDue.Valid {
			summary.OldestDueCreatedAt = earliest(summary.OldestDueCreatedAt, oldestDue.Time)
		}
		if nextNotBefore.Valid {
			summary.NextNotBefore = earliest(summary.NextNotBefore, nextNotBefore.Time)
		}
	}
	if err := rows.Err(); err != nil {
		return ChatAgentQueueSummary{}, err
	}
	lanes, dueWorker, dueTranslator, dueWorkerByType, err := s.postgresChatAgentDueByRole(projectID)
	if err != nil {
		return ChatAgentQueueSummary{}, err
	}
	summary.DueSupervisorLanes = lanes
	summary.DueWorker = dueWorker
	summary.DueWorkerByType = dueWorkerByType
	summary.DueTranslator = dueTranslator
	return summary, nil
}

// postgresChatAgentDueByRole splits the claimable backlog the way the two pools
// are partitioned, because neither pool can be sized from the shared total.
//
// It is a second statement rather than another column on the summary query
// because that query groups by status: a chat holding one due PENDING and one
// due WAITING task is one lane, and summing a per-status DISTINCT would report
// it as two and grow the pool against a conversation one slot already serves.
func (s *Store) postgresChatAgentDueByRole(projectID string) (int, int, int, map[string]int, error) {
	row := s.db.QueryRow(`WITH due AS (
		SELECT t.type,t.chat_id,t.conversation_id
		FROM harness_chat_agent_tasks t
		WHERE t.status IN ('PENDING','WAITING')
		  AND ($1='' OR t.project_id=$1)
		  AND t.not_before<=now() AND t.attempt<t.max_attempts
		  AND NOT ((NOT `+chatAgentTaskForSupervisorSQL("t")+` AND NOT `+chatAgentTaskEphemeralSQL("t.type")+` AND EXISTS (
			SELECT 1 FROM harness_chat_agent_provider_state p
			WHERE p.provider='chatgpt' AND p.paused=true
			  AND (p.paused_until IS NULL OR p.paused_until>now())
		  )) OR `+chatAgentBlockedByActiveTaskSQL("t")+`)
	)
		SELECT
			count(DISTINCT CASE WHEN `+chatAgentTaskForSupervisorSQL("due")+`
				THEN CASE WHEN coalesce(conversation_id,'')<>'' THEN 'conversation:'||conversation_id ELSE 'chat:'||coalesce(chat_id,'') END END),
			count(*) FILTER (WHERE NOT `+chatAgentTaskForSupervisorSQL("due")+` AND NOT `+chatAgentTaskEphemeralSQL("type")+`),
			count(*) FILTER (WHERE `+chatAgentTaskEphemeralSQL("type")+`),
			coalesce((SELECT jsonb_object_agg(type, task_count) FROM (
				SELECT type, count(*) AS task_count FROM due
				WHERE NOT `+chatAgentTaskForSupervisorSQL("due")+` AND NOT `+chatAgentTaskEphemeralSQL("type")+`
				GROUP BY type
			) worker_counts), '{}'::jsonb)
		FROM due`, projectID)
	var lanes, dueWorker, dueTranslator int
	var byTypeJSON []byte
	if err := row.Scan(&lanes, &dueWorker, &dueTranslator, &byTypeJSON); err != nil {
		return 0, 0, 0, nil, fmt.Errorf("summarize chat agent due work by role: %w", err)
	}
	byType := make(map[string]int)
	if err := json.Unmarshal(byTypeJSON, &byType); err != nil {
		return 0, 0, 0, nil, fmt.Errorf("decode chat agent due work by type: %w", err)
	}
	return lanes, dueWorker, dueTranslator, byType, nil
}

func (s *Store) postgresPruneChatAgentTasks(before time.Time) (int, error) {
	result, err := s.db.Exec(`DELETE FROM harness_chat_agent_tasks
		WHERE status IN ('DONE','FAILED','CANCELLED') AND updated_at<$1`, before)
	if err != nil {
		return 0, fmt.Errorf("prune chat agent tasks: %w", err)
	}
	count, _ := result.RowsAffected()
	return int(count), nil
}
