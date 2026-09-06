package app

import (
	"errors"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/protocol"
)

func planWithEligibleOperation() domain.ExecutionPlan {
	return domain.ExecutionPlan{
		Protocol:  domain.ProtocolV1,
		PlanID:    "plan_1",
		RequestID: "req_1",
		Status:    "ready",
		Risk:      "medium",
		Operations: []domain.Operation{
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "services/backend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}},
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "fmt", "./..."}, Cwd: ".", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}},
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"npm", "test"}, Cwd: ".", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}},
			{Type: "apply_patch", Patch: "diff --git a/x b/x\n"},
		},
		Verification: []domain.CommandSpec{
			{Argv: []string{"go", "vet", "./..."}, Cwd: "services/backend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}},
			{Argv: []string{"sh", "-c", "go test ./..."}, Cwd: ".", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}},
		},
	}
}

func TestInjectGoDependencyHydrationAddsOneNetworkDownload(t *testing.T) {
	plan := planWithEligibleOperation()

	if !injectGoDependencyHydration(&plan) {
		t.Fatal("expected the plan to gain a hydration operation")
	}

	// The most important assertion: no pre-existing command's Network was
	// flipped. This is the direct inversion of the old flipping behavior and
	// the SoT-conformance requirement (SANDBOX_MODEL.md:33).
	for _, op := range plan.Operations {
		if op.Type == "command" && isGoDependencyCommand(op.Command) && op.Command.Network {
			t.Fatalf("pre-existing Go command received network access: %v", op.Command.Argv)
		}
	}
	for _, command := range plan.Verification {
		if isGoDependencyCommand(command) && command.Network {
			t.Fatalf("pre-existing verification command received network access: %v", command.Argv)
		}
	}

	// Exactly one new operation: go mod download, network=true, positioned
	// before the first eligible Go operation with that operation's own cwd.
	found := 0
	for i, op := range plan.Operations {
		if isGoDependencyHydration(op.Command) {
			found++
			if op.Type != "command" {
				t.Fatalf("hydration operation has wrong type %q", op.Type)
			}
			if !op.Command.Network {
				t.Fatal("hydration operation did not request network")
			}
			if op.Command.Cwd != "services/backend" {
				t.Fatalf("hydration operation cwd = %q, want the eligible command's cwd", op.Command.Cwd)
			}
			if i != 0 {
				t.Fatalf("hydration operation inserted at index %d, want 0 (before the first eligible operation)", i)
			}
		}
	}
	if found != 1 {
		t.Fatalf("expected exactly one hydration operation, found %d", found)
	}

	if injectGoDependencyHydration(&plan) {
		t.Fatal("second call must be idempotent")
	}
}

func TestInjectGoDependencyHydrationPositionsAfterOperationsWhenOnlyVerificationIsEligible(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol:  domain.ProtocolV1,
		PlanID:    "plan_2",
		RequestID: "req_2",
		Status:    "ready",
		Risk:      "medium",
		Operations: []domain.Operation{
			{Type: "apply_patch", Patch: "diff --git a/go.mod b/go.mod\n"},
		},
		Verification: []domain.CommandSpec{
			{Argv: []string{"go", "build", "./..."}, Cwd: "services/backend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}},
		},
	}

	if !injectGoDependencyHydration(&plan) {
		t.Fatal("expected the plan to gain a hydration operation")
	}
	if len(plan.Operations) != 2 {
		t.Fatalf("expected 2 operations after injection, got %d", len(plan.Operations))
	}
	last := plan.Operations[len(plan.Operations)-1]
	if !isGoDependencyHydration(last.Command) {
		t.Fatal("hydration operation must land after all operations when only verification is eligible, so a go.mod patch is applied first")
	}
	if last.Command.Cwd != "services/backend" {
		t.Fatalf("hydration cwd = %q, want the eligible verification command's cwd", last.Command.Cwd)
	}
}

func TestInjectGoDependencyHydrationIgnoresIneligiblePlans(t *testing.T) {
	plan := domain.ExecutionPlan{
		Operations: []domain.Operation{
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "fmt", "./..."}}},
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"npm", "test"}}},
			{Type: "apply_patch", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}}},
		},
		Verification: []domain.CommandSpec{
			{Argv: []string{"sh", "-c", "go test ./..."}},
		},
	}
	if injectGoDependencyHydration(&plan) {
		t.Fatal("expected no injection for a plan with no eligible Go dependency command")
	}
	if len(plan.Operations) != 3 {
		t.Fatal("plan must not be mutated when nothing is eligible")
	}
}

func TestClearGoDependencyNetworkNormalizesLegacyPlans(t *testing.T) {
	// A plan persisted by the previous (flipping) implementation, which set
	// Network=true directly on go test/build/vet/list commands.
	plan := domain.ExecutionPlan{
		Operations: []domain.Operation{
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Network: true}},
		},
		Verification: []domain.CommandSpec{
			{Argv: []string{"go", "vet", "./..."}, Network: true},
		},
	}
	clearGoDependencyNetwork(&plan)
	if plan.Operations[0].Command.Network {
		t.Fatal("legacy flipped operation network was not cleared")
	}
	if plan.Verification[0].Network {
		t.Fatal("legacy flipped verification network was not cleared")
	}
}

func TestInjectedGoDependencyHydrationSatisfiesProtocolAndPolicy(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol:  domain.ProtocolV1,
		PlanID:    "plan_3",
		RequestID: "req_3",
		Status:    "ready",
		Risk:      "medium",
		Operations: []domain.Operation{
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "services/backend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}},
		},
		Verification: []domain.CommandSpec{
			{Argv: []string{"go", "vet", "./..."}, Cwd: "services/backend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}},
		},
	}
	if !injectGoDependencyHydration(&plan) {
		t.Fatal("expected injection")
	}
	if err := protocol.Validate(plan); err != nil {
		t.Fatalf("mutated plan failed protocol validation: %v", err)
	}
	decision := policy.NewEngine().Evaluate(plan)
	if !decision.Allowed {
		t.Fatalf("mutated plan was not allowed: %+v", decision)
	}
	if !decision.RequiresApproval {
		t.Fatal("mutated plan with a network command must require approval")
	}
	if decision.Risk != "high" {
		t.Fatalf("mutated plan risk = %q, want high", decision.Risk)
	}
}

func TestNormalizePreflightCommandFailureDoesNotReportExitZero(t *testing.T) {
	command := domain.CommandSpec{Argv: []string{"go", "test", "./internal/app"}, Cwd: "services/backend"}
	result := normalizePreflightCommandFailure(command, domain.CommandResult{}, errors.New("offline sandbox dependencies unavailable"))
	if result.ExitCode != -1 || result.Success || len(result.Argv) != 3 || result.Stderr == "" {
		t.Fatalf("preflight failure was not made explicit: %#v", result)
	}
}
