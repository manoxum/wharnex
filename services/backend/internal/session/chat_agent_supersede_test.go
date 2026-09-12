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
