package session

import (
	"testing"
	"time"
)

// A queue whose every task is deferred behind not_before is idle. Reporting
// those tasks as due backlog is what made an idle scheduler read as a stuck
// one: 36 bundle-retention cleanups, none of them claimable for three days,
// presented as pending work with a 20-hour-old "oldest task".
func TestChatAgentQueueSummarySeparatesDeferredFromDue(t *testing.T) {
	store := NewStore()
	now := time.Now().UTC()
	deferred := testChatAgentTask("DELETE_BUNDLE", "chat-a", "", "delete-bundle:a.zip")
	deferred.NotBefore = now.Add(72 * time.Hour)
	if _, err := store.EnqueueChatAgentTask(deferred); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-b", "conv-b", "await:req-1")); err != nil {
		t.Fatal(err)
	}

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Queued != 2 {
		t.Fatalf("queued=%d want 2", summary.Queued)
	}
	if summary.Counts[ChatAgentTaskPending] != 2 {
		t.Fatalf("pending count=%d want 2", summary.Counts[ChatAgentTaskPending])
	}
	if summary.Due != 1 || summary.Scheduled != 1 {
		t.Fatalf("due=%d scheduled=%d want 1/1", summary.Due, summary.Scheduled)
	}
	if summary.OldestDueCreatedAt == nil {
		t.Fatal("a claimable task must age the backlog")
	}
	if summary.NextNotBefore == nil || !summary.NextNotBefore.Equal(deferred.NotBefore) {
		t.Fatalf("next_not_before=%v want %v", summary.NextNotBefore, deferred.NotBefore)
	}
}

// A deferred-only queue has no backlog age at all: every task is early, not
// late, so there is nothing to report as the oldest waiting item.
func TestChatAgentQueueSummaryHasNoAgeWhenNothingIsDue(t *testing.T) {
	store := NewStore()
	task := testChatAgentTask("DELETE_BUNDLE", "chat-a", "", "delete-bundle:a.zip")
	task.NotBefore = time.Now().UTC().Add(72 * time.Hour)
	if _, err := store.EnqueueChatAgentTask(task); err != nil {
		t.Fatal(err)
	}

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Due != 0 || summary.Scheduled != 1 {
		t.Fatalf("due=%d scheduled=%d want 0/1", summary.Due, summary.Scheduled)
	}
	if summary.OldestDueCreatedAt != nil {
		t.Fatalf("oldest_due_created_at=%v want none", summary.OldestDueCreatedAt)
	}
}

// A task past its attempt budget is excluded by the claim query, so counting
// it as due would report backlog that can never drain.
func TestChatAgentQueueSummaryCountsExhaustedTasksAsBlocked(t *testing.T) {
	store := NewStore()
	saved, err := store.EnqueueChatAgentTask(testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "organize:conv-a"))
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	exhausted := store.chatAgentTasks[saved.TaskID]
	exhausted.Attempt = exhausted.MaxAttempts
	store.chatAgentTasks[saved.TaskID] = exhausted
	store.mu.Unlock()

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Due != 0 || summary.Blocked != 1 {
		t.Fatalf("due=%d blocked=%d want 0/1", summary.Due, summary.Blocked)
	}
}

// A title task may be past not_before and still be ineligible: driving that
// conversation while its response supervision is alive would navigate the
// renderer away from a generating answer. Idle Workers cannot claim it, so it
// must not be reported as due backlog.
func TestChatAgentQueueSummaryDoesNotCountQuietConversationWorkAsDue(t *testing.T) {
	store := NewStore()
	supervision, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("TITLE_DISCOVER", "chat-a", "conv-a", "title:conv-a")); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	deferred := store.chatAgentTasks[supervision.TaskID]
	deferred.NotBefore = time.Now().UTC().Add(30 * time.Second)
	store.chatAgentTasks[supervision.TaskID] = deferred
	store.mu.Unlock()

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Due != 0 || summary.Scheduled != 1 || summary.Guarded != 1 {
		t.Fatalf("due=%d scheduled=%d guarded=%d want 0/1/1 while title waits for supervision", summary.Due, summary.Scheduled, summary.Guarded)
	}
	if summary.OldestDueCreatedAt != nil {
		t.Fatalf("oldest_due_created_at=%v want none", summary.OldestDueCreatedAt)
	}
}

func TestChatAgentQueueSummaryCountsProviderPausedWorkAsGuarded(t *testing.T) {
	store := NewStore()
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetChatAgentProviderPause(true, nil, "operator pause"); err != nil {
		t.Fatal(err)
	}

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Due != 0 || summary.Guarded != 1 {
		t.Fatalf("due=%d guarded=%d want 0/1 while provider is paused", summary.Due, summary.Guarded)
	}
	if summary.OldestDueCreatedAt != nil {
		t.Fatalf("oldest_due_created_at=%v want none", summary.OldestDueCreatedAt)
	}
}

// Settled rows are bookkeeping; live ones are the queue. Pruning must never
// touch work that can still be claimed, however old it is.
func TestPruneChatAgentTasksRemovesOnlySettledRows(t *testing.T) {
	store := NewStore()
	live, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	done, err := store.EnqueueChatAgentTask(testChatAgentTask("TITLE_DISCOVER", "chat-b", "conv-b", "title:conv-b"))
	if err != nil {
		t.Fatal(err)
	}
	stale := time.Now().UTC().Add(-96 * time.Hour)
	store.mu.Lock()
	aged := store.chatAgentTasks[live.TaskID]
	aged.UpdatedAt = stale
	store.chatAgentTasks[live.TaskID] = aged
	settled := store.chatAgentTasks[done.TaskID]
	settled.Status = ChatAgentTaskDone
	settled.UpdatedAt = stale
	store.chatAgentTasks[done.TaskID] = settled
	store.mu.Unlock()

	removed, err := store.PruneChatAgentTasks(time.Now().UTC().Add(-72 * time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("removed=%d want 1", removed)
	}
	if _, ok := store.chatAgentTasks[live.TaskID]; !ok {
		t.Fatal("a claimable task must survive retention regardless of age")
	}
	if _, ok := store.chatAgentTasks[done.TaskID]; ok {
		t.Fatal("settled task older than the cutoff must be pruned")
	}
}

// A zero cutoff is the "retention not configured" case and must be a no-op
// rather than a request to delete every settled row.
func TestPruneChatAgentTasksIgnoresZeroCutoff(t *testing.T) {
	store := NewStore()
	saved, err := store.EnqueueChatAgentTask(testChatAgentTask("TITLE_DISCOVER", "chat-a", "conv-a", "title:conv-a"))
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	settled := store.chatAgentTasks[saved.TaskID]
	settled.Status = ChatAgentTaskDone
	store.chatAgentTasks[saved.TaskID] = settled
	store.mu.Unlock()

	removed, err := store.PruneChatAgentTasks(time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Fatalf("removed=%d want 0", removed)
	}
}

// A settled task has left the queue. Counting it reported past throughput as
// if it were depth, which says nothing about what is waiting to run now.
func TestChatAgentQueueSummaryExcludesSettledTasks(t *testing.T) {
	store := NewStore()
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1")); err != nil {
		t.Fatal(err)
	}
	for status, dedupe := range map[string]string{
		ChatAgentTaskDone:      "title:conv-b",
		ChatAgentTaskFailed:    "title:conv-c",
		ChatAgentTaskCancelled: "title:conv-d",
		ChatAgentTaskAttention: "title:conv-e",
	} {
		saved, enqueueErr := store.EnqueueChatAgentTask(testChatAgentTask("TITLE_DISCOVER", "chat-x", "", dedupe))
		if enqueueErr != nil {
			t.Fatal(enqueueErr)
		}
		store.mu.Lock()
		settled := store.chatAgentTasks[saved.TaskID]
		settled.Status = status
		store.chatAgentTasks[saved.TaskID] = settled
		store.mu.Unlock()
	}

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Queued != 1 {
		t.Fatalf("queued=%d want 1", summary.Queued)
	}
	if len(summary.Counts) != 1 || summary.Counts[ChatAgentTaskPending] != 1 {
		t.Fatalf("counts=%v want only the queued task", summary.Counts)
	}
}

// A passive observation of a healthy remote response must not spend the
// attempt budget: AWAIT_RESPONSE probes every 30s for as long as the model
// keeps working, so a bounded budget would abandon a long but healthy response
// mid-reasoning.
func TestWaitChatAgentTaskObservationReturnsTheAttempt(t *testing.T) {
	store := NewStore()
	saved, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	notBefore := time.Now().UTC().Add(30 * time.Second)
	for round := 0; round < 50; round++ {
		claimed, claimErr := store.ClaimChatAgentTask("worker-1", 30*time.Second)
		if claimErr != nil {
			t.Fatal(claimErr)
		}
		if claimed == nil {
			t.Fatalf("round %d: a healthy observation must leave the task claimable", round)
		}
		if claimed.Attempt != 1 {
			t.Fatalf("round %d: attempt=%d want 1", round, claimed.Attempt)
		}
		waited, waitErr := store.WaitChatAgentTask(saved.TaskID, "worker-1", notBefore, "", true)
		if waitErr != nil {
			t.Fatal(waitErr)
		}
		if waited.Attempt != 0 {
			t.Fatalf("round %d: observation left attempt=%d want 0", round, waited.Attempt)
		}
		store.mu.Lock()
		task := store.chatAgentTasks[saved.TaskID]
		task.NotBefore = time.Now().UTC().Add(-time.Second)
		store.chatAgentTasks[saved.TaskID] = task
		store.mu.Unlock()
	}
}

// A real attempt still counts, so a genuinely failing task remains bounded.
func TestWaitChatAgentTaskOrdinaryRetryKeepsSpendingTheBudget(t *testing.T) {
	store := NewStore()
	saved, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil {
		t.Fatalf("claim: %#v %v", claimed, err)
	}
	waited, err := store.WaitChatAgentTask(saved.TaskID, "worker-1", time.Now().UTC().Add(time.Minute), "probe failed", false)
	if err != nil {
		t.Fatal(err)
	}
	if waited.Attempt != 1 {
		t.Fatalf("attempt=%d want 1", waited.Attempt)
	}
}
