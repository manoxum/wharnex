package app

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestProjectTodoClassificationIsImmediatelyClaimableByWorker(t *testing.T) {
	store := session.NewStore()
	project := t.TempDir()
	if err := store.Put(domain.Session{
		ID:          "ses-todo-classify",
		ChatID:      "chat-todo-classify",
		ProjectPath: project,
		CreatedAt:   time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	service := NewService(
		store,
		audit.NewBus(),
		contextbundle.NewBuilder(1<<20, 1<<20),
		manualplanner.New(),
		policy.NewEngine(),
		sandbox.NewLocalRunner(),
	)

	item, err := service.CreateProjectTodo("ses-todo-classify", ProjectTodoCreateInput{Body: "Corrigir login"})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := store.ClaimChatAgentTaskWithOptions("desktop:worker-1", time.Minute, session.ChatAgentClaimOptions{
		Role:          session.ChatAgentRoleWorker,
		WorkerID:      "worker-1",
		ProjectScoped: true,
		OpenProjects:  []string{project},
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil {
		t.Fatal("TODO classification must be claimable immediately after creation")
	}
	if claimed.TaskID != item.ClassificationTaskID || claimed.Type != "TODO_CLASSIFY" {
		t.Fatalf("unexpected task claimed: %#v", claimed)
	}
	if claimed.Priority != 5 {
		t.Fatalf("TODO classification priority = %d, want 5", claimed.Priority)
	}
}
