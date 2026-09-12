package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/session"
)

// The runtime view reads this endpoint instead of counting a listed page, so a
// queue made entirely of deferred work has to come back as scheduled with no
// backlog age at all. Reporting it as due is what turned an idle scheduler into
// an apparent 36-task backlog.
func TestChatAgentTaskSummaryReportsDeferredWorkAsScheduled(t *testing.T) {
	store := session.NewStore()
	deferred := session.ChatAgentTask{
		Type: "DELETE_BUNDLE", ChatID: "chat-a", DedupeKey: "delete-bundle:a.zip",
		NotBefore: time.Now().UTC().Add(72 * time.Hour),
	}
	if _, err := store.EnqueueChatAgentTask(deferred); err != nil {
		t.Fatal(err)
	}
	api := &API{store: store}
	request := httptest.NewRequest(http.MethodGet, "/api/chat-agent/tasks/summary", nil)
	response := httptest.NewRecorder()

	api.chatAgentTaskSummary(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body session.ChatAgentQueueSummary
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Due != 0 || body.Scheduled != 1 {
		t.Fatalf("due=%d scheduled=%d want 0/1", body.Due, body.Scheduled)
	}
	if body.OldestDueCreatedAt != nil {
		t.Fatalf("oldest_due_created_at=%v want none", body.OldestDueCreatedAt)
	}
	if body.Counts[session.ChatAgentTaskPending] != 1 {
		t.Fatalf("pending count=%d want 1", body.Counts[session.ChatAgentTaskPending])
	}
}

func TestListChatAgentTasksActiveQueryOmitsSettledTasks(t *testing.T) {
	store := session.NewStore()
	done, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "BOT_WRITE", ChatID: "chat-done", ConversationID: "conv-done"})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != done.TaskID {
		t.Fatalf("claim done task: %#v %v", claimed, err)
	}
	if _, err := store.StartChatAgentTask(done.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteChatAgentTask(done.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	active, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "AWAIT_RESPONSE", ChatID: "chat-active", ConversationID: "conv-active"})
	if err != nil {
		t.Fatal(err)
	}
	api := &API{store: store}
	request := httptest.NewRequest(http.MethodGet, "/api/chat-agent/tasks?active=1", nil)
	response := httptest.NewRecorder()

	api.listChatAgentTasks(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body struct {
		Tasks []session.ChatAgentTask `json:"tasks"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Tasks) != 1 || body.Tasks[0].TaskID != active.TaskID {
		t.Fatalf("tasks=%#v want only %s", body.Tasks, active.TaskID)
	}
}
