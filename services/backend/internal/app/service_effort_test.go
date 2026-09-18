package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestEffortPoliciesExposeRequestedBudgets(t *testing.T) {
	tests := []struct {
		level      domain.EffortLevel
		max        int
		continuous bool
	}{
		{domain.EffortLevelLow, 1, false},
		{domain.EffortLevelMedium, 3, false},
		{domain.EffortLevelHigh, 6, false},
		{domain.EffortLevelExtraHigh, 10, true},
		{domain.EffortLevelMax, 15, true},
		{domain.EffortLevelUltra, 30, true},
		{domain.EffortLevelLoop, 0, true},
	}
	for _, test := range tests {
		policy := policyForEffort(test.level)
		if policy.MaxAttempts != test.max || policy.ContinuousImprovement != test.continuous {
			t.Fatalf("effort %s: got %+v, want max=%d continuous=%t", test.level, policy, test.max, test.continuous)
		}
	}
}

func TestLowHasNoAutomaticCorrectionAfterInitialAttempt(t *testing.T) {
	item := domain.Session{EffortLevel: domain.EffortLevelLow, AutomationMode: domain.AutomationModeAuto, AutomationAttempt: 1}
	if effortAttemptAvailable(item) {
		t.Fatal("low must stop after the initial autonomous attempt")
	}
	if shouldContinueImprovement(item) {
		t.Fatal("low must not enter continuous improvement")
	}
}

func TestLoopHasNoNumericCeilingButStillNeedsAutoModeForImprovement(t *testing.T) {
	item := domain.Session{EffortLevel: domain.EffortLevelLoop, AutomationMode: domain.AutomationModeAuto, AutomationAttempt: 1000000}
	if !effortAttemptAvailable(item) || !shouldContinueImprovement(item) {
		t.Fatal("loop should remain eligible while the planner reports worthwhile work")
	}
	item.AutomationMode = domain.AutomationModeManual
	if shouldContinueImprovement(item) {
		t.Fatal("manual mode must never launch autonomous improvement")
	}
}

func TestStructuredInterviewDoesNotSpendAutomaticEffort(t *testing.T) {
	turn := &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_interview", Kind: domain.TurnKindClarification, Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}, Interview: &domain.Interview{Protocol: domain.InterviewProtocolV2, Questions: []domain.InterviewQuestion{{ID: "scope", Prompt: "Escopo?", AllowOther: true, Options: []domain.InterviewOption{{ID: "a", Label: "A"}, {ID: "b", Label: "B"}}}}}}
	item := domain.Session{EffortLevel: domain.EffortLevelLow, AutomationMode: domain.AutomationModeAuto, AutomationAttempt: 1, LastRequestID: turn.RequestID, LastTurn: turn}
	creditStructuredInterviewRound(&item, turn)
	if item.AutomationAttempt != 0 || automaticAttemptsSpent(item) != 0 || !effortAttemptAvailable(item) {
		t.Fatalf("interview consumed effort: attempt=%d spent=%d", item.AutomationAttempt, automaticAttemptsSpent(item))
	}
}

func TestLegacyStructuredInterviewKeepsPriorRepairEffort(t *testing.T) {
	turn := &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: "req_interview", Kind: domain.TurnKindClarification, Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}, Interview: &domain.Interview{Protocol: domain.InterviewProtocolV1, Questions: []domain.InterviewQuestion{{ID: "scope", Prompt: "Escopo?", Options: []domain.InterviewOption{{ID: "a", Label: "A"}, {ID: "b", Label: "B"}}}}}}
	item := domain.Session{AutomationAttempt: 0, RepairAttempt: 2, LastRequestID: turn.RequestID, LastTurn: turn}
	if spent := automaticAttemptsSpent(item); spent != 2 {
		t.Fatalf("legacy interview should credit only its own round and preserve earlier repair effort: got %d", spent)
	}
}
