package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestEffortPoliciesExposeRequestedBudgets(t *testing.T) {
	tests := []struct {
		level domain.EffortLevel
		max   int
	}{
		{domain.EffortLevelLow, 1},
		{domain.EffortLevelMedium, 3},
		{domain.EffortLevelHigh, 6},
		{domain.EffortLevelExtraHigh, 10},
		{domain.EffortLevelMax, 15},
		{domain.EffortLevelUltra, 30},
		{domain.EffortLevelLoop, 0},
	}
	for _, test := range tests {
		policy := policyForEffort(test.level)
		if policy.MaxAttempts != test.max {
			t.Fatalf("effort %s: got %+v, want max=%d", test.level, policy, test.max)
		}
	}
}

func TestLowHasNoAutomaticCorrectionAfterInitialAttempt(t *testing.T) {
	item := domain.Session{EffortLevel: domain.EffortLevelLow, AutomationMode: domain.AutomationModeAuto, AutomationAttempt: 1}
	if effortAttemptAvailable(item) {
		t.Fatal("low must stop after the initial autonomous attempt")
	}
}

func TestLoopHasNoNumericCorrectionCeiling(t *testing.T) {
	item := domain.Session{EffortLevel: domain.EffortLevelLoop, AutomationMode: domain.AutomationModeAuto, AutomationAttempt: 1000000}
	if !effortAttemptAvailable(item) {
		t.Fatal("loop should remain eligible for pre-success automatic correction")
	}
}
