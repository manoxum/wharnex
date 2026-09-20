package app

import (
	"strings"
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

func TestProjectTodoExecutionLinksMultipleTodosToOneChatRequest(t *testing.T) {
	service, store, _ := newProjectTodoTestService(t)
	first, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Corrigir login"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Melhorar pesquisa"})
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.Get("ses-todo-manage")
	if err != nil {
		t.Fatal(err)
	}
	items, err := service.resolveProjectTodos(current.ProjectPath, []string{first.ID, second.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.linkProjectTodos(items, current, "req-todos", "chat"); err != nil {
		t.Fatal(err)
	}
	service.setProjectTodosByRequest("req-todos", domain.ProjectTodoExecutionDone, "")
	for _, id := range []string{first.ID, second.ID} {
		item, err := store.GetProjectTodo(id)
		if err != nil {
			t.Fatal(err)
		}
		if item.ExecutionStatus != domain.ProjectTodoExecutionDone || item.ExecutionRequestID != "req-todos" || item.ExecutionChatID != current.ChatID {
			t.Fatalf("todo %s execution linkage = %#v", id, item)
		}
	}
}

func TestProjectTodoExecutionTracksChatAgentFailure(t *testing.T) {
	service, store, _ := newProjectTodoTestService(t)
	item, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Executar migração"})
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.Get("ses-todo-manage")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.linkProjectTodos([]domain.ProjectTodo{item}, current, "req-failed", "chat"); err != nil {
		t.Fatal(err)
	}
	service.HandleChatAgentTaskTerminal(session.ChatAgentTask{
		RequestID: "req-failed", Status: session.ChatAgentTaskFailed, LastError: "provider timeout",
	})
	updated, err := store.GetProjectTodo(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ExecutionStatus != domain.ProjectTodoExecutionFailed || updated.ExecutionError != "provider timeout" {
		t.Fatalf("failed execution linkage = %#v", updated)
	}
}

func TestProjectTodoExecutionFollowsRequestLineage(t *testing.T) {
	service, store, _ := newProjectTodoTestService(t)
	item, err := service.CreateProjectTodo("ses-todo-manage", ProjectTodoCreateInput{Body: "Corrigir fluxo"})
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.Get("ses-todo-manage")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.linkProjectTodos([]domain.ProjectTodo{item}, current, "req-root", "chat"); err != nil {
		t.Fatal(err)
	}
	current.RequestLineages = map[string]domain.RequestLineage{
		"req-root":   {RequestID: "req-root", RootRequestID: "req-root"},
		"req-repair": {RequestID: "req-repair", RootRequestID: "req-root", ParentRequestID: "req-root"},
	}
	service.setProjectTodosByRequestLineage(current, "req-repair", domain.ProjectTodoExecutionDone, "")
	updated, err := store.GetProjectTodo(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ExecutionStatus != domain.ProjectTodoExecutionDone {
		t.Fatalf("lineage execution status = %q", updated.ExecutionStatus)
	}
}

func TestMessageWithProjectTodosCarriesWorkerAnalysisAndArtifacts(t *testing.T) {
	message := messageWithProjectTodos("Implementar @{[todo]todo-1}", []domain.ProjectTodo{{
		ID:                   "todo-1",
		Body:                 "Melhorar a pesquisa",
		Status:               "open",
		Kind:                 "improvement",
		Urgency:              "urgent",
		ClassificationStatus: "classified",
		Description:          "Preservar o fluxo atual enquanto a pesquisa é otimizada.",
		PrePlan:              []string{"Medir o fluxo atual.", " ", "Cobrir o comportamento com testes."},
		ProjectFiles:         []string{"services/frontend/src/search.ts"},
		Attachments:          []domain.ProjectTodoAttachment{{Name: "evidence.txt", MIME: "text/plain", StorageRef: "todo/evidence.txt"}},
	}})
	for _, want := range []string{
		"Melhorar a pesquisa",
		"Classification: status=classified, kind=improvement, urgency=urgent",
		"Worker context: Preservar o fluxo atual",
		"1. Medir o fluxo atual.",
		"2. Cobrir o comportamento com testes.",
		"services/frontend/src/search.ts",
		"evidence.txt",
		"Markdown pre-analysis attachment",
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("message must carry %q:\n%s", want, message)
		}
	}
}
