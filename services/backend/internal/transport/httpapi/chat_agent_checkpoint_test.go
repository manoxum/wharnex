package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/session"
)

func TestCheckpointChatAgentTaskEndpointPersistsPatch(t *testing.T) {
	handler, store := newChatArchiveTestHandler(t)
	saved, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "BOT_WRITE", ChatID: "chat-checkpoint", Payload: json.RawMessage(`{"prompt":"hello","submitted":false}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimChatAgentTask("worker-1", 30*time.Second); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/chat-agent/tasks/"+saved.TaskID+"/checkpoint",
		bytes.NewBufferString(`{"owner":"worker-1","payload":{"submitted":true,"remote_id":"turn-1"}}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status=%d want %d body=%s", response.Code, http.StatusOK, response.Body.String())
	}
	var task session.ChatAgentTask
	if err := json.Unmarshal(response.Body.Bytes(), &task); err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["prompt"] != "hello" || payload["submitted"] != true || payload["remote_id"] != "turn-1" {
		t.Fatalf("payload=%v", payload)
	}
}

func TestCheckpointChatAgentTaskEndpointRejectsLeaseConflict(t *testing.T) {
	handler, store := newChatArchiveTestHandler(t)
	saved, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "BOT_WRITE", ChatID: "chat-checkpoint"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimChatAgentTask("worker-1", 30*time.Second); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/chat-agent/tasks/"+saved.TaskID+"/checkpoint",
		bytes.NewBufferString(`{"owner":"worker-2","payload":{"submitted":true}}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("status=%d want %d body=%s", response.Code, http.StatusConflict, response.Body.String())
	}
}
