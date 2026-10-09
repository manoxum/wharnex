package postintegration_test

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

type unsupportedAcceptance struct{}

func (unsupportedAcceptance) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	return planner.Result{Turn: &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: request.RequestID,
		Kind: domain.TurnKindAnswer, Message: "Runtime fixed", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}}, nil
}

func TestProviderCannotBypassInitialRuntimeObservation(t *testing.T) {
	service, store, started := integratedFixture(t, unsupportedAcceptance{})
	_, _, err := service.SubmitPostIntegrationObservation(t.Context(), started.ID, "Check real runtime")
	if err == nil || !strings.Contains(err.Error(), "post-integration evidence must first gather runtime observations") {
		t.Fatalf("provider must obey the same runtime boundary: %v", err)
	}
	current, err := store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.PlannerInFlight || current.LastTurn != nil {
		t.Fatal("rejected runtime acceptance must not remain inflight or accepted")
	}
}
