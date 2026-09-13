package session

import (
	"errors"
	"testing"
	"time"
)

func TestChatAgentTaskAssignmentRestrictsClaimsToWorker(t *testing.T) {
	store := NewStore()
	task, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-a", "conv-a", ""))
	if err != nil {
		t.Fatal(err)
	}
	assigned, err := store.AssignChatAgentTask(task.TaskID, "worker-2", true)
	if err != nil {
		t.Fatal(err)
	}
	if assigned.AssignedWorker != "worker-2" || !assigned.KeepFlowing {
		t.Fatalf("assignment=%+v", assigned)
	}
	wrong, err := store.ClaimChatAgentTaskWithOptions("desktop:test:worker-1", 30*time.Second, ChatAgentClaimOptions{WorkerID: "worker-1"})
	if err != nil {
		t.Fatal(err)
	}
	if wrong != nil {
		t.Fatalf("worker-1 claimed pinned task %s", wrong.TaskID)
	}
	claimed, err := store.ClaimChatAgentTaskWithOptions("desktop:test:worker-2", 30*time.Second, ChatAgentClaimOptions{WorkerID: "worker-2"})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.TaskID != task.TaskID {
		t.Fatalf("worker-2 claim=%+v", claimed)
	}
}

func TestRunningTaskCanAdoptKeepFlowingOnlyOnOwningWorker(t *testing.T) {
	store := NewStore()
	task, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-a", "conv-a", ""))
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTaskWithOptions("desktop:test:worker-3", 30*time.Second, ChatAgentClaimOptions{WorkerID: "worker-3"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.StartChatAgentTask(claimed.TaskID, "desktop:test:worker-3"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.AssignChatAgentTask(task.TaskID, "worker-2", true); !errors.Is(err, ErrChatAgentTaskAssignment) {
		t.Fatalf("wrong worker assignment err=%v", err)
	}
	updated, err := store.AssignChatAgentTask(task.TaskID, "worker-3", true)
	if err != nil {
		t.Fatal(err)
	}
	if updated.AssignedWorker != "worker-3" || !updated.KeepFlowing {
		t.Fatalf("updated=%+v", updated)
	}
}
