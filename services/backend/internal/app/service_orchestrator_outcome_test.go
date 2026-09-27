package app

import "testing"

func TestOrchestratorAgentOutcomeWaitsForHostIntegration(t *testing.T) {
	for _, test := range []struct{ state, want string }{
		{"ready", ""}, {"awaiting_plan", ""}, {"verified", ""}, {"repair_pending", ""},
		{"applied", "review"}, {"restart_pending", "review"},
		{"failed", "failed"}, {"blocked", "failed"}, {"cancelled", "failed"},
	} {
		if got := orchestratorAgentOutcome(test.state); got != test.want {
			t.Errorf("Agent state %q: got %q, want %q", test.state, got, test.want)
		}
	}
}
