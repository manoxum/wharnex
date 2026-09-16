package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestAttentionRecordOmitsResolvedBlockedTurnAfterApply(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindBlocked, Message: "remove .git/index.lock"}
	record := attentionRecordFor(domain.Session{
		ID: "ses-applied", State: "applied", LastTurn: &turn, LastManualPrompt: "stale retry prompt",
	})

	if record.LastTurn != nil || record.HasManualPrompt {
		t.Fatalf("applied session still projects resolved operator attention: %+v", record)
	}
}

func TestAttentionRecordKeepsCurrentBlockedTurn(t *testing.T) {
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindBlocked, Message: "operator action required"}
	record := attentionRecordFor(domain.Session{
		ID: "ses-blocked", State: "blocked", LastTurn: &turn, LastManualPrompt: "retry prompt",
	})

	if record.LastTurn == nil || !record.HasManualPrompt {
		t.Fatalf("current operator attention was hidden: %+v", record)
	}
}

func TestAttentionRecordKeepsConsentAndDebugDecisionMetadata(t *testing.T) {
	record := attentionRecordFor(domain.Session{
		ID: "ses-debug", State: "debug_approval_required",
		Plan: &domain.ExecutionPlan{
			PlanID: "plan-debug", RequestID: "req-debug", Document: "# Execution contract",
			Debug: &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Rationale: "inspect the live runtime"},
		},
	})

	if !record.HasPlanDocument || record.PlanRequestID != "req-debug" || record.DebugTarget != "host" || record.DebugRationale == "" {
		t.Fatalf("compact projection lost an operator decision input: %+v", record)
	}
}
