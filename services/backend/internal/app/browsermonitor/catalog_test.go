package browsermonitor

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

func TestBuildIncludesCreatedSupervisorAndWorkerChats(t *testing.T) {
	now := time.Now().UTC()
	workspace := []domain.WorkspaceChat{{ID: "chat-1", ProjectPath: "/work", SessionID: "ses-1", Title: "Implementar painel", ChatGPTURL: "https://chatgpt.com/c/supervisor-id?private=1", CreatedAt: now}}
	tasks := []orchestrator.Task{{ID: "otk-1", ProjectPath: "/work", Title: "Worker da execução", ConversationURL: "https://chatgpt.com/c/worker-id", CreatedAt: now}}
	planning := []session.ChatAgentTask{{Type: "ORCHESTRATOR_PLAN", ProjectID: "/work", ChatID: "orp-1", SessionID: "ses-1", ConversationID: "planning-id"}}
	chats := Build(workspace, tasks, planning, map[string]string{"/work": "ses-1"})
	if len(chats) != 3 {
		t.Fatalf("chats=%#v", chats)
	}
	if chats[0].Title != "Implementar painel" || chats[0].URL != "https://chatgpt.com/c/supervisor-id" {
		t.Fatalf("workspace=%#v", chats[0])
	}
	if chats[1].Kind != "planning" || chats[2].Kind != "task" {
		t.Fatalf("worker chats=%#v", chats)
	}
}

func TestBuildRejectsNonConversationURLs(t *testing.T) {
	chats := Build([]domain.WorkspaceChat{{ID: "chat", ChatGPTURL: "https://evil.example/c/private"}}, nil, nil, nil)
	if len(chats) != 0 {
		t.Fatalf("unsafe chats=%#v", chats)
	}
	if ConversationURL("https://chatgpt.com.evil/c/id") != "" || ConversationURL("https://chatgpt.com/c/id/extra") != "" {
		t.Fatal("accepted non-canonical URL")
	}
}

func TestConversationURLCanonicalizesProjectConversation(t *testing.T) {
	got := ConversationURL("https://chatgpt.com/g/g-p-team-project/c/conversation-123?model=auto")
	if got != "https://chatgpt.com/c/conversation-123" {
		t.Fatalf("project conversation=%q", got)
	}
	if ConversationURL("https://chatgpt.com/g/other/c/conversation-123") != "" {
		t.Fatal("accepted non-project conversation path")
	}
}
