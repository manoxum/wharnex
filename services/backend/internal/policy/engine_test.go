package policy

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestShellRequiresApprovalInsteadOfPolicyRepair(t *testing.T) {
	plan := basePlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: cmd("bash", "-c", "echo hi")}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
		t.Fatalf("shell should be approval-gated rather than denied: %#v", decision)
	}
	if len(decision.ApprovalItems) != 1 || decision.ApprovalItems[0].Kind != "command" || !decision.ApprovalItems[0].BypassInFull {
		t.Fatalf("shell approval metadata should be visible and Full-bypassable: %#v", decision.ApprovalItems)
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

func TestGitSymbolicRefReadOnlyQueryIsAllowed(t *testing.T) {
	for _, argv := range [][]string{
		{"git", "symbolic-ref", "--quiet", "HEAD"},
		{"git", "symbolic-ref", "--short", "HEAD"},
		{"git", "symbolic-ref", "--no-recurse", "HEAD"},
	} {
		plan := basePlan()
		plan.Verification = []domain.CommandSpec{cmd(argv...)}
		decision := NewEngine().Evaluate(plan)
		if !decision.Allowed || decision.RequiresApproval {
			t.Fatalf("read-only symbolic-ref query %v should be allowed without approval: %#v", argv, decision)
		}
	}
}

func TestGitSymbolicRefMutationIsDenied(t *testing.T) {
	for _, argv := range [][]string{
		{"git", "symbolic-ref", "HEAD", "refs/heads/main"},
		{"git", "symbolic-ref", "--delete", "HEAD"},
		{"git", "symbolic-ref", "-m", "reason", "HEAD", "refs/heads/main"},
	} {
		plan := basePlan()
		plan.Operations = []domain.Operation{{Type: "command", Command: cmd(argv...)}}
		decision := NewEngine().Evaluate(plan)
		if decision.Allowed {
			t.Fatalf("symbolic-ref mutation %v must remain denied", argv)
		}
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

func TestInlineNodeRequiresInformedApproval(t *testing.T) {
	plan := basePlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: cmd("node", "-e", "doWork()")}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
		t.Fatalf("inline programs should be approval-gated instead of forcing a repair round: %#v", decision)
	}
}

func TestHighImpactDeveloperToolsRequireApproval(t *testing.T) {
	for _, executable := range []string{"pip3", "composer", "sqlite3", "psql", "redis-cli", "fzf", "tmux"} {
		plan := basePlan()
		plan.Operations = []domain.Operation{{Type: "command", Command: cmd(executable, "--version")}}
		decision := NewEngine().Evaluate(plan)
		if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
			t.Fatalf("high-impact tool %q should require informed approval: %#v", executable, decision)
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

func TestHostSystemToolMutationRequiresApproval(t *testing.T) {
	plan := basePlan()
	plan.SystemTools = []domain.PlanSystemTool{{Name: "docker-buildx", Target: "host", Action: "install", Reason: "required to build the requested image"}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
		t.Fatalf("host tool installation must require explicit approval: %#v", decision)
	}
}

func TestSudoRequiresPasswordAndCannotBeBypassedInFull(t *testing.T) {
	plan := basePlan()
	command := cmd("sudo", "systemctl", "restart", "demo.service")
	command.Rationale = "restart the explicitly selected service"
	plan.Operations = []domain.Operation{{Type: "command", Command: command}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
		t.Fatalf("sudo should be approval-gated: %#v", decision)
	}
	found := false
	for _, item := range decision.ApprovalItems {
		if item.Kind == "sudo" {
			found = true
			if !item.RequiresSudoPassword || item.BypassInFull || len(item.Argv) == 0 {
				t.Fatalf("sudo approval must require a credential and remain explicit in Full: %#v", item)
			}
		}
	}
	if !found {
		t.Fatalf("sudo approval metadata missing: %#v", decision.ApprovalItems)
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

func TestInteractiveV2TypedShellUsesCapabilityPolicyInsteadOfCommandShellDeny(t *testing.T) {
	plan := basePlan()
	plan.Risk = "medium"
	plan.RequiresApproval = true
	plan.Debug = &domain.DebugSpec{
		Protocol: domain.InteractiveProtocolV2, Target: "host", Access: domain.DebugAccessObserve,
		Rationale: "inspect the live TODO worker", Capabilities: []string{domain.InteractiveCapabilityShell},
	}
	plan.Operations = []domain.Operation{{Type: "shell", Shell: &domain.InteractiveShellSpec{Script: "printf 'ok\\n'", Shell: "bash", Cwd: ".", TimeoutSeconds: 30}}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "medium" {
		t.Fatalf("typed v2 shell should be allowed only through the explicit approval boundary: %#v", decision)
	}
}

func TestInteractiveV2ModifyAlwaysBecomesHighRisk(t *testing.T) {
	plan := basePlan()
	plan.Risk = "high"
	plan.RequiresApproval = true
	plan.Debug = &domain.DebugSpec{
		Protocol: domain.InteractiveProtocolV2, Target: "host", Access: domain.DebugAccessModify,
		Rationale: "restart the stuck worker", Capabilities: []string{domain.InteractiveCapabilityService},
		Scope: domain.InteractiveScope{Services: []string{"wharnex-worker.service"}},
	}
	plan.Operations = []domain.Operation{{Type: "service", Service: &domain.InteractiveServiceSpec{Action: "restart", Name: "wharnex-worker.service"}}}
	decision := NewEngine().Evaluate(plan)
	if !decision.Allowed || !decision.RequiresApproval || decision.Risk != "high" {
		t.Fatalf("interactive modify must stay high-risk and approval-gated: %#v", decision)
	}
}
