package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/session"
)

func TestListUnifiedTasksPagedScopesAndHistoryCursor(t *testing.T) {
	store := session.NewStore()
	completeTransportTask(t, store, "/project/a", "history-a")
	completeTransportTask(t, store, "/project/a", "history-b")
	attentionTransportTask(t, store, "/project/a", "attention-a")
	pending, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "AWAIT_RESPONSE", ChatID: "active-a", ConversationID: "active-a", ProjectID: "/project/a",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "AWAIT_RESPONSE", ChatID: "active-b", ConversationID: "active-b", ProjectID: "/project/b",
	}); err != nil {
		t.Fatal(err)
	}
	api := &API{store: store}

	active := requestUnifiedTaskPage(t, api, "/api/tasks?scope=active&project_id="+url.QueryEscape("/project/a"))
	if len(active.Tasks) != 2 || active.HasMore || active.NextCursor != "" {
		t.Fatalf("active response=%#v", active)
	}
	seen := map[string]bool{}
	for _, task := range active.Tasks {
		seen[task.TaskID] = true
		if task.ProjectID != "/project/a" {
			t.Fatalf("project leak: %#v", task)
		}
	}
	if !seen[pending.TaskID] {
		t.Fatalf("pending task %s missing from active response", pending.TaskID)
	}
	if !containsTaskStatus(active.Tasks, session.ChatAgentTaskAttention) {
		t.Fatalf("attention task missing from active response: %#v", active.Tasks)
	}

	first := requestUnifiedTaskPage(t, api, "/api/tasks?scope=history&limit=1&project_id="+url.QueryEscape("/project/a"))
	if len(first.Tasks) != 1 || !first.HasMore || first.NextCursor == "" {
		t.Fatalf("first history response=%#v", first)
	}
	second := requestUnifiedTaskPage(t, api, "/api/tasks?scope=history&limit=1&project_id="+url.QueryEscape("/project/a")+"&cursor="+url.QueryEscape(first.NextCursor))
	if len(second.Tasks) != 1 || second.Tasks[0].TaskID == first.Tasks[0].TaskID {
		t.Fatalf("second history response=%#v first=%#v", second, first)
	}
}

func TestListUnifiedTasksHistoryRequiresExplicitLimit(t *testing.T) {
	api := &API{store: session.NewStore()}
	request := httptest.NewRequest(http.MethodGet, "/api/tasks?scope=history&project_id="+url.QueryEscape("/project/a"), nil)
	response := httptest.NewRecorder()
	api.listUnifiedTasks(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want %d body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}

func requestUnifiedTaskPage(t *testing.T, api *API, target string) session.UnifiedTaskPage {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	response := httptest.NewRecorder()
	api.listUnifiedTasks(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var page session.UnifiedTaskPage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func completeTransportTask(t *testing.T, store *session.Store, projectID, chatID string) {
	t.Helper()
	task, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "BOT_WRITE", ChatID: chatID, ConversationID: chatID, ProjectID: projectID})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-complete", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != task.TaskID {
		t.Fatalf("claim=%#v err=%v want %s", claimed, err, task.TaskID)
	}
	if _, err := store.CompleteChatAgentTask(task.TaskID, "worker-complete"); err != nil {
		t.Fatal(err)
	}
}

func attentionTransportTask(t *testing.T, store *session.Store, projectID, chatID string) {
	t.Helper()
	task, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "BOT_WRITE", ChatID: chatID, ConversationID: chatID, ProjectID: projectID})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-attention", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != task.TaskID {
		t.Fatalf("claim=%#v err=%v want %s", claimed, err, task.TaskID)
	}
	if _, err := store.FailChatAgentTask(task.TaskID, "worker-attention", "needs operator", true); err != nil {
		t.Fatal(err)
	}
}

func containsTaskStatus(tasks []session.ChatAgentTask, status string) bool {
	for _, task := range tasks {
		if task.Status == status {
			return true
		}
	}
	return false
}
