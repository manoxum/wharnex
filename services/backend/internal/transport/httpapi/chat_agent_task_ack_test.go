package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"kernl.local/harness/backend/internal/session"
)

func TestChatAgentTaskTransitionHonoursMinimalReturn(t *testing.T) {
	task := session.ChatAgentTask{TaskID: "cat_1", Status: "RUNNING", Attempt: 1, MaxAttempts: 3, Payload: json.RawMessage(`{"bundle":"large"}`)}
	request := httptest.NewRequest(http.MethodPost, "/api/chat-agent/tasks/cat_1/heartbeat", nil)
	request.Header.Set("Prefer", "respond-async, return=minimal")
	response := httptest.NewRecorder()
	writeChatAgentTask(response, request, task)
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, ok := body["payload"]; ok || body["task_id"] != "cat_1" || body["status"] != "RUNNING" || response.Header().Get("Preference-Applied") != "return=minimal" {
		t.Fatalf("minimal return must carry lease state only: %v", body)
	}

	response = httptest.NewRecorder()
	writeChatAgentTask(response, httptest.NewRequest(http.MethodPost, "/api/chat-agent/tasks/cat_1/start", nil), task)
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, ok := body["payload"]; !ok {
		t.Fatalf("callers that did not ask for minimal must still receive the whole task: %v", body)
	}
}
