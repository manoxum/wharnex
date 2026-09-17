package session

import (
	"strings"
	"testing"
	"time"
)

func claimTypes(t *testing.T, store *Store, role string, count int) []string {
	t.Helper()
	claimed := make([]string, 0, count)
	for index := 0; index < count; index++ {
		task, err := store.ClaimChatAgentTaskWithOptions(
			role+"-owner", time.Minute,
			ChatAgentClaimOptions{Role: role, WorkerID: role + "-1"},
		)
		if err != nil {
			t.Fatalf("claim %s: %v", role, err)
		}
		if task == nil {
			break
		}
		claimed = append(claimed, task.Type)
	}
	return claimed
}

// The pools partition the queue so neither ever navigates a renderer the other
// already has loaded — and so a rename can never take a slot a live request
// needs. Enforcing it at the claim also keeps a rejected routing decision from
// charging a task's own bounded attempt budget.
func TestChatAgentClaimPartitionsTypesBetweenPools(t *testing.T) {
	store := NewStore()
	supervisorTypes := []string{"AWAIT_RESPONSE", "BOT_WRITE", "RECOVERY_WRITE", "ORCHESTRATOR_PLAN"}
	workerTypes := []string{"RENAME_CHAT", "DELETE_BUNDLE", "TRANSLATE_MARKDOWN", "TODO_CLASSIFY", "TITLE_DISCOVER"}
	for index, taskType := range append(append([]string{}, supervisorTypes...), workerTypes...) {
		task := testChatAgentTask(taskType, "chat-"+taskType, "conv-"+taskType, taskType+":"+string(rune('a'+index)))
		if _, err := store.EnqueueChatAgentTask(task); err != nil {
			t.Fatalf("enqueue %s: %v", taskType, err)
		}
	}

	for _, taskType := range claimTypes(t, store, ChatAgentRoleSupervisor, len(supervisorTypes)+len(workerTypes)) {
		if !chatAgentTaskSupervisor(taskType) {
			t.Fatalf("Supervisor pool claimed small Worker work %q", taskType)
		}
	}
	for _, taskType := range claimTypes(t, store, ChatAgentRoleWorker, len(workerTypes)+len(supervisorTypes)) {
		if chatAgentTaskSupervisor(taskType) {
			t.Fatalf("Worker pool claimed chat-bound Supervisor work %q", taskType)
		}
	}
}

// An explicit operator pin already names one canonical agent. Refusing it by
// role as well would leave the task reachable by nobody: pinned away from its
// own pool and barred from the other.
func TestChatAgentExplicitPinOverridesThePoolPartition(t *testing.T) {
	store := NewStore()
	saved, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:pinned"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AssignChatAgentTask(saved.TaskID, "worker-2", false); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTaskWithOptions("desktop:worker-2", time.Minute,
		ChatAgentClaimOptions{Role: ChatAgentRoleWorker, WorkerID: "worker-2"})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.TaskID != saved.TaskID {
		t.Fatal("a Worker must still run work an operator pinned to it")
	}
}

func TestChatAgentSupervisorWorkerIDIsCanonical(t *testing.T) {
	for _, value := range []string{"Supervisor-3", " supervisor-3 ", "supervisor-3"} {
		normalized, err := normalizeChatAgentWorkerID(value)
		if err != nil || normalized != "supervisor-3" {
			t.Fatalf("normalize(%q)=%q err=%v", value, normalized, err)
		}
	}
	if _, err := normalizeChatAgentWorkerID("supervisor-0"); err == nil {
		t.Fatal("supervisor-0 must be rejected")
	}
	if _, err := normalizeChatAgentWorkerID("agent-1"); err == nil {
		t.Fatal("an unknown agent namespace must be rejected")
	}
}

func TestChatAgentClaimRejectsUnknownPoolRole(t *testing.T) {
	store := NewStore()
	if _, err := store.ClaimChatAgentTaskWithOptions("owner", time.Minute, ChatAgentClaimOptions{Role: "planner"}); err == nil {
		t.Fatal("an unsupported pool role must be refused rather than silently unrestricted")
	}
}

// The SQL claim and the in-memory fallback must never drift apart on which pool
// may run which type, so the predicate is rendered from the same list.
func TestChatAgentSupervisorSQLMatchesTheTypeList(t *testing.T) {
	rendered := chatAgentTaskSupervisorSQL("t.type")
	for _, taskType := range chatAgentSupervisorTypes {
		if !strings.Contains(rendered, "'"+taskType+"'") {
			t.Fatalf("supervisor SQL predicate is missing %q: %s", taskType, rendered)
		}
	}
	for _, taskType := range []string{"RENAME_CHAT", "TRANSLATE_MARKDOWN", "TODO_CLASSIFY", "DELETE_BUNDLE"} {
		if strings.Contains(rendered, "'"+taskType+"'") {
			t.Fatalf("supervisor SQL predicate must not contain small Worker work %q", taskType)
		}
	}
}
