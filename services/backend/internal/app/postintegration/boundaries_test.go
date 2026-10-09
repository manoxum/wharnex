package postintegration

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func settled() domain.Session {
	plan := domain.ExecutionPlan{PlanID: "source", RequestID: "request"}
	execution := domain.ExecutionResult{PlanID: "source", Success: true}
	return domain.Session{State: "applied", ExecutionMode: domain.ExecutionModeProtected,
		LastRequestID: "request", Plan: &plan, LastExecution: &execution,
		LastAppliedChanges: []domain.PendingHostChange{{Plan: plan, Execution: execution}}}
}

func TestObservationRequiresSettledMatchingReceipt(t *testing.T) {
	if err := Validate(settled(), "Check live runtime"); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*domain.Session){
		"unapplied":               func(s *domain.Session) { s.State = "verified" },
		"host direct":             func(s *domain.Session) { s.ExecutionMode = domain.ExecutionModeUnprotected },
		"missing plan":            func(s *domain.Session) { s.Plan = nil },
		"empty plan identity":     func(s *domain.Session) { s.Plan.PlanID = "" },
		"missing execution":       func(s *domain.Session) { s.LastExecution = nil },
		"failed verification":     func(s *domain.Session) { s.LastExecution.Success = false },
		"different execution":     func(s *domain.Session) { s.LastExecution.PlanID = "other" },
		"different request":       func(s *domain.Session) { s.LastRequestID = "other" },
		"interrupted execution":   func(s *domain.Session) { s.InterruptedExecution = &domain.InterruptedExecution{} },
		"inflight planner":        func(s *domain.Session) { s.PlannerInFlight = true },
		"pending import":          func(s *domain.Session) { s.PendingManualRequestIDs = []string{"other"} },
		"unintegrated candidate":  func(s *domain.Session) { s.PendingHostChanges = []domain.PendingHostChange{{}} },
		"missing receipt":         func(s *domain.Session) { s.LastAppliedChanges = nil },
		"failed receipt":          func(s *domain.Session) { s.LastAppliedChanges[0].Execution.Success = false },
		"wrong receipt execution": func(s *domain.Session) { s.LastAppliedChanges[0].Execution.PlanID = "other" },
		"wrong receipt request":   func(s *domain.Session) { s.LastAppliedChanges[0].Plan.RequestID = "other" },
	} {
		t.Run(name, func(t *testing.T) {
			s := settled()
			mutate(&s)
			if Validate(s, "Check live runtime") == nil {
				t.Fatal("unsafe observation accepted")
			}
		})
	}
	for _, guidance := range []string{"", "  ", strings.Repeat("x", 12001)} {
		if Validate(settled(), guidance) == nil {
			t.Fatal("unbounded or missing guidance accepted")
		}
	}
}

func TestInitialObservationCannotClaimSuccessOrReplaceSource(t *testing.T) {
	for _, kind := range []domain.TurnKind{domain.TurnKindAnswer, domain.TurnKindChange, domain.TurnKindPlan, domain.TurnKindInvestigation} {
		if ValidateFirstTurn(kind) == nil {
			t.Fatalf("unsupported initial result accepted: %s", kind)
		}
	}
	for _, kind := range []domain.TurnKind{domain.TurnKindWorkflow, domain.TurnKindContextRequest, domain.TurnKindClarification, domain.TurnKindBlocked} {
		if err := ValidateFirstTurn(kind); err != nil {
			t.Fatal(err)
		}
	}
}
