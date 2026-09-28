package app

import (
	"strings"
	"testing"

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
