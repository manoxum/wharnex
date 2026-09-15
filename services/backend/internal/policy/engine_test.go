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

func TestGitMutationRequiresApproval(t *testing.T) {
	plan := basePlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: cmd("git", "commit", "-m", "update")}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval {
		t.Fatalf("git commit should require approval: %#v", decision)
	}
}

func TestDestructiveGitStillDenied(t *testing.T) {
	plan := basePlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: cmd("git", "reset", "--hard")}}
	if NewEngine().Evaluate(plan).Allowed {
		t.Fatal("git reset --hard should be denied")
	}
}

func TestRemoteGitRequiresNetworkAndApproval(t *testing.T) {
	plan := basePlan()
	push := cmd("git", "push", "origin", "main")
	plan.Operations = []domain.Operation{{Type: "command", Command: push}}
	if NewEngine().Evaluate(plan).Allowed {
		t.Fatal("git push without network=true should be denied")
	}
	push.Network = true
	plan.Operations = []domain.Operation{{Type: "command", Command: push}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
		t.Fatalf("unexpected push decision: %#v", decision)
	}
}

func basePlan() domain.ExecutionPlan {
	return domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "p", RequestID: "r", Status: "ready", Risk: "low"}
}
func cmd(argv ...string) domain.CommandSpec {
	return domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}
}

func TestProjectDefinedCommandsRaiseRiskWithoutForcingApproval(t *testing.T) {
	for _, argv := range [][]string{
		{"node", "scripts/check.mjs"},
		{"npm", "test"},
		{"npx", "vitest", "run"},
		{"make", "test"},
	} {
		plan := basePlan()
		plan.Verification = []domain.CommandSpec{cmd(argv...)}
		decision := NewEngine().Evaluate(plan)
		if !decision.Allowed || decision.RequiresApproval || decision.Risk != "medium" {
			t.Fatalf("project-defined verification %v should stay auto-eligible in Protected mode: %#v", argv, decision)
		}
	}
}

func TestHumanPTYOnlyDeveloperToolsRemainDeniedToModelPlans(t *testing.T) {
	for _, executable := range []string{"pip3", "composer", "sqlite3", "psql", "redis-cli", "fzf", "tmux"} {
		plan := basePlan()
		plan.Operations = []domain.Operation{{Type: "command", Command: cmd(executable, "--version")}}
		decision := NewEngine().Evaluate(plan)
		if decision.Allowed {
			t.Fatalf("human PTY tool %q must remain unavailable to model plans", executable)
		}
	}
}

func TestAdditionalBuildDriversRaiseRiskWithoutForcingApproval(t *testing.T) {
	for _, argv := range [][]string{{"cmake", "--build", "."}, {"ninja", "test"}} {
		plan := basePlan()
		plan.Verification = []domain.CommandSpec{cmd(argv...)}
		decision := NewEngine().Evaluate(plan)
		if !decision.Allowed || decision.RequiresApproval || decision.Risk != "medium" {
			t.Fatalf("build driver %v should stay auto-eligible but medium risk in Protected mode: %#v", argv, decision)
		}
	}
}

func TestPackageMutationStillRequiresApproval(t *testing.T) {
	plan := basePlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: cmd("npm", "install")}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
		t.Fatalf("npm install must remain approval-gated: %#v", decision)
	}
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
