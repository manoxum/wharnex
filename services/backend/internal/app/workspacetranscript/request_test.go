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

func TestSubmittedAPIMessageIsVisibleInBoundChat(t *testing.T) {
	store := session.NewStore()
	service := app.NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	item, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetChatID(item.ID, "chat-api"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveWorkspaceChat(domain.WorkspaceChat{ID: "chat-api", SessionID: item.ID, ProjectPath: item.ProjectPath, Title: "API"}); err != nil {
		t.Fatal(err)
	}
	_, submitted, err := service.SubmitMessage(context.Background(), item.ID, "inspect this project")
	if err != nil {
		t.Fatal(err)
	}
	items, err := service.ListWorkspaceChatItems("chat-api")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Payload["text"] != "inspect this project" {
		t.Fatalf("accepted request %s is missing from the durable chat: %#v", submitted.LastRequestID, items)
	}
}
