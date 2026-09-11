package session

import (
	"database/sql"
	"fmt"
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
	// Due, Scheduled and Blocked partition the claimable statuses
	// (PENDING/WAITING) by the very predicate the claim query uses, so the
	// reported backlog is the backlog a worker could actually take.
	//
	// The distinction is the point: a task deferred behind its own not_before
	// is waiting for a clock, not for a worker. Reporting it as pending
	// backlog is what makes a completely idle queue read as a stuck one.
	Due       int `json:"due"`
	Scheduled int `json:"scheduled"`
	// Blocked counts tasks that are past their attempt budget and can never be
	// claimed again. They are backlog that will never drain, which is a
	// different operational fact from work that is merely waiting.
	Blocked int `json:"blocked"`
	// OldestDueCreatedAt ages the oldest *claimable* task. A deferred task has
	// no meaningful age — it is early, not late — so it never contributes.
	OldestDueCreatedAt *time.Time `json:"oldest_due_created_at,omitempty"`
	// NextNotBefore is when the earliest deferred task wakes up.
	NextNotBefore *time.Time `json:"next_not_before,omitempty"`
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
func (s *Store) ChatAgentQueueSummary() (ChatAgentQueueSummary, error) {
	if s.db != nil {
		return s.postgresChatAgentQueueSummary()
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	now := time.Now().UTC()
	summary := ChatAgentQueueSummary{Counts: make(map[string]int)}
	for _, task := range s.chatAgentTasks {
		if !chatAgentTaskActive(task.Status) {
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
		default:
			summary.Due++
			summary.OldestDueCreatedAt = earliest(summary.OldestDueCreatedAt, task.CreatedAt)
		}
	}
	return summary, nil
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

func (s *Store) postgresChatAgentQueueSummary() (ChatAgentQueueSummary, error) {
	rows, err := s.db.Query(`SELECT status, count(*),
			count(*) FILTER (WHERE not_before<=now() AND attempt<max_attempts),
			count(*) FILTER (WHERE not_before>now() AND attempt<max_attempts),
			count(*) FILTER (WHERE attempt>=max_attempts),
			min(created_at) FILTER (WHERE not_before<=now() AND attempt<max_attempts),
			min(not_before) FILTER (WHERE not_before>now() AND attempt<max_attempts)
		FROM harness_chat_agent_tasks GROUP BY status`)
	if err != nil {
		return ChatAgentQueueSummary{}, fmt.Errorf("summarize chat agent queue: %w", err)
	}
	defer rows.Close()
	summary := ChatAgentQueueSummary{Counts: make(map[string]int)}
	for rows.Next() {
		var status string
		var total, due, scheduled, blocked int
		var oldestDue, nextNotBefore sql.NullTime
		if err := rows.Scan(&status, &total, &due, &scheduled, &blocked, &oldestDue, &nextNotBefore); err != nil {
			return ChatAgentQueueSummary{}, fmt.Errorf("scan chat agent queue summary: %w", err)
		}
		// A settled task has left the queue; only work still in it is depth.
		if !chatAgentTaskActive(status) {
			continue
		}
		summary.Queued += total
		summary.Counts[status] = total
		// Only the claimable statuses carry backlog semantics; a LEASED or
		// RUNNING task is already being worked.
		if !chatAgentTaskClaimable(status) {
			continue
		}
		summary.Due += due
		summary.Scheduled += scheduled
		summary.Blocked += blocked
		if oldestDue.Valid {
			summary.OldestDueCreatedAt = earliest(summary.OldestDueCreatedAt, oldestDue.Time)
		}
		if nextNotBefore.Valid {
			summary.NextNotBefore = earliest(summary.NextNotBefore, nextNotBefore.Time)
		}
	}
	return summary, rows.Err()
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
