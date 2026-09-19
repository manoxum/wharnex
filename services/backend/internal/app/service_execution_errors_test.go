package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

func TestExecutionErrorLedgerCapturesFailureAndGPTResolution(t *testing.T) {
	store := session.NewStore()
	item := domain.Session{
		ID: "ses_error", ChatID: "chat_123", LastRequestID: "req_root",
		Plan: &domain.ExecutionPlan{PlanID: "plan_failed", RequestID: "req_root"},
		RequestLineages: map[string]domain.RequestLineage{
			"req_root": {RequestID: "req_root", RootRequestID: "req_root", Kind: requestKindStandard},
			"req_fix":  {RequestID: "req_fix", RootRequestID: "req_root", ParentRequestID: "req_root", Kind: requestKindRepair},
		},
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: audit.NewBus()}
	result := domain.ExecutionResult{
		PlanID: "plan_failed", StartedAt: time.Now().UTC(), Commands: []domain.CommandResult{{
			Argv: []string{"go", "test", "./...", "token=super-secret"}, Cwd: "services/backend/token=super-secret", ExitCode: 17,
			Success: false, Stderr: "token=super-secret compile failed", DurationMS: 33,
		}},
	}
	service.recordExecutionFailure(item.ID, result, errors.New("token=super-secret verification failed"))

	records, err := service.ExecutionErrors(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("execution error records = %d, want 1", len(records))
	}
	record := records[0]
	if record.ChatID != "chat_123" || record.RootRequestID != "req_root" || record.PlanID != "plan_failed" {
		t.Fatalf("unexpected identity: %#v", record)
	}
	if record.StatusCode == nil || *record.StatusCode != 17 || len(record.Logs) != 1 {
		t.Fatalf("expected failed command status/logs, got %#v", record)
	}
	if strings.Contains(record.Error, "super-secret") || strings.Contains(record.Logs[0].Stderr, "super-secret") ||
		strings.Contains(strings.Join(record.Logs[0].Argv, " "), "super-secret") || strings.Contains(record.Logs[0].Cwd, "super-secret") {
		t.Fatalf("secret leaked into durable execution error record: %#v", record)
	}

	repairPlan := domain.ExecutionPlan{
		PlanID: "plan_fix", RequestID: "req_fix", Summary: "Corrige a validação que falhava.",
		CommitMessage: "fix(exec): correct failing validation\n\nKeep the repair tied to the recorded failure.",
	}
	service.resolveExecutionFailuresWithGPT(item.ID, item, repairPlan)
	records, err = service.ExecutionErrors(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	resolved := records[0]
	if resolved.Status != domain.ExecutionErrorStatusSolved || resolved.ResolvedAt == nil || resolved.GPTSolution == nil {
		t.Fatalf("execution error was not resolved: %#v", resolved)
	}
	if resolved.GPTSolution.RequestID != "req_fix" || resolved.GPTSolution.PlanID != "plan_fix" || resolved.GPTSolution.Summary != repairPlan.Summary {
		t.Fatalf("unexpected GPT solution: %#v", resolved.GPTSolution)
	}
}
