package session

import (
	"reflect"
	"testing"
	"time"
)

func TestChatAgentQueueSummaryCountsRunnableWorkerDemandByType(t *testing.T) {
	store := NewStore()
	for _, task := range []ChatAgentTask{
		testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "organize:a"),
		testChatAgentTask("ORCHESTRATOR_PLAN", "chat-b", "conv-b", "orchestrate:b"),
		testChatAgentTask("ORCHESTRATOR_PLAN", "chat-c", "conv-c", "orchestrate:c"),
	} {
		if _, err := store.EnqueueChatAgentTask(task); err != nil {
			t.Fatal(err)
		}
	}
	deferred := testChatAgentTask("ORGANIZE_CHAT", "chat-d", "conv-d", "organize:d")
	deferred.NotBefore = time.Now().UTC().Add(time.Hour)
	if _, err := store.EnqueueChatAgentTask(deferred); err != nil {
		t.Fatal(err)
	}

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"ORGANIZE_CHAT": 1, "ORCHESTRATOR_PLAN": 2}
	if summary.DueWorker != 3 || !reflect.DeepEqual(summary.DueWorkerByType, want) {
		t.Fatalf("due_worker=%d by_type=%v want 3/%v", summary.DueWorker, summary.DueWorkerByType, want)
	}
}
