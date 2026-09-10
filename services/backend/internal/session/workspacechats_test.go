package session

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func chatFixture(id, project string) domain.WorkspaceChat {
	now := time.Now().UTC()
	return domain.WorkspaceChat{
		ID: id, ProjectPath: project, SessionID: "ses_" + id, Title: "chat " + id,
		CreatedAt: now, UpdatedAt: now,
	}
}

func TestWorkspaceChatsRoundTrip(t *testing.T) {
	store := NewStore()
	project := "/home/u/project"

	if err := store.SaveWorkspaceChat(chatFixture("a", project)); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := store.SaveWorkspaceChat(chatFixture("b", project)); err != nil {
		t.Fatalf("save: %v", err)
	}
	chats, err := store.ListWorkspaceChats(project)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(chats) != 2 {
		t.Fatalf("expected 2 chats, got %d", len(chats))
	}
}

// The renderer writes the same chat repeatedly as its title, binding and
// archive state change, so saving must update rather than duplicate.
func TestSaveWorkspaceChatIsAnUpsert(t *testing.T) {
	store := NewStore()
	project := "/home/u/project"
	chat := chatFixture("a", project)
	if err := store.SaveWorkspaceChat(chat); err != nil {
		t.Fatalf("save: %v", err)
	}
	chat.Title = "renamed"
	chat.ChatGPTURL = "https://chatgpt.com/c/abc"
	if err := store.SaveWorkspaceChat(chat); err != nil {
		t.Fatalf("resave: %v", err)
	}
	chats, _ := store.ListWorkspaceChats(project)
	if len(chats) != 1 {
		t.Fatalf("expected the chat to be updated, got %d rows", len(chats))
	}
	if chats[0].Title != "renamed" || chats[0].ChatGPTURL != "https://chatgpt.com/c/abc" {
		t.Fatalf("expected the update to stick, got %+v", chats[0])
	}
}

// Archiving is a state change, not a delete: an archived chat must remain
// listable so it can be restored.
func TestArchivedChatsRemainStored(t *testing.T) {
	store := NewStore()
	project := "/home/u/project"
	chat := chatFixture("a", project)
	archivedAt := time.Now().UTC()
	chat.ArchivedAt = &archivedAt
	if err := store.SaveWorkspaceChat(chat); err != nil {
		t.Fatalf("save: %v", err)
	}
	chats, _ := store.ListWorkspaceChats(project)
	if len(chats) != 1 || !chats[0].Archived() {
		t.Fatalf("expected one archived chat, got %+v", chats)
	}
}

func TestWorkspaceChatItemsReplaceWholeTranscript(t *testing.T) {
	store := NewStore()
	items := []domain.WorkspaceChatItem{
		{ID: "1", ChatID: "a", CreatedAt: time.Now().UTC(), Payload: map[string]any{"text": "primeiro"}},
		{ID: "2", ChatID: "a", CreatedAt: time.Now().UTC(), Payload: map[string]any{"text": "segundo"}},
	}
	if err := store.ReplaceWorkspaceChatItems("a", items); err != nil {
		t.Fatalf("replace: %v", err)
	}
	stored, err := store.ListWorkspaceChatItems("a")
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	if len(stored) != 2 {
		t.Fatalf("expected 2 items, got %d", len(stored))
	}

	if err := store.ReplaceWorkspaceChatItems("a", items[:1]); err != nil {
		t.Fatalf("shrink: %v", err)
	}
	stored, _ = store.ListWorkspaceChatItems("a")
	if len(stored) != 1 {
		t.Fatalf("expected the transcript to be replaced, got %d items", len(stored))
	}
}

// A transcript is bounded so one runaway chat cannot grow without limit.
func TestWorkspaceChatItemsAreBounded(t *testing.T) {
	store := NewStore()
	items := make([]domain.WorkspaceChatItem, 0, maxChatItemsPerChat+50)
	for i := 0; i < maxChatItemsPerChat+50; i++ {
		items = append(items, domain.WorkspaceChatItem{ID: string(rune('a'+i%26)) + time.Now().Format("150405.000000000"), ChatID: "a", Payload: map[string]any{"i": i}})
	}
	if err := store.ReplaceWorkspaceChatItems("a", items); err != nil {
		t.Fatalf("replace: %v", err)
	}
	stored, _ := store.ListWorkspaceChatItems("a")
	if len(stored) > maxChatItemsPerChat {
		t.Fatalf("expected at most %d items, got %d", maxChatItemsPerChat, len(stored))
	}
}

func TestDeleteWorkspaceChatRemovesItsTranscript(t *testing.T) {
	store := NewStore()
	project := "/home/u/project"
	_ = store.SaveWorkspaceChat(chatFixture("a", project))
	_ = store.ReplaceWorkspaceChatItems("a", []domain.WorkspaceChatItem{{ID: "1", ChatID: "a", Payload: map[string]any{"t": 1}}})

	if err := store.DeleteWorkspaceChat("a"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	chats, _ := store.ListWorkspaceChats(project)
	if len(chats) != 0 {
		t.Fatalf("expected the chat to be gone, got %d", len(chats))
	}
	items, _ := store.ListWorkspaceChatItems("a")
	if len(items) != 0 {
		t.Fatalf("expected the transcript to be gone, got %d", len(items))
	}
}

func TestWorkspaceChatsRejectMissingIdentity(t *testing.T) {
	store := NewStore()
	if err := store.SaveWorkspaceChat(domain.WorkspaceChat{ProjectPath: "/p"}); err == nil {
		t.Fatal("expected a chat without an id to be refused")
	}
	if err := store.SaveWorkspaceChat(domain.WorkspaceChat{ID: "a"}); err == nil {
		t.Fatal("expected a chat without a project to be refused")
	}
	if _, err := store.ListWorkspaceChats(""); err == nil {
		t.Fatal("expected listing without a project to be refused")
	}
}
