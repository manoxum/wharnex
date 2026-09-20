package session

import (
	"testing"
	"time"
)

func TestChatAgentTaskEventsFallbackAppendAndListByTask(t *testing.T) {
	store := NewStore()
	now := time.Now().UTC()
	for index, eventType := range []string{"chatgpt.recovery_reload", "chatgpt.recovery_keep_continue"} {
		if _, err := store.AppendChatAgentTaskEvent(ChatAgentTaskEvent{
			TaskID: "cat_1", RequestID: "req_1", RootRequestID: "req_root", Type: eventType,
			OccurredAt: now.Add(time.Duration(index) * time.Second),
			Data:       map[string]any{"reason": eventType},
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.AppendChatAgentTaskEvent(ChatAgentTaskEvent{
		TaskID: "cat_2", RequestID: "req_2", RootRequestID: "req_root", Type: "chatgpt.bundle_validated",
		OccurredAt: now.Add(5 * time.Second),
	}); err != nil {
		t.Fatal(err)
	}

	byTask, err := store.ListChatAgentTaskEvents(ChatAgentTaskEventFilter{TaskID: "cat_1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(byTask) != 2 || byTask[0].Type != "chatgpt.recovery_reload" || byTask[1].Type != "chatgpt.recovery_keep_continue" {
		t.Fatalf("unexpected ordering/records for task filter: %#v", byTask)
	}

	byRoot, err := store.ListChatAgentTaskEvents(ChatAgentTaskEventFilter{RootRequestID: "req_root"})
	if err != nil {
		t.Fatal(err)
	}
	if len(byRoot) != 3 {
		t.Fatalf("expected every task's events correlated by root_request_id, got %d", len(byRoot))
	}
}

func TestChatAgentTaskEventRequiresTaskIDAndType(t *testing.T) {
	store := NewStore()
	if _, err := store.AppendChatAgentTaskEvent(ChatAgentTaskEvent{Type: "chatgpt.recovery_reload"}); err == nil {
		t.Fatal("expected error for missing task_id")
	}
	if _, err := store.AppendChatAgentTaskEvent(ChatAgentTaskEvent{TaskID: "cat_1"}); err == nil {
		t.Fatal("expected error for missing type")
	}
}

func TestChatAgentTaskEventDataIsRedacted(t *testing.T) {
	store := NewStore()
	saved, err := store.AppendChatAgentTaskEvent(ChatAgentTaskEvent{
		TaskID: "cat_1", Type: "chatgpt.human_action_required",
		Data: map[string]any{"detail": "fine", "api_key": "sk-super-secret"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Data["api_key"] != "[REDACTED]" {
		t.Fatalf("expected api_key to be redacted, got %#v", saved.Data["api_key"])
	}
	if saved.Data["detail"] != "fine" {
		t.Fatalf("expected unrelated field to survive, got %#v", saved.Data["detail"])
	}
}

func TestChatAgentTaskEventsListBoundsLimit(t *testing.T) {
	store := NewStore()
	now := time.Now().UTC()
	for i := 0; i < 5; i++ {
		if _, err := store.AppendChatAgentTaskEvent(ChatAgentTaskEvent{
			TaskID: "cat_1", Type: "chatgpt.recovery_reload", OccurredAt: now.Add(time.Duration(i) * time.Second),
		}); err != nil {
			t.Fatal(err)
		}
	}
	items, err := store.ListChatAgentTaskEvents(ChatAgentTaskEventFilter{TaskID: "cat_1", Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("expected limit to bound the result, got %d", len(items))
	}
}
