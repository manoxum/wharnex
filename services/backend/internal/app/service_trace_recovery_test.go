package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPlannerDirtySubmoduleGitlinkIsLocalHostBlock(t *testing.T) {
	outcome := &domain.TurnOutcome{Status: domain.TurnOutcomePartial, ReasonCode: "dirty_submodule_gitlink_change", Retryable: false}
	if got := classifyPlannerOutcomeFailure(outcome); got != domain.FailureKindHostWorkingStateBlocked {
		t.Fatalf("dirty gitlink outcome = %q, want %q", got, domain.FailureKindHostWorkingStateBlocked)
	}
}
