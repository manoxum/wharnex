package session

import (
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
	// DueWorkerByType lets Desktop exclude only operator-suspended task types.
	DueWorkerByType map[string]int `json:"due_worker_by_type"`
	DueTranslator   int            `json:"due_translator"`
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
	summary := ChatAgentQueueSummary{Counts: make(map[string]int), DueWorkerByType: make(map[string]int)}
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
		case providerGuarded && !chatAgentTaskSupervisor(task.Type) && task.Type != "TRANSLATE_MARKDOWN":
			summary.Guarded++
		case chatAgentBlockedByActiveTask(task, s.chatAgentTasks, now):
			summary.Guarded++
		default:
			summary.Due++
			if chatAgentTaskSupervisor(task.Type) {
				supervisorLanes[chatAgentTaskLaneKey(task)] = struct{}{}
			} else if task.Type == "TRANSLATE_MARKDOWN" {
				summary.DueTranslator++
			} else {
				summary.DueWorker++
				summary.DueWorkerByType[task.Type]++
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
