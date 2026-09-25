package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

// The codes planners actually returned when a pending candidate could not
// replay before their plan, plus the canonical one the contract now asks for.
func TestIntegrationBlockerReasonCodesNeedNoOperator(t *testing.T) {
	for _, code := range []string{"integration_action_required", "pending_integration_replay_blocked", "legacy_candidate_replay_conflict", "Integration_Reanchor_Required"} {
		outcome := &domain.TurnOutcome{Status: domain.TurnOutcomeFailed, ReasonCode: code, Message: "blocked by integration state"}
		if kind := classifyPlannerOutcomeFailure(outcome); kind != domain.FailureKindIntegrationActionRequired {
			t.Fatalf("%s classified as %q, want %q", code, kind, domain.FailureKindIntegrationActionRequired)
		}
	}
}

func TestIntegrationActionReappliesAProvenBatch(t *testing.T) {
	service, sessionID, host, candidate := parkedSession(t, domain.AutomationModeAutoApprove, nil)
	if _, err := service.store.Update(sessionID, func(item *domain.Session) error {
		item.FailureKind = domain.FailureKindIntegrationActionRequired
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	service.recoverIntegrationAction(context.Background(), sessionID, candidate.Plan.RequestID, "pending_integration_replay_blocked")
	recovered, err := service.store.Get(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != "applied" {
		t.Fatalf("state = %q, want applied", recovered.State)
	}
	if _, statErr := os.Stat(filepath.Join(host, "feature.txt")); statErr != nil {
		t.Fatalf("candidate content missing on host: %v", statErr)
	}
}

func TestIntegrationActionWithNothingToDoIsNamedNotSilent(t *testing.T) {
	service, sessionID, _, candidate := parkedSession(t, domain.AutomationModeManual, nil)
	service.recoverIntegrationAction(context.Background(), sessionID, candidate.Plan.RequestID, "integration_action_required")
	for _, event := range service.bus.History(sessionID) {
		if event.Type == "integration.action_unavailable" {
			return
		}
	}
	t.Fatal("an integration blocker the engine cannot act on must still be reported")
}

func TestManualPromptTellsThePlannerHowToReportIntegrationBlockers(t *testing.T) {
	prompt := planner.BuildManualPrompt(planner.Request{RequestID: "req_prompt", Message: "continue"})
	if !strings.Contains(prompt, "reason_code=integration_action_required") {
		t.Fatal("the bundle instruction must name the canonical integration blocker code")
	}
}
