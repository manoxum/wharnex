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

func TestChatAgentTaskDedupeIncludesActiveWrites(t *testing.T) {
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
	if write1.TaskID != write2.TaskID {
		t.Fatal("the same active write must dedupe before it can submit twice")
	}
	claimed, err := store.ClaimChatAgentTask("dedupe-test", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.TaskID != write1.TaskID {
		t.Fatalf("claimed %#v, want active write %q", claimed, write1.TaskID)
	}
	if _, err := store.CompleteChatAgentTask(write1.TaskID, "dedupe-test"); err != nil {
		t.Fatal(err)
	}
	write3, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-a", "conv-a", "same"))
	if err != nil {
		t.Fatal(err)
	}
	if write3.TaskID == write1.TaskID {
		t.Fatal("a terminal write must not suppress an explicit fresh retry")
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
	waiting, err := store.WaitChatAgentTask(second.TaskID, "worker-2", notBefore, "still generating", false)
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

func TestChatAgentAffinityClaimPrefersResidentLaneAndExcludesOthers(t *testing.T) {
	store := NewStore()
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:a")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-b", "conv-b", "await:b")); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTaskWithOptions("worker-1", 30*time.Second, ChatAgentClaimOptions{
		PreferredLane: "c:conv-b", FallbackMode: ChatAgentClaimResidentOnly,
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.ConversationID != "conv-b" {
		t.Fatalf("resident claim=%#v want conv-b", claimed)
	}
	if _, err := store.CompleteChatAgentTask(claimed.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	claimed, err = store.ClaimChatAgentTaskWithOptions("worker-2", 30*time.Second, ChatAgentClaimOptions{
		ExcludedLanes: []string{"c:conv-b"}, FallbackMode: ChatAgentClaimUnresidentOnly,
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.ConversationID != "conv-a" {
		t.Fatalf("unresident claim=%#v want conv-a", claimed)
	}
}

func TestListChatAgentTasksActiveOnlyExcludesSettledHistory(t *testing.T) {
	store := NewStore()
	done, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-done", "conv-done", ""))
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
	active, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-active", "conv-active", "await:active"))
	if err != nil {
		t.Fatal(err)
	}

	items, err := store.ListChatAgentTasks(ChatAgentTaskFilter{ActiveOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].TaskID != active.TaskID {
		t.Fatalf("active items=%#v want only %s", items, active.TaskID)
	}
}

func TestChatAgentClaimOptionsValidation(t *testing.T) {
	if _, err := normalizeChatAgentClaimOptions(ChatAgentClaimOptions{FallbackMode: ChatAgentClaimResidentOnly}); err == nil {
		t.Fatal("resident_only without preferred lane must fail")
	}
	if _, err := normalizeChatAgentClaimOptions(ChatAgentClaimOptions{FallbackMode: "surprise"}); err == nil {
		t.Fatal("unknown fallback mode must fail")
	}
}

func TestChatAgentTranslationHasPriorityAndReturnsCompletionPayload(t *testing.T) {
	store := NewStore()
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("BOT_WRITE", "chat-write", "conv-write", "")); err != nil {
		t.Fatal(err)
	}
	translation, err := store.EnqueueChatAgentTask(ChatAgentTask{
		Type: "TRANSLATE_MARKDOWN", ChatID: "chat-translation",
		Payload: json.RawMessage(`{"protocol":"harness.utility/v1","task":"translate_markdown","target_language":"pt","markdown":"Hello"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.TaskID != translation.TaskID || claimed.Priority != -1 {
		t.Fatalf("translation claim=%#v want highest-priority task %s", claimed, translation.TaskID)
	}
	resultPayload := json.RawMessage(`{"protocol":"harness.utility/v1","task":"translate_markdown","target_language":"pt","markdown":"Olá"}`)
	completed, err := store.CompleteChatAgentTaskWithPayload(claimed.TaskID, "worker-1", resultPayload)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != ChatAgentTaskDone || string(completed.Payload) != string(resultPayload) {
		t.Fatalf("completed translation=%#v", completed)
	}
	loaded, err := store.GetChatAgentTask(claimed.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if string(loaded.Payload) != string(resultPayload) {
		t.Fatalf("persisted payload=%s want %s", loaded.Payload, resultPayload)
	}
}
