package app

import (
	"slices"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func pendingWithVerification(planID string, commands ...domain.CommandSpec) domain.PendingHostChange {
	return domain.PendingHostChange{Plan: domain.ExecutionPlan{PlanID: planID, Verification: commands}}
}

func TestIntegrationVerificationRunsEachDistinctGateOnce(t *testing.T) {
	// Three queued frontend candidates repeating the same gates turned one
	// integration pass into a dozen command runs against an identical merged
	// workspace. Each distinct gate must run once, owned by the first
	// candidate that declared it, so the baseline comparison stays anchored
	// to the smallest prefix.
	lint := domain.CommandSpec{Argv: []string{"npm", "run", "lint"}, Cwd: "services/frontend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}
	build := domain.CommandSpec{Argv: []string{"npm", "run", "build"}, Cwd: "services/frontend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}
	// Same argv, different envelope: still the same gate.
	lintSlower := domain.CommandSpec{Argv: []string{"npm", "run", "lint"}, Cwd: "services/frontend", TimeoutSeconds: 900, ExpectedExitCodes: []int{0}}
	// Same argv, different cwd: a genuinely different gate.
	backendLint := domain.CommandSpec{Argv: []string{"npm", "run", "lint"}, Cwd: "services/desktop", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}
	tests := domain.CommandSpec{Argv: []string{"npm", "test", "--", "--run", "src/styles.test.ts"}, Cwd: "services/frontend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}

	pending := []domain.PendingHostChange{
		pendingWithVerification("plan-one", lint, build),
		pendingWithVerification("plan-two", lintSlower, build, tests),
		pendingWithVerification("plan-three", build, backendLint),
	}

	runs := dedupedIntegrationVerifications(pending)
	if len(runs) != 4 {
		t.Fatalf("expected 4 distinct gates, got %d: %+v", len(runs), runs)
	}
	expected := []struct {
		index int
		argv  string
		cwd   string
	}{
		{0, "lint", "services/frontend"},
		{0, "build", "services/frontend"},
		{1, "test", "services/frontend"},
		{2, "lint", "services/desktop"},
	}
	for position, want := range expected {
		got := runs[position]
		if got.index != want.index {
			t.Fatalf("gate %d must be owned by the first candidate that declared it: got index %d, want %d", position, got.index, want.index)
		}
		if got.command.Cwd != want.cwd {
			t.Fatalf("gate %d cwd = %q, want %q", position, got.command.Cwd, want.cwd)
		}
		if !slices.Contains(got.command.Argv, want.argv) {
			t.Fatalf("gate %d argv = %v, want the %q gate", position, got.command.Argv, want.argv)
		}
	}
	// The winning `npm run lint` must be the first candidate's spec, not the
	// later candidate's slower envelope.
	if runs[0].command.TimeoutSeconds != 60 {
		t.Fatalf("the first declaration owns the gate; timeout = %d, want 60", runs[0].command.TimeoutSeconds)
	}
}

func TestIntegrationVerificationKeepsEveryGateWhenNothingRepeats(t *testing.T) {
	pending := []domain.PendingHostChange{
		pendingWithVerification("plan-one", domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "services/backend"}),
		pendingWithVerification("plan-two", domain.CommandSpec{Argv: []string{"npm", "run", "build"}, Cwd: "services/frontend"}),
	}
	if runs := dedupedIntegrationVerifications(pending); len(runs) != 2 {
		t.Fatalf("distinct gates must all survive, got %d", len(runs))
	}
	if runs := dedupedIntegrationVerifications(nil); len(runs) != 0 {
		t.Fatalf("no pending changes means no gates, got %d", len(runs))
	}
}
