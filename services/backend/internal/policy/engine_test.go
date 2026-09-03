package policy

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestDenyShell(t *testing.T) {
	plan := basePlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: cmd("bash", "-c", "echo hi")}}
	decision := NewEngine().Evaluate(plan)
	if decision.Allowed {
		t.Fatal("shell should be denied")
	}
}

func TestNetworkRequiresApproval(t *testing.T) {
	plan := basePlan()
	command := cmd("go", "test", "./...")
	command.Network = true
	plan.Operations = []domain.Operation{{Type: "command", Command: command}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval {
		t.Fatalf("unexpected decision: %#v", decision)
	}
}

func TestGitMutationDenied(t *testing.T) {
	plan := basePlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: cmd("git", "reset", "--hard")}}
	if NewEngine().Evaluate(plan).Allowed {
		t.Fatal("git reset should be denied")
	}
}

func basePlan() domain.ExecutionPlan {
	return domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "p", RequestID: "r", Status: "ready", Risk: "low"}
}
func cmd(argv ...string) domain.CommandSpec {
	return domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}
}

func TestInteractiveTerminalAllowsDeveloperMutationsWithoutModelPlanRestrictions(t *testing.T) {
	command := cmd("git", "add", "README.md")
	decision := NewEngine().EvaluateInteractiveCommand(command)
	if !decision.Allowed {
		t.Fatalf("interactive git mutation should be allowed: %#v", decision)
	}
}

func TestInteractiveTerminalAllowsLanguageRuntimeScript(t *testing.T) {
	command := cmd("python3", "scripts/check.py")
	decision := NewEngine().EvaluateInteractiveCommand(command)
	if !decision.Allowed {
		t.Fatalf("interactive project runtime should be allowed: %#v", decision)
	}
}

func TestInteractiveTerminalStillDeniesShellAndHostManagement(t *testing.T) {
	for _, argv := range [][]string{{"bash", "-c", "echo hi"}, {"sudo", "true"}, {"docker", "ps"}, {"python3", "-c", "print(1)"}} {
		command := cmd(argv...)
		decision := NewEngine().EvaluateInteractiveCommand(command)
		if decision.Allowed {
			t.Fatalf("expected interactive command denied: %#v", argv)
		}
	}
}
