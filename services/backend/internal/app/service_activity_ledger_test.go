package app

import (
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

// The ledger is exercised directly: it is written at seams spread across the
// whole execution lifecycle, and driving a full run here would test the runner
// rather than the record.
func newLedgerService(t *testing.T) (*Service, string) {
	t.Helper()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	return service, "ses-ledger"
}

func ledgerEvents(events []domain.Event, kind string) []domain.Event {
	out := make([]domain.Event, 0, len(events))
	for _, event := range events {
		if event.Type == kind {
			out = append(out, event)
		}
	}
	return out
}

// The session snapshot keeps one plan and one execution and clears both on
// several transitions, so the ledger has to be the durable record instead.
func TestExecutionLedgerKeepsEveryRoundNotOnlyTheLatest(t *testing.T) {
	service, sessionID := newLedgerService(t)

	for _, result := range []domain.ExecutionResult{
		{PlanID: "plan-1", Success: false, StartedAt: time.Now().UTC(), Error: "typecheck failed"},
		{PlanID: "plan-2", Success: false, StartedAt: time.Now().UTC(), Error: "lint failed"},
		{PlanID: "plan-3", Success: true, StartedAt: time.Now().UTC()},
	} {
		service.recordExecutionActivity(sessionID, "req-1", result)
	}

	recorded := ledgerEvents(service.bus.History(sessionID), EventExecutionRecorded)
	if len(recorded) != 3 {
		t.Fatalf("recorded %d executions, want every round", len(recorded))
	}
	for index, want := range []string{"plan-1", "plan-2", "plan-3"} {
		if got, _ := recorded[index].Data["plan_id"].(string); got != want {
			t.Fatalf("execution %d plan_id=%q want %q", index, got, want)
		}
		if _, ok := recorded[index].Data["execution"].(map[string]any); !ok {
			t.Fatalf("execution %d must carry its body, got %#v", index, recorded[index].Data)
		}
	}
}

func TestPlanLedgerCarriesTheWholePlanBody(t *testing.T) {
	service, sessionID := newLedgerService(t)
	service.recordPlanActivity(sessionID, &domain.ExecutionPlan{
		PlanID: "plan-1", RequestID: "req-1", Summary: "add the durable ledger",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "diff --git a/x b/x"}},
	})

	recorded := ledgerEvents(service.bus.History(sessionID), EventPlanRecorded)
	if len(recorded) != 1 {
		t.Fatalf("recorded %d plans, want 1", len(recorded))
	}
	plan, ok := recorded[0].Data["plan"].(map[string]any)
	if !ok {
		t.Fatalf("plan body missing: %#v", recorded[0].Data)
	}
	if summary, _ := plan["summary"].(string); summary != "add the durable ledger" {
		t.Fatalf("plan summary=%q", summary)
	}
	operations, ok := plan["operations"].([]any)
	if !ok || len(operations) != 1 {
		t.Fatalf("plan operations missing: %#v", plan)
	}
}

// The bodies pass through the audit bus precisely so its redaction and length
// bound apply to them; recording them raw would turn the ledger into a leak.
func TestLedgerBodiesAreSanitizedLikeAnyOtherEvent(t *testing.T) {
	service, sessionID := newLedgerService(t)
	service.recordExecutionActivity(sessionID, "req-1", domain.ExecutionResult{
		PlanID: "plan-1",
		Commands: []domain.CommandResult{{
			Argv: []string{"npm", "test"}, Stdout: "token=hunter2", Stderr: strings.Repeat("y", 9000),
		}},
	})

	recorded := ledgerEvents(service.bus.History(sessionID), EventExecutionRecorded)
	if len(recorded) != 1 {
		t.Fatalf("recorded %d executions, want 1", len(recorded))
	}
	execution := recorded[0].Data["execution"].(map[string]any)
	command := execution["commands"].([]any)[0].(map[string]any)
	if stdout, _ := command["stdout"].(string); !strings.Contains(stdout, "[REDACTED]") {
		t.Fatalf("command stdout must be redacted, got %q", stdout)
	}
	if stderr, _ := command["stderr"].(string); !strings.HasSuffix(stderr, "…[truncated]") {
		t.Fatalf("command stderr must be bounded, got %d bytes", len(stderr))
	}
}
