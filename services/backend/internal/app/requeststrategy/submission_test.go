package requeststrategy

import (
	"testing"

	"kernl.local/harness/backend/internal/app/postintegration"
	"kernl.local/harness/backend/internal/domain"
)

func TestObservationRechecksLatestReceiptBeforeClaimingSession(t *testing.T) {
	plan := domain.ExecutionPlan{PlanID: "source", RequestID: "request"}
	execution := domain.ExecutionResult{PlanID: "source", Success: true}
	item := domain.Session{State: "applied", ExecutionMode: domain.ExecutionModeProtected,
		Plan: &plan, LastRequestID: "request", LastExecution: &execution,
		LastAppliedChanges: []domain.PendingHostChange{{Plan: plan, Execution: execution}}, ExecutionApprovedRootID: "root"}
	for _, parent := range []string{"stale", "request"} {
		busy := item
		busy.PlannerInFlight = parent == "request"
		if PrepareSubmission(&busy, postintegration.RequestKind, parent) == nil {
			t.Fatal("changed parent or concurrent request must refuse observation")
		}
		if busy.ExecutionApprovedRootID != "root" {
			t.Fatal("refusal changed source consent")
		}
	}
	if err := PrepareSubmission(&item, postintegration.RequestKind, "request"); err != nil {
		t.Fatal(err)
	}
	if item.ExecutionApprovedRootID != "" {
		t.Fatal("runtime request inherited source approval")
	}
}

func TestOnlyExplicitOperatorContinuationsBecomeUserPrompts(t *testing.T) {
	for _, kind := range []string{"repair", "evidence", "context_request", "conflict", "standard"} {
		if HasOperatorPrompt(false, kind) {
			t.Fatalf("automatic continuation misattributed to operator: %s", kind)
		}
	}
	for _, kind := range []string{"execution_plan_adjustment", postintegration.RequestKind} {
		if !HasOperatorPrompt(false, kind) {
			t.Fatalf("operator guidance hidden: %s", kind)
		}
	}
	if !HasOperatorPrompt(true, "standard") {
		t.Fatal("original Main prompt must remain visible")
	}
}

func TestProtocolRepairStillRequiresRuntimeObservation(t *testing.T) {
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		"post": {Kind: postintegration.RequestKind}, "repair": {Kind: "repair", ParentRequestID: "post"},
	}}
	turn := domain.AgentTurn{RequestID: "repair", Kind: domain.TurnKindAnswer}
	if ValidateResult(item, turn, nil) == nil || ValidateProviderResult(item, &turn, nil) == nil {
		t.Fatal("repair bypassed runtime observations")
	}
}
