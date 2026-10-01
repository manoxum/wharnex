package app

import (
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestOrchestratorAgentOutcomeWaitsForHostIntegration(t *testing.T) {
	for _, test := range []struct{ state, want string }{
		{"ready", ""}, {"awaiting_plan", ""}, {"verified", ""}, {"repair_pending", ""}, {"workflow_pending", ""},
		{"applied", "review"}, {"restart_pending", "review"},
		{"failed", "failed"}, {"blocked", "failed"}, {"cancelled", "failed"},
	} {
		if got := orchestratorAgentOutcome(domain.Session{State: test.state}); got != test.want {
			t.Errorf("Agent state %q: got %q, want %q", test.state, got, test.want)
		}
	}
}

// A task has nobody to read its chat: a report ends it in review, and a
// question for a person fails the run with that question.
func TestOrchestratorAgentOutcomeSettlesMainRequestsThatWaitForAPerson(t *testing.T) {
	for _, test := range []struct{ state, want string }{
		{"answered", "review"}, {"investigated", "review"},
		{"awaiting_clarification", "failed"}, {"awaiting_plan_approval", "failed"},
	} {
		agent := domain.Session{State: test.state, LastRequestID: "req_a", LastTurn: &domain.AgentTurn{Message: "Qual base usar?"}}
		if got := orchestratorAgentOutcome(agent); got != test.want {
			t.Errorf("Agent state %q: got %q, want %q", test.state, got, test.want)
		}
		// While that request still awaits its response it is not the outcome yet.
		agent.PendingManualRequestIDs = []string{"req_a"}
		if got := orchestratorAgentOutcome(agent); got != "" {
			t.Errorf("pending Agent state %q: got %q, want no outcome", test.state, got)
		}
	}
	question := orchestratorAgentOutcomeError(domain.Session{State: "awaiting_clarification", LastTurn: &domain.AgentTurn{Message: "Qual base usar?"}})
	if !strings.Contains(question, "Qual base usar?") {
		t.Fatalf("clarification error = %q", question)
	}
}

// A task's effort level bounds its attempts: a failed execution with budget
// left is a repair round in preparation, not the end of the run.
func TestOrchestratorAgentOutcomeWaitsForTheRepairOfAFailureWithBudgetLeft(t *testing.T) {
	now := time.Date(2026, 9, 29, 5, 0, 0, 0, time.UTC)
	previous := orchestratorNow
	orchestratorNow = func() time.Time { return now }
	defer func() { orchestratorNow = previous }()

	agent := domain.Session{ID: "ses_budget", State: "failed", LastRequestID: "req_a", AutomationMode: domain.AutomationModeAuto,
		EffortLevel: domain.EffortLevelExtraHigh, AutomationAttempt: 2, LastRepairError: "verification failed"}
	if got := orchestratorAgentOutcome(agent); got != "" {
		t.Fatalf("attempt 2 of 20: got %q, want no outcome while the repair starts", got)
	}
	now = now.Add(orchestratorRepairStartGrace)
	if got := orchestratorAgentOutcome(agent); got != "failed" {
		t.Fatalf("a repair that never started: got %q, want failed", got)
	}

	exhausted := agent
	exhausted.ID, exhausted.AutomationAttempt = "ses_exhausted", 20
	if got := orchestratorAgentOutcome(exhausted); got != "failed" {
		t.Fatalf("budget spent: got %q, want failed", got)
	}
	infrastructure := agent
	infrastructure.ID, infrastructure.FailureKind = "ses_infra", "sandbox_resource_exhausted"
	if got := orchestratorAgentOutcome(infrastructure); got != "failed" {
		t.Fatalf("infrastructure failure: got %q, want failed", got)
	}
}
