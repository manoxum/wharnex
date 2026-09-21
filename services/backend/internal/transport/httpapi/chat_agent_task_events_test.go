package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"kernl.local/harness/backend/internal/session"
)

func TestRecordAndListChatAgentTaskEventByTask(t *testing.T) {
	store := session.NewStore()
	task, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "AWAIT_RESPONSE", ChatID: "chat-1", ConversationID: "conv-1", RequestID: "req_1", RootRequestID: "req_root",
	})
	if err != nil {
		t.Fatal(err)
	}
	api := &API{store: store}

	body, _ := json.Marshal(map[string]any{
		"type": "chatgpt.recovery_keep_continue", "request_id": "req_1", "root_request_id": "req_root",
		"data": map[string]any{"reason": "completed-without-bundle"},
	})
	request := httptest.NewRequest(http.MethodPost, "/api/chat-agent/tasks/"+task.TaskID+"/events", bytes.NewReader(body))
	request.SetPathValue("id", task.TaskID)
	response := httptest.NewRecorder()
	api.recordChatAgentTaskEvent(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/chat-agent/tasks/"+task.TaskID+"/events", nil)
	listRequest.SetPathValue("id", task.TaskID)
	listResponse := httptest.NewRecorder()
	api.listChatAgentTaskEventsByTask(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, body = %s", listResponse.Code, listResponse.Body.String())
	}
	var listed struct {
		Events []session.ChatAgentTaskEvent `json:"events"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Events) != 1 || listed.Events[0].Type != "chatgpt.recovery_keep_continue" {
		t.Fatalf("unexpected events: %#v", listed.Events)
	}
}

func TestListChatAgentTaskEventsByRequestCorrelatesAcrossTasks(t *testing.T) {
	store := session.NewStore()
	first, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "AWAIT_RESPONSE", ChatID: "chat-1", ConversationID: "conv-1", RequestID: "req_1", RootRequestID: "req_root"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "RECOVERY_WRITE", ChatID: "chat-1", ConversationID: "conv-1", RequestID: "req_1", RootRequestID: "req_root"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AppendChatAgentTaskEvent(session.ChatAgentTaskEvent{TaskID: first.TaskID, RootRequestID: "req_root", Type: "chatgpt.recovery_reload"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AppendChatAgentTaskEvent(session.ChatAgentTaskEvent{TaskID: second.TaskID, RootRequestID: "req_root", Type: "chatgpt.bundle_validated"}); err != nil {
		t.Fatal(err)
	}

	api := &API{store: store}
	request := httptest.NewRequest(http.MethodGet, "/api/chat-agent/tasks/events?root_request_id=req_root", nil)
	response := httptest.NewRecorder()
	api.listChatAgentTaskEventsByRequest(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var listed struct {
		Events []session.ChatAgentTaskEvent `json:"events"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Events) != 2 {
		t.Fatalf("expected events from both tasks correlated by root_request_id, got %#v", listed.Events)
	}
}

func TestRecordChatAgentTaskEventRequiresType(t *testing.T) {
	store := session.NewStore()
	api := &API{store: store}
	body, _ := json.Marshal(map[string]any{})
	request := httptest.NewRequest(http.MethodPost, "/api/chat-agent/tasks/cat_missing/events", bytes.NewReader(body))
	request.SetPathValue("id", "cat_missing")
	response := httptest.NewRecorder()
	api.recordChatAgentTaskEvent(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body = %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}
