package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

type relatedProjectPlanner struct {
	message string
}

func writeRelatedProjectFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func (plannerAdapter *relatedProjectPlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	plannerAdapter.message = request.Message
	turn := domain.AgentTurn{
		Protocol:  domain.TurnProtocolV1,
		RequestID: request.RequestID,
		Kind:      domain.TurnKindAnswer,
		Message:   "analyzed",
		Outcome:   &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted},
	}
	return planner.Result{Turn: &turn}, nil
}

func TestSetRelatedProjectsAddsNamespacedPlannerContextWithoutChangingExecutionRoot(t *testing.T) {
	primary := t.TempDir()
	related := t.TempDir()
	writeRelatedProjectFile(t, filepath.Join(primary, "primary.txt"), "primary")
	writeRelatedProjectFile(t, filepath.Join(related, "contract.txt"), "related contract")
	plannerAdapter := &relatedProjectPlanner{}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(2<<20, 4<<20), plannerAdapter, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), primary, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.SetRelatedProjects(context.Background(), started.ID, []string{related})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ProjectPath != started.ProjectPath || len(updated.RelatedProjectPaths) != 1 || len(updated.Context.RelatedProjects) != 1 {
		t.Fatalf("related project changed primary ownership or was not recorded: %#v", updated)
	}
	if _, _, err := service.SubmitMessage(context.Background(), started.ID, "compare contracts"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plannerAdapter.message, "MULTI-PROJECT WORKSPACE") || !strings.Contains(plannerAdapter.message, related) {
		t.Fatalf("planner did not receive related project scope: %q", plannerAdapter.message)
	}
}

func TestSetRelatedProjectsRejectsRelativePaths(t *testing.T) {
	primary := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 2<<20), &relatedProjectPlanner{}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), primary, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetRelatedProjects(context.Background(), started.ID, []string{"../other"}); err == nil || !strings.Contains(err.Error(), "must be absolute") {
		t.Fatalf("relative related project path was accepted: %v", err)
	}
}
