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
		{domain.EffortLevelLow, 3},
		{domain.EffortLevelMedium, 8},
		{domain.EffortLevelHigh, 15},
		{domain.EffortLevelExtraHigh, 20},
		{domain.EffortLevelMax, 30},
		{domain.EffortLevelUltra, 50},
		{domain.EffortLevelLoop, 0},
	}
	for _, test := range tests {
		policy := policyForEffort(test.level)
		if policy.MaxAttempts != test.max {
			t.Fatalf("effort %s: got %+v, want max=%d", test.level, policy, test.max)
		}
	}
}

func TestLowAllowsThreeTotalAutonomousAttempts(t *testing.T) {
	item := domain.Session{EffortLevel: domain.EffortLevelLow, AutomationMode: domain.AutomationModeAuto, AutomationAttempt: 2}
	if !effortAttemptAvailable(item) {
		t.Fatal("low must allow the third autonomous attempt")
	}
	item.AutomationAttempt = 3
	if effortAttemptAvailable(item) {
		t.Fatal("low must stop after three autonomous attempts")
	}
}

func TestLoopHasNoNumericCorrectionCeiling(t *testing.T) {
	item := domain.Session{EffortLevel: domain.EffortLevelLoop, AutomationMode: domain.AutomationModeAuto, AutomationAttempt: 1000000}
	if !effortAttemptAvailable(item) {
		t.Fatal("loop should remain eligible for pre-success automatic correction")
	}
}
