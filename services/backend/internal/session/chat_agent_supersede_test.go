package session

import (
	"testing"
	"time"
)

func TestQueueingAChatDeletionRetiresThatChatsRemainingWork(t *testing.T) {
	store := NewStore()
	for _, task := range []ChatAgentTask{
		testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"),
		testChatAgentTask("TITLE_DISCOVER", "chat-a", "conv-a", "title:conv-a"),
		testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "organize:conv-a"),
		// Remote cleanup survives: it is what deletion still has to accomplish.
		testChatAgentTask("DELETE_BUNDLE", "chat-a", "", "bundle:req-1"),
		// A different chat is untouched by this chat's deletion.
		testChatAgentTask("AWAIT_RESPONSE", "chat-b", "conv-b", "await:req-2"),
	} {
		if _, err := store.EnqueueChatAgentTask(task); err != nil {
			t.Fatal(err)
		}
	}

	deletion, err := store.EnqueueChatAgentTask(testChatAgentTask("DELETE_CHAT", "chat-a", "conv-a", "delete:conv-a"))
	if err != nil {
		t.Fatal(err)
	}

	tasks, err := store.ListChatAgentTasks(ChatAgentTaskFilter{})
	if err != nil {
		t.Fatal(err)
	}
	active := map[string]string{}
	for _, task := range tasks {
		if chatAgentTaskActive(task.Status) {
			active[task.Type+":"+task.ChatID] = task.Status
		}
	}
	for _, retired := range []string{"AWAIT_RESPONSE:chat-a", "TITLE_DISCOVER:chat-a", "ORGANIZE_CHAT:chat-a"} {
		if status, ok := active[retired]; ok {
			t.Fatalf("%s should be superseded by the deletion, still %s", retired, status)
		}
	}
	for _, kept := range []string{"DELETE_BUNDLE:chat-a", "AWAIT_RESPONSE:chat-b", "DELETE_CHAT:chat-a"} {
		if _, ok := active[kept]; !ok {
			t.Fatalf("%s must stay claimable after the deletion was queued", kept)
		}
	}
	if deletion.Status != ChatAgentTaskPending {
		t.Fatalf("the deletion job itself must stay pending, got %s", deletion.Status)
	}
}

func TestSupersedingADeletedChatCancelsALeasedTask(t *testing.T) {
	store := NewStore()
	queued, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.TaskID != queued.TaskID {
		t.Fatalf("expected the queued task to be claimable, got %+v", claimed)
	}

	// A worker already holding the lease must not keep working a deleted chat.
	count, err := store.SupersedeChatAgentTasksForDeletedChat("chat-a", "")
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("superseded %d tasks, want 1", count)
	}
	after, err := store.GetChatAgentTask(queued.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != ChatAgentTaskCancelled {
		t.Fatalf("status=%s want CANCELLED", after.Status)
	}
	if after.LeaseOwner != "" || after.LeaseExpiresAt != nil {
		t.Fatalf("a superseded task must release its lease, got owner=%q expires=%v", after.LeaseOwner, after.LeaseExpiresAt)
	}
}

// Measured on this instance: ORGANIZE_CHAT ran from 17:42 to 18:40 against the
// exact conversation whose AWAIT_RESPONSE was supervising a response from 17:43
// to 18:46, and that request ended with no bundle. The lease lock could not stop
// it, because AWAIT_RESPONSE is in WAITING between its 30-second observations.
func TestAConversationProducingAResponseIsQuiet(t *testing.T) {
	store := NewStore()
	await, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	// DELETE_CHAT is deliberately absent: queueing it retires this chat's
	// supervision outright, so it can never be the task that interrupts it.
	for _, quiet := range []string{"ORGANIZE_CHAT", "TITLE_DISCOVER", "TITLE_GENERATE_TEMP", "RENAME_CHAT", "ARCHIVE_CHAT"} {
		if _, err := store.EnqueueChatAgentTask(testChatAgentTask(quiet, "chat-a", "conv-a", quiet+":conv-a")); err != nil {
			t.Fatal(err)
		}
	}

	// The supervision itself claims first, then releases its lease to WAITING.
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.TaskID != await.TaskID {
		t.Fatalf("the supervision must be claimed first, got %+v", claimed)
	}
	if _, err := store.WaitChatAgentTask(await.TaskID, "worker-1", time.Now().UTC().Add(-time.Second), "", true); err != nil {
		t.Fatal(err)
	}

	// This is the window that used to hand the conversation to account work.
	for _, owner := range []string{"worker-2", "worker-3"} {
		next, claimErr := store.ClaimChatAgentTask(owner, 30*time.Second)
		if claimErr != nil {
			t.Fatal(claimErr)
		}
		if next != nil && next.TaskID != await.TaskID {
			t.Fatalf("%s claimed %s on a conversation that is still producing a response", owner, next.Type)
		}
	}
}

func TestQuietPeriodLiftsWhenSupervisionSettles(t *testing.T) {
	store := NewStore()
	await, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1"))
	if err != nil {
		t.Fatal(err)
	}
	organize, err := store.EnqueueChatAgentTask(testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "organize:conv-a"))
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != await.TaskID {
		t.Fatalf("claim=%+v err=%v", claimed, err)
	}
	if _, err := store.CompleteChatAgentTask(await.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	next, err := store.ClaimChatAgentTask("worker-2", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if next == nil || next.TaskID != organize.TaskID {
		t.Fatalf("organization must run once the response settled, got %+v", next)
	}
}

// A supervision that can never be claimed again must not silence its
// conversation for good; the chat would never be organized or renamed.
func TestAnExhaustedSupervisionDoesNotSilenceTheConversationForever(t *testing.T) {
	store := NewStore()
	if _, err := store.EnqueueChatAgentTask(ChatAgentTask{
		Type: "AWAIT_RESPONSE", ChatID: "chat-a", ConversationID: "conv-a",
		DedupeKey: "await:req-1", MaxAttempts: 1,
	}); err != nil {
		t.Fatal(err)
	}
	organize, err := store.EnqueueChatAgentTask(testChatAgentTask("ORGANIZE_CHAT", "chat-a", "conv-a", "organize:conv-a"))
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil {
		t.Fatalf("claim=%+v err=%v", claimed, err)
	}
	// Back to WAITING on its final attempt: never claimable again.
	if _, err := store.WaitChatAgentTask(claimed.TaskID, "worker-1", time.Now().UTC().Add(-time.Second), "", false); err != nil {
		t.Fatal(err)
	}
	next, err := store.ClaimChatAgentTask("worker-2", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if next == nil || next.TaskID != organize.TaskID {
		t.Fatalf("an exhausted supervision must not block organization, got %+v", next)
	}
}
