package planadjustment

import (
	"kernl.local/harness/backend/internal/domain"
	"testing"
)

func TestFailedProtectedAdjustmentRejectsOtherExecutionStates(t *testing.T) {
	base := func() domain.Session {
		return domain.Session{State: "failed", ExecutionMode: domain.ExecutionModeProtected,
			Plan: &domain.ExecutionPlan{PlanID: "plan"}, LastExecution: &domain.ExecutionResult{PlanID: "plan", Success: false}}
	}
	if !FailedProtected(base()) {
		t.Fatal("failed isolated candidate should admit explicit review")
	}
	cases := map[string]func(*domain.Session){
		"host direct":         func(s *domain.Session) { s.ExecutionMode = domain.ExecutionModeUnprotected },
		"full":                func(s *domain.Session) { s.ExecutionMode = domain.ExecutionModeFull },
		"integrated":          func(s *domain.Session) { s.State = "applied" },
		"success":             func(s *domain.Session) { s.LastExecution.Success = true },
		"no result":           func(s *domain.Session) { s.LastExecution = nil },
		"other plan":          func(s *domain.Session) { s.LastExecution.PlanID = "other" },
		"no plan":             func(s *domain.Session) { s.Plan = nil },
		"in flight":           func(s *domain.Session) { s.InterruptedExecution = &domain.InterruptedExecution{PlanID: "plan"} },
		"pending integration": func(s *domain.Session) { s.PendingHostChanges = []domain.PendingHostChange{{}} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s := base()
			mutate(&s)
			if FailedProtected(s) {
				t.Fatal("accepted unsafe adjustment state")
			}
		})
	}
}
