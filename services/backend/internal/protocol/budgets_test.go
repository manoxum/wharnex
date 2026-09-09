package protocol

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func planWithTimeouts(operation, verification int) domain.ExecutionPlan {
	return domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "plan_1", RequestID: "req_1", Status: "ready", Risk: "low",
		Operations: []domain.Operation{{
			Type:    "command",
			Command: domain.CommandSpec{Argv: []string{"go", "build", "./..."}, Cwd: ".", TimeoutSeconds: operation, ExpectedExitCodes: []int{0}},
		}},
		Verification: []domain.CommandSpec{{Argv: []string{"go", "test", "./..."}, Cwd: ".", TimeoutSeconds: verification, ExpectedExitCodes: []int{0}}},
	}
}

// A timeout above the ceiling used to reject the whole bundle, discarding a
// correct patch. It must now be clamped, reported, and validate cleanly.
func TestNormalizeCommandBudgetsClampsOverCeilingTimeout(t *testing.T) {
	plan := planWithTimeouts(60, 3600)
	notes := NormalizeCommandBudgets(&plan)
	if len(notes) != 1 {
		t.Fatalf("expected exactly one adjustment note, got %v", notes)
	}
	if plan.Verification[0].TimeoutSeconds != MaxCommandTimeoutSeconds {
		t.Fatalf("verification timeout = %d, want %d", plan.Verification[0].TimeoutSeconds, MaxCommandTimeoutSeconds)
	}
	if plan.Operations[0].Command.TimeoutSeconds != 60 {
		t.Fatalf("in-range operation timeout must be left alone, got %d", plan.Operations[0].Command.TimeoutSeconds)
	}
	if err := Validate(plan); err != nil {
		t.Fatalf("normalized plan must validate: %v", err)
	}
}

func TestNormalizeCommandBudgetsAppliesDefaultForMissingTimeout(t *testing.T) {
	plan := planWithTimeouts(0, -5)
	notes := NormalizeCommandBudgets(&plan)
	if len(notes) != 2 {
		t.Fatalf("expected an adjustment for each command, got %v", notes)
	}
	if plan.Operations[0].Command.TimeoutSeconds != DefaultCommandTimeoutSeconds {
		t.Fatalf("operation timeout = %d, want %d", plan.Operations[0].Command.TimeoutSeconds, DefaultCommandTimeoutSeconds)
	}
	if plan.Verification[0].TimeoutSeconds != DefaultCommandTimeoutSeconds {
		t.Fatalf("verification timeout = %d, want %d", plan.Verification[0].TimeoutSeconds, DefaultCommandTimeoutSeconds)
	}
	if err := Validate(plan); err != nil {
		t.Fatalf("normalized plan must validate: %v", err)
	}
}

func TestNormalizeCommandBudgetsLeavesValidPlanUntouched(t *testing.T) {
	plan := planWithTimeouts(120, 900)
	if notes := NormalizeCommandBudgets(&plan); notes != nil {
		t.Fatalf("a valid plan must produce no adjustments, got %v", notes)
	}
}

// Normalization is narrow by contract: it must never invent or rewrite argv,
// cwd, network or expected exit codes (AGENTS.md, manual transport rules).
func TestNormalizeCommandBudgetsTouchesOnlyTimeouts(t *testing.T) {
	plan := planWithTimeouts(0, 0)
	plan.Operations[0].Command.Network = true
	plan.Operations[0].Command.Cwd = "services/backend"
	plan.Operations[0].Command.ExpectedExitCodes = []int{0, 1}
	NormalizeCommandBudgets(&plan)
	command := plan.Operations[0].Command
	if !command.Network || command.Cwd != "services/backend" || len(command.ExpectedExitCodes) != 2 {
		t.Fatalf("normalization altered a non-timeout field: %+v", command)
	}
}

// The out-of-range message must name the accepted range, so a planner that
// still trips the validator learns the bound from the error itself.
func TestValidateReportsTimeoutRange(t *testing.T) {
	err := ValidateCommand(domain.CommandSpec{Argv: []string{"go"}, TimeoutSeconds: 99999, ExpectedExitCodes: []int{0}})
	if err == nil {
		t.Fatal("expected an out-of-range error")
	}
	if got := err.Error(); got == "command timeout out of range" {
		t.Fatalf("error must state the accepted range, got %q", got)
	}
}
