package session

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ChatAgentQueueSummary is the aggregate the runtime queue view is drawn from.
//
// It exists because a queue cannot be counted by listing it. The task table
// retains every terminal row and the list endpoint is ordered oldest-first and
// capped, so once enough work has completed that window holds nothing but DONE
// rows and the live queue disappears from the view entirely. Aggregating in the
// store is exact at any table size and does not ship task payloads to a caller
// that only wants counts.
type ChatAgentQueueSummary struct {
	// Queued and Counts describe the queue itself — only work that is still in
	// it. A settled task (DONE, FAILED, CANCELLED, ATTENTION) has left the
	// queue and is history, not depth: counting it told the operator about
	// yesterday's throughput while saying nothing about what is waiting now.
	Queued int            `json:"queued"`
	Counts map[string]int `json:"counts"`
	// Due, Scheduled, Guarded and Blocked partition the claimable statuses
	// (PENDING/WAITING) by the very predicate the claim query uses, so the
	// reported backlog is the backlog a worker could actually take.
	//
	// The distinction is the point: a task deferred behind its own not_before
	// is waiting for a clock, not for a worker. Reporting it as pending
	// backlog is what makes a completely idle queue read as a stuck one.
	Due       int `json:"due"`
	Scheduled int `json:"scheduled"`
	// Guarded work has reached not_before and has attempt budget, but cannot
	// run until a provider, account or conversation exclusivity guard clears.
	// It is not Worker backlog: adding Workers cannot make it claimable.
	Guarded int `json:"guarded"`
	// DueSupervisorLanes counts the distinct chats holding claimable
	// Supervisor-owned work, and DueWorker the claimable Worker-owned tasks.
	//
	// Total `Due` cannot size either pool, because the two pools own disjoint
	// task types and a Supervisor is bound to one chat for the life of its
	// request. Ten due tasks in one conversation still need exactly one
	// Supervisor; two conversations need two. Counting tasks rather than lanes
	// would grow the pool against work a single slot already serves, and
	// counting the shared total would grow the Supervisor pool because a
	// library cleanup is queued.
	DueSupervisorLanes int `json:"due_supervisor_lanes"`
	DueWorker          int `json:"due_worker"`
	// Blocked counts tasks that are past their attempt budget and can never be
	// claimed again. They are backlog that will never drain, which is a
	// different operational fact from work that is merely waiting.
	Blocked int `json:"blocked"`
	// OldestDueCreatedAt ages the oldest *claimable* task. A deferred task has
	// no meaningful age — it is early, not late — so it never contributes.
	OldestDueCreatedAt *time.Time `json:"oldest_due_created_at,omitempty"`
	// NextNotBefore is when the earliest deferred task wakes up.
	NextNotBefore *time.Time `json:"next_not_before,omitempty"`
	// OtherProjects counts active tasks outside the requested project, and is
	// meaningful only when one was requested.
	//
	// It is a bare number on purpose. The agent pool is shared across projects,
	// so an operator whose own queue is empty still needs to know the pool is
	// busy elsewhere — but the identity of that work belongs to the project
	// that owns it, not to whoever happens to be looking at this panel.
	OtherProjects int `json:"other_projects"`
}

func chatAgentTaskClaimable(status string) bool {
	return status == ChatAgentTaskPending || status == ChatAgentTaskWaiting
}

func earliest(current *time.Time, candidate time.Time) *time.Time {
	if candidate.IsZero() {
		return current
	}
	if current == nil || candidate.Before(*current) {
		value := candidate
		return &value
	}
	return current
}

// ChatAgentQueueSummary reports queue depth without materializing the queue.
//
// projectID scopes every counter to one project, so a project-scoped panel's
// totals describe the same queue as its cards. An empty projectID reports the
// whole account-wide queue, which is what the global runtime diagnostics want.
func (s *Store) ChatAgentQueueSummary(projectID string) (ChatAgentQueueSummary, error) {
	project := normalizeChatAgentProjectID(projectID)
	// Like the list, a project filter fails closed: degrading an unusable value
	// to "" would publish the whole account's backlog to one project's panel.
	if project == "" && strings.TrimSpace(projectID) != "" {
		return ChatAgentQueueSummary{Counts: map[string]int{}}, nil
	}
	if s.db != nil {
		return s.postgresChatAgentQueueSummary(project)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	now := time.Now().UTC()
	summary := ChatAgentQueueSummary{Counts: make(map[string]int)}
	supervisorLanes := make(map[string]struct{})
	providerGuarded := s.chatAgentProvider.Paused &&
		(s.chatAgentProvider.PausedUntil == nil || s.chatAgentProvider.PausedUntil.After(now))
	for _, task := range s.chatAgentTasks {
		if !chatAgentTaskActive(task.Status) {
			continue
		}
		if project != "" && task.ProjectID != project {
			summary.OtherProjects++
			continue
		}
		summary.Queued++
		summary.Counts[task.Status]++
		if !chatAgentTaskClaimable(task.Status) {
			continue
		}
		switch {
		case task.Attempt >= task.MaxAttempts:
			summary.Blocked++
		case task.NotBefore.After(now):
			summary.Scheduled++
			summary.NextNotBefore = earliest(summary.NextNotBefore, task.NotBefore)
		case providerGuarded || chatAgentBlockedByActiveTask(task, s.chatAgentTasks, now):
			summary.Guarded++
		default:
			summary.Due++
			if chatAgentTaskSupervisor(task.Type) {
				supervisorLanes[chatAgentTaskLaneKey(task)] = struct{}{}
			} else {
				summary.DueWorker++
			}
			summary.OldestDueCreatedAt = earliest(summary.OldestDueCreatedAt, task.CreatedAt)
		}
	}
	summary.DueSupervisorLanes = len(supervisorLanes)
	return summary, nil
}

// chatAgentTaskLaneKey names the conversation a Supervisor would have to hold to
// serve this task. A chat with no conversation yet is still its own lane: the
// first write is what creates the conversation, and two chats in that state
// genuinely need two slots.
func chatAgentTaskLaneKey(task ChatAgentTask) string {
	if id := strings.TrimSpace(task.ConversationID); id != "" {
		return "conversation:" + id
	}
	return "chat:" + strings.TrimSpace(task.ChatID)
}

// PruneChatAgentTasks deletes terminal task rows settled before the cutoff.
//
// Terminal rows are operational bookkeeping, not audit evidence: durable
// request history lives in harness_events. Nothing reads them back either —
// the active dedupe index, the lineage guard and the child-task lookup all
// filter to non-terminal statuses — so retaining them forever only grows the
// table every queue read has to work around.
func (s *Store) PruneChatAgentTasks(before time.Time) (int, error) {
	if before.IsZero() {
		return 0, nil
	}
	if s.db != nil {
		return s.postgresPruneChatAgentTasks(before)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	removed := 0
	for id, task := range s.chatAgentFallback() {
		if chatAgentTaskActive(task.Status) || !task.UpdatedAt.Before(before) {
			continue
		}
		delete(s.chatAgentTasks, id)
		removed++
	}
	return removed, nil
}

// postgresChatAgentQueueSummary partitions one pass over the live queue into
// this project's work and everybody else's, so the scoped counters and the
// other-project total can never be computed from two different readings.
func (s *Store) postgresChatAgentQueueSummary(projectID string) (ChatAgentQueueSummary, error) {
	rows, err := s.db.Query(`WITH classified AS (
		SELECT t.status,t.not_before,t.attempt,t.max_attempts,t.created_at,
			($1='' OR t.project_id=$1) AS mine,
			(EXISTS (
				SELECT 1 FROM harness_chat_agent_provider_state p
				WHERE p.provider='chatgpt' AND p.paused=true
				  AND (p.paused_until IS NULL OR p.paused_until>now())
			) OR `+chatAgentBlockedByActiveTaskSQL("t")+`) AS guarded
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
	lanes, dueWorker, err := s.postgresChatAgentDueByRole(projectID)
	if err != nil {
		return ChatAgentQueueSummary{}, err
	}
	summary.DueSupervisorLanes = lanes
	summary.DueWorker = dueWorker
	return summary, nil
}

// postgresChatAgentDueByRole splits the claimable backlog the way the two pools
// are partitioned, because neither pool can be sized from the shared total.
//
// It is a second statement rather than another column on the summary query
// because that query groups by status: a chat holding one due PENDING and one
// due WAITING task is one lane, and summing a per-status DISTINCT would report
// it as two and grow the pool against a conversation one slot already serves.
func (s *Store) postgresChatAgentDueByRole(projectID string) (int, int, error) {
	row := s.db.QueryRow(`WITH due AS (
		SELECT t.type,t.chat_id,t.conversation_id
		FROM harness_chat_agent_tasks t
		WHERE t.status IN ('PENDING','WAITING')
		  AND ($1='' OR t.project_id=$1)
		  AND t.not_before<=now() AND t.attempt<t.max_attempts
		  AND NOT (EXISTS (
			SELECT 1 FROM harness_chat_agent_provider_state p
			WHERE p.provider='chatgpt' AND p.paused=true
			  AND (p.paused_until IS NULL OR p.paused_until>now())
		  ) OR `+chatAgentBlockedByActiveTaskSQL("t")+`)
	)
		SELECT
			count(DISTINCT CASE WHEN `+chatAgentTaskSupervisorSQL("type")+`
				THEN CASE WHEN coalesce(conversation_id,'')<>'' THEN 'conversation:'||conversation_id ELSE 'chat:'||coalesce(chat_id,'') END END),
			count(*) FILTER (WHERE NOT `+chatAgentTaskSupervisorSQL("type")+`)
		FROM due`, projectID)
	var lanes, dueWorker int
	if err := row.Scan(&lanes, &dueWorker); err != nil {
		return 0, 0, fmt.Errorf("summarize chat agent due work by role: %w", err)
	}
	return lanes, dueWorker, nil
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
