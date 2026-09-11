package session

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func testChatAgentTask(taskType, chatID, conversationID, dedupe string) ChatAgentTask {
	return ChatAgentTask{
		Type: taskType, ChatID: chatID, ConversationID: conversationID,
		DedupeKey: dedupe, Payload: json.RawMessage(`{"test":true}`),
	}
}

func TestPostgresClaimReturningColumnsAreQualified(t *testing.T) {
	qualified := strings.Split(qualifiedChatAgentTaskColumns("t"), ",")
	raw := strings.Split(chatAgentTaskColumns, ",")
	if len(qualified) != len(raw) {
		t.Fatalf("qualified columns=%d want %d", len(qualified), len(raw))
	}
	for index, column := range qualified {
		want := "t." + strings.TrimSpace(raw[index])
		if column != want {
			t.Fatalf("column %d=%q want %q", index, column, want)
		}
	}
}

func TestChatAgentTaskDedupeAndWriteIdentity(t *testing.T) {
	store := NewStore()
	first, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	if again.TaskID != first.TaskID {
		t.Fatalf("dedupe created %q after %q", again.TaskID, first.TaskID)
	}
	write1, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-a", "conv-a", "same"))
	if err != nil {
		t.Fatal(err)
	}
	write2, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-a", "conv-a", "same"))
	if err != nil {
		t.Fatal(err)
	}
	if write1.TaskID == write2.TaskID {
		t.Fatal("writes must never dedupe")
	}
	organize1, err := store.EnqueueChatAgentTask(testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "organize:conv-a"))
	if err != nil {
		t.Fatal(err)
	}
	organize2, err := store.EnqueueChatAgentTask(testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "organize:conv-a"))
	if err != nil {
		t.Fatal(err)
	}
	if organize1.TaskID != organize2.TaskID {
		t.Fatal("idempotent account work must dedupe")
	}
}

func TestChatAgentClaimRespectsNotBeforeAndPriority(t *testing.T) {
	store := NewStore()
	future := testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:future")
	future.NotBefore = time.Now().UTC().Add(time.Hour)
	if _, err := store.EnqueueChatAgentTask(future); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("ARCHIVE_CHAT", "chat-b", "conv-b", "archive:b")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-c", "conv-c", "")); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.Type != "BOT_WRITE" {
		t.Fatalf("expected BOT_WRITE first, got %#v", claimed)
	}
	if claimed.Attempt != 1 || claimed.Status != ChatAgentTaskLeased {
		t.Fatalf("unexpected lease state %#v", claimed)
	}
}

func TestChatAgentConversationWriteLeaseAndWait(t *testing.T) {
	store := NewStore()
	first, _ := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-a", "conv-a", ""))
	second, _ := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:a"))
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != first.TaskID {
		t.Fatalf("claim first: %#v %v", claimed, err)
	}
	other, err := store.ClaimChatAgentTask("worker-2", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if other != nil {
		t.Fatalf("await must not overlap writer, got %#v", other)
	}
	if _, err := store.StartChatAgentTask(first.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteChatAgentTask(first.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	other, err = store.ClaimChatAgentTask("worker-2", 30*time.Second)
	if err != nil || other == nil || other.TaskID != second.TaskID {
		t.Fatalf("claim await after write: %#v %v", other, err)
	}
	notBefore := time.Now().UTC().Add(time.Minute)
	waiting, err := store.WaitChatAgentTask(second.TaskID, "worker-2", notBefore, "still generating")
	if err != nil {
		t.Fatal(err)
	}
	if waiting.Status != ChatAgentTaskWaiting || !waiting.NotBefore.Equal(notBefore) {
		t.Fatalf("unexpected waiting state %#v", waiting)
	}
}

func TestChatAgentGlobalAccountLockAndLineageCancel(t *testing.T) {
	store := NewStore()
	one := testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "org:a")
	one.RootRequestID = "root-1"
	two := testChatAgentTask("ARCHIVE_CHAT", "chat-b", "conv-b", "archive:b")
	two.RootRequestID = "root-1"
	if _, err := store.EnqueueChatAgentTask(one); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(two); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil {
		t.Fatalf("claim account task: %#v %v", claimed, err)
	}
	other, err := store.ClaimChatAgentTask("worker-2", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if other != nil {
		t.Fatalf("account operations must serialize, got %#v", other)
	}
	cancelled, err := store.CancelChatAgentLineage("root-1")
	if err != nil {
		t.Fatal(err)
	}
	if cancelled != 2 {
		t.Fatalf("cancelled=%d want 2", cancelled)
	}
}
