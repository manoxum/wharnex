package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestProtectedCorrectionResolvesExecutionErrorsOnlyAfterHostApply(t *testing.T) {
	requireGitForApp(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "repair-plan", Status: "ready", Summary: "repair hello", Risk: "low",
		CommitMessage: "fix(demo): repair hello",
		Operations:    []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	bus := audit.NewBus()
	store := session.NewStore()
	service := NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, planned, err := service.SubmitMessage(context.Background(), started.ID, "repair hello")
	if err != nil {
		t.Fatal(err)
	}
	repairRequestID := planned.LastRequestID
	const rootRequestID = "req_failed_root"
	planned, err = store.Update(started.ID, func(current *domain.Session) error {
		lineage := current.RequestLineages[repairRequestID]
		lineage.Kind = requestKindRepair
		lineage.RootRequestID = rootRequestID
		lineage.ParentRequestID = rootRequestID
		current.RequestLineages[repairRequestID] = lineage
		current.RequestLineages[rootRequestID] = domain.RequestLineage{RequestID: rootRequestID, RootRequestID: rootRequestID, Kind: requestKindStandard}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := store.RecordExecutionError(domain.ExecutionErrorRecord{
		ID: "err_prior", SessionID: started.ID, ChatID: planned.ChatID, RootRequestID: rootRequestID,
		RequestID: rootRequestID, PlanID: "failed-plan", Stage: executionErrorStageExecution,
		Error: "verification failed", Cause: "verification failed", Status: domain.ExecutionErrorStatusOpen,
		OccurredAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}

	result, verified, err := service.Execute(context.Background(), started.ID, false)
	if err != nil || !result.Success || verified.State != "verified" {
		t.Fatalf("protected repair did not verify: result=%#v state=%q err=%v", result, verified.State, err)
	}
	records, err := service.ExecutionErrors(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Status != domain.ExecutionErrorStatusOpen {
		t.Fatalf("sandbox verification resolved host evidence prematurely: %#v", records)
	}
	if countEvents(bus.History(started.ID), "execution.errors_resolved") != 0 {
		t.Fatal("execution.errors_resolved was emitted before host Apply")
	}

	applied, err := service.ApplyToHost(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	records, err = service.ExecutionErrors(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if records[0].Status != domain.ExecutionErrorStatusSolved || records[0].GPTSolution == nil || records[0].GPTSolution.RequestID != repairRequestID {
		t.Fatalf("host Apply did not resolve the prior error with the correction: %#v", records[0])
	}
	events := bus.History(started.ID)
	hostIndex, resolvedIndex := eventIndex(events, "host.applied"), eventIndex(events, "execution.errors_resolved")
	if hostIndex < 0 || resolvedIndex <= hostIndex {
		t.Fatalf("resolution must follow host.applied: host=%d resolved=%d", hostIndex, resolvedIndex)
	}

	service.resolveRecoveredAppliedExecutionFailures(applied)
	if got := countEvents(bus.History(started.ID), "execution.errors_resolved"); got != 1 {
		t.Fatalf("recovery emitted duplicate resolution events: %d", got)
	}
}

func TestFailureAttributionPrefersStructuredResourceExhaustionOverContextCanceled(t *testing.T) {
	result := domain.ExecutionResult{PlanID: "plan-resource", Commands: []domain.CommandResult{{
		Argv: []string{"go", "test", "./..."}, Cwd: "services/backend", ExitCode: 1, Success: false,
		Stderr: "link: mapping output file failed: no space left on device",
	}}}
	if got := executionFailureKind(result, context.Canceled); got != domain.FailureKindSandboxResourceExhausted {
		t.Fatalf("failure kind = %q, want %q", got, domain.FailureKindSandboxResourceExhausted)
	}
	if got := executionFailureKind(domain.ExecutionResult{}, context.Canceled); got != domain.FailureKindExecutionCanceled {
		t.Fatalf("plain cancellation kind = %q, want %q", got, domain.FailureKindExecutionCanceled)
	}
}

func TestResourceFailureUsesOneCanonicalKindAcrossEventsAndAttemptLedger(t *testing.T) {
	store := session.NewStore()
	bus := audit.NewBus()
	item := domain.Session{
		ID: "ses_resource_kind", ChatID: "chat_resource_kind", ProjectPath: t.TempDir(), LastRequestID: "req_resource",
		ExecutionMode: domain.ExecutionModeProtected, AutomationMode: domain.AutomationModeAuto,
		RequestLineages: map[string]domain.RequestLineage{
			"req_resource": {RequestID: "req_resource", RootRequestID: "req_resource", Kind: requestKindStandard},
		},
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: bus}
	result := domain.ExecutionResult{PlanID: "plan-resource", StartedAt: time.Now().UTC(), Commands: []domain.CommandResult{{
		Argv: []string{"go", "test", "./..."}, Cwd: "services/backend", ExitCode: 1, Success: false,
		Stderr: "link: mapping output file failed: no space left on device",
	}}}
	_, updated, err := service.failExecution(context.Background(), item.ID, result, context.Canceled)
	if err == nil {
		t.Fatal("resource failure unexpectedly succeeded")
	}
	want := domain.FailureKindSandboxResourceExhausted
	if updated.FailureKind != want || updated.State == "repair_pending" {
		t.Fatalf("unexpected failure state: kind=%q state=%q", updated.FailureKind, updated.State)
	}
	records, err := service.ExecutionErrors(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].FailureKind != want {
		t.Fatalf("error ledger did not use canonical kind: %#v", records)
	}
	for _, eventType := range []string{"execution.error_recorded", "execution.failed", "automation.infrastructure_blocked"} {
		if !eventHasFailureKind(bus.History(item.ID), eventType, want) {
			t.Fatalf("%s did not carry failure_kind=%s", eventType, want)
		}
	}
	if updated.AttemptLedger == nil || len(updated.AttemptLedger.Rounds) != 1 || !strings.Contains(updated.AttemptLedger.Rounds[0].Detail, want) {
		t.Fatalf("attempt ledger did not carry canonical kind: %#v", updated.AttemptLedger)
	}
}

func countEvents(events []domain.Event, eventType string) int {
	count := 0
	for _, event := range events {
		if event.Type == eventType {
			count++
		}
	}
	return count
}

func eventIndex(events []domain.Event, eventType string) int {
	for index, event := range events {
		if event.Type == eventType {
			return index
		}
	}
	return -1
}

func eventHasFailureKind(events []domain.Event, eventType, want string) bool {
	for _, event := range events {
		if event.Type != eventType {
			continue
		}
		if got, _ := event.Data["failure_kind"].(string); got == want {
			return true
		}
	}
	return false
}
