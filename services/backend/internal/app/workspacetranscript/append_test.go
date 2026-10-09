package workspacetranscript_test

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestTranscriptAppendIsBoundAndSurvivesStaleReplacement(t *testing.T) {
	store := session.NewStore()
	service := app.NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	item, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetChatID(item.ID, "chat-append"); err != nil {
		t.Fatal(err)
	}
	chat := domain.WorkspaceChat{ID: "chat-append", SessionID: item.ID, ProjectPath: item.ProjectPath, Title: "Append"}
	if _, err := service.SaveWorkspaceChat(chat); err != nil {
		t.Fatal(err)
	}
	entry := domain.WorkspaceChatItem{ID: "restored-request", Payload: map[string]any{"role": "user", "text": "original prompt"}}
	for range 2 {
		if err := service.AppendWorkspaceChatItems(chat.ID, []domain.WorkspaceChatItem{entry}); err != nil {
			t.Fatal(err)
		}
	}
	if err := service.ReplaceWorkspaceChatItems(chat.ID, nil); err != nil {
		t.Fatal(err)
	}
	items, err := service.ListWorkspaceChatItems(chat.ID)
	if err != nil || len(items) != 1 || items[0].Payload["id"] != entry.ID {
		t.Fatalf("append failed to remain idempotent and durable: %#v, %v", items, err)
	}
	chat.ID = "other-chat"
	if _, err := service.SaveWorkspaceChat(chat); err != nil {
		t.Fatal(err)
	}
	if err := service.AppendWorkspaceChatItems(chat.ID, []domain.WorkspaceChatItem{entry}); err == nil {
		t.Fatal("another chat appended into the bound session transcript")
	}
}
