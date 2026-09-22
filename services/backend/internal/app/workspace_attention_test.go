package app

import (
	"testing"
	"time"

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
			Debug: &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Access: domain.DebugAccessModify, Rationale: "inspect the live runtime"},
		},
	})

	if !record.HasPlanDocument || record.PlanRequestID != "req-debug" || record.DebugTarget != "host" || record.DebugAccess != domain.DebugAccessModify || record.DebugRationale == "" {
		t.Fatalf("compact projection lost an operator decision input: %+v", record)
	}
}

func TestAttentionRecordProjectsCompletionAndRestartNotificationMetadata(t *testing.T) {
	appliedAt := time.Date(2026, time.September, 22, 18, 47, 0, 123000000, time.UTC)
	record := attentionRecordFor(domain.Session{
		ID: "ses-complete", State: "restart_pending", SelfEvolution: true,
		SelfEvolutionActivation: "restart_pending", SelfEvolutionImpacts: []string{"frontend", "desktop"},
		LastHostAppliedAt: appliedAt, PendingKnowledgeReviewRequestID: "req-review",
	})

	if !record.SelfEvolution || record.SelfEvolutionActivation != "restart_pending" || len(record.SelfEvolutionImpacts) != 2 {
		t.Fatalf("compact projection lost self-evolution completion metadata: %+v", record)
	}
	if record.LastHostAppliedAt != appliedAt.Format(time.RFC3339Nano) || record.PendingKnowledgeReview != "req-review" {
		t.Fatalf("compact projection lost completion readiness metadata: %+v", record)
	}
}
