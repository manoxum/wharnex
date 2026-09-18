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

func newProjectTodoTestService(t *testing.T) (*Service, *session.Store, string) {
	t.Helper()
	store := session.NewStore()
	project := t.TempDir()
	if err := store.Put(domain.Session{
		ID:          "ses-todo-manage",
		ChatID:      "chat-todo-manage",
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
	return service, store, project
}

func TestArchiveProjectTodoSetsAndClearsArchivedAt(t *testing.T) {
	service, _, _ := newProjectTodoTestService(t)
	item, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Corrigir login"})
	if err != nil {
		t.Fatal(err)
	}

	archived, err := service.ArchiveProjectTodo("ses-todo-manage", item.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if archived.ArchivedAt == nil {
		t.Fatal("expected ArchivedAt to be set after archiving")
	}

	restored, err := service.ArchiveProjectTodo("ses-todo-manage", item.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ArchivedAt != nil {
		t.Fatalf("expected ArchivedAt to be cleared after unarchiving, got %v", restored.ArchivedAt)
	}
}

func TestArchiveProjectTodoRejectsForeignProject(t *testing.T) {
	service, store, _ := newProjectTodoTestService(t)
	item, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Corrigir login"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(domain.Session{ID: "ses-other-project", ChatID: "chat-other", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ArchiveProjectTodo("ses-other-project", item.ID, true); err == nil {
		t.Fatal("expected archiving a TODO from a foreign project to fail")
	}
}

func TestDeleteProjectTodoRemovesIt(t *testing.T) {
	service, _, project := newProjectTodoTestService(t)
	item, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Corrigir login"})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteProjectTodo("ses-todo-manage", item.ID); err != nil {
		t.Fatal(err)
	}
	items, err := service.ListProjectTodos("ses-todo-manage")
	if err != nil {
		t.Fatal(err)
	}
	for _, remaining := range items {
		if remaining.ID == item.ID {
			t.Fatalf("expected TODO %s to be deleted from project %s", item.ID, project)
		}
	}
}

func TestDeleteProjectTodoRejectsForeignProject(t *testing.T) {
	service, store, _ := newProjectTodoTestService(t)
	item, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Corrigir login"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put(domain.Session{ID: "ses-other-project-2", ChatID: "chat-other-2", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteProjectTodo("ses-other-project-2", item.ID); err == nil {
		t.Fatal("expected deleting a TODO from a foreign project to fail")
	}
}
