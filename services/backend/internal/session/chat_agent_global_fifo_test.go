package session

import (
	"strings"
	"testing"
	"time"
)

func TestGlobalWorkerQueuePrioritizesPlanningThenFIFOExecution(t *testing.T) {
	store := NewStore()
	first := testChatAgentTask("ORCHESTRATOR_EXECUTE", "task-a", "", "fifo:a")
	first.ProjectID = "/project-a"
	second := testChatAgentTask("ORCHESTRATOR_EXECUTE", "task-b", "", "fifo:b")
	second.ProjectID = "/project-b"
	plan := testChatAgentTask("ORCHESTRATOR_PLAN", "plan-c", "", "fifo:plan")
	plan.ProjectID = "/project-b"
	for _, task := range []ChatAgentTask{first, second, plan} {
		if _, err := store.EnqueueChatAgentTask(task); err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	for index, want := range []string{"plan-c", "task-a", "task-b"} {
		claimed, err := store.ClaimChatAgentTaskWithOptions("worker-owner", time.Minute, ChatAgentClaimOptions{Role: ChatAgentRoleWorker, WorkerID: "worker-1"})
		if err != nil || claimed == nil || claimed.ChatID != want {
			t.Fatalf("claim %d=%#v err=%v want %s", index, claimed, err, want)
		}
	}
}

func TestSameProjectReadyExecutionsCanOccupySeparateWorkers(t *testing.T) {
	store := NewStore()
	for _, id := range []string{"task-first", "task-second"} {
		task := testChatAgentTask("ORCHESTRATOR_EXECUTE", id, "", "same:"+id)
		task.ProjectID = "/same-project"
		if _, err := store.EnqueueChatAgentTask(task); err != nil {
			t.Fatal(err)
		}
	}
	for index := 1; index <= 2; index++ {
		worker := "worker-" + string(rune('0'+index))
		claimed, err := store.ClaimChatAgentTaskWithOptions(worker, time.Minute, ChatAgentClaimOptions{Role: ChatAgentRoleWorker, WorkerID: worker})
		if err != nil || claimed == nil {
			t.Fatalf("worker %d claim=%#v err=%v", index, claimed, err)
		}
		if _, err := store.StartChatAgentTask(claimed.TaskID, worker); err != nil {
			t.Fatal(err)
		}
	}
}

func TestLegacyPendingPlanningPriorityIsPromotedAtClaim(t *testing.T) {
	now := time.Now().UTC()
	if got := chatAgentEffectivePriority(ChatAgentTask{Type: "ORCHESTRATOR_PLAN", Priority: -1}, now); got != -2 {
		t.Fatalf("legacy planning priority=%d", got)
	}
	if got := chatAgentEffectivePriority(ChatAgentTask{Type: "TRANSLATE_MARKDOWN", Priority: -1}, now); got != -3 {
		t.Fatalf("legacy translation priority=%d", got)
	}
	sql := chatAgentEffectivePrioritySQL("t")
	if !strings.Contains(sql, "ORCHESTRATOR_PLAN") || !strings.Contains(sql, "LEAST(t.priority,-2)") {
		t.Fatalf("SQL priority drift: %s", sql)
	}
}
