package session

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestCheckpointChatAgentTaskMergesPayloadWhileLeasedAndRunning(t *testing.T) {
	store := NewStore()
	saved, err := store.EnqueueChatAgentTask(ChatAgentTask{
		Type: "BOT_WRITE", ChatID: "chat-checkpoint", ConversationID: "conv-checkpoint",
		Payload: json.RawMessage(`{"prompt":"hello","submission":{"state":"pending"},"keep":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != saved.TaskID {
		t.Fatalf("claim task: task=%#v err=%v", claimed, err)
	}
	leaseExpiry := claimed.LeaseExpiresAt

	checkpointed, err := store.CheckpointChatAgentTask(saved.TaskID, "worker-1", json.RawMessage(`{
		"submission":{"state":"submitted","conversation_id":"conv-checkpoint"},
		"submitted_at":"2026-09-12T10:00:00Z"
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if checkpointed.Status != ChatAgentTaskLeased || checkpointed.LeaseOwner != "worker-1" {
		t.Fatalf("checkpoint changed lease state: %#v", checkpointed)
	}
	if checkpointed.LeaseExpiresAt == nil || leaseExpiry == nil || !checkpointed.LeaseExpiresAt.Equal(*leaseExpiry) {
		t.Fatalf("checkpoint changed lease expiry: before=%v after=%v", leaseExpiry, checkpointed.LeaseExpiresAt)
	}
	assertChatAgentPayload(t, checkpointed.Payload, map[string]any{
		"prompt": "hello", "submission": map[string]any{
			"state": "submitted", "conversation_id": "conv-checkpoint",
		},
		"keep": true, "submitted_at": "2026-09-12T10:00:00Z",
	})

	running, err := store.StartChatAgentTask(saved.TaskID, "worker-1")
	if err != nil {
		t.Fatal(err)
	}
	checkpointed, err = store.CheckpointChatAgentTask(running.TaskID, "worker-1", json.RawMessage(`{"keep":null}`))
	if err != nil {
		t.Fatal(err)
	}
	if checkpointed.Status != ChatAgentTaskRunning || checkpointed.LeaseOwner != "worker-1" {
		t.Fatalf("running checkpoint changed lease state: %#v", checkpointed)
	}
	assertChatAgentPayload(t, checkpointed.Payload, map[string]any{
		"prompt": "hello", "submission": map[string]any{
			"state": "submitted", "conversation_id": "conv-checkpoint",
		},
		"keep": nil, "submitted_at": "2026-09-12T10:00:00Z",
	})
}

func TestCheckpointChatAgentTaskRequiresActiveLeaseOwnerAndObjectPatch(t *testing.T) {
	store := NewStore()
	saved, err := store.EnqueueChatAgentTask(ChatAgentTask{
		Type: "BOT_WRITE", ChatID: "chat-checkpoint", Payload: json.RawMessage(`{"state":"pending"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimChatAgentTask("worker-1", 30*time.Second); err != nil {
		t.Fatal(err)
	}

	if _, err := store.CheckpointChatAgentTask(saved.TaskID, "worker-2", json.RawMessage(`{"state":"submitted"}`)); !errors.Is(err, ErrChatAgentLeaseOwner) {
		t.Fatalf("wrong owner error=%v want %v", err, ErrChatAgentLeaseOwner)
	}
	for _, patch := range []json.RawMessage{nil, json.RawMessage(`null`), json.RawMessage(`[]`), json.RawMessage(`{"broken"`)} {
		if _, err := store.CheckpointChatAgentTask(saved.TaskID, "worker-1", patch); err == nil {
			t.Fatalf("patch %q should be rejected", patch)
		}
	}
	loaded, err := store.GetChatAgentTask(saved.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	assertChatAgentPayload(t, loaded.Payload, map[string]any{"state": "pending"})

	if _, err := store.CompleteChatAgentTask(saved.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CheckpointChatAgentTask(saved.TaskID, "worker-1", json.RawMessage(`{"state":"late"}`)); !errors.Is(err, ErrChatAgentLeaseOwner) {
		t.Fatalf("completed task error=%v want %v", err, ErrChatAgentLeaseOwner)
	}
}

func assertChatAgentPayload(t *testing.T, raw json.RawMessage, want map[string]any) {
	t.Helper()
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if stringMustMarshal(got) != stringMustMarshal(want) {
		t.Fatalf("payload=%s want %s", stringMustMarshal(got), stringMustMarshal(want))
	}
}

func stringMustMarshal(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
