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
