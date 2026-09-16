package protocol

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestValidateRejectsTraversal(t *testing.T) {
	plan := validPlan()
	plan.Operations = []domain.Operation{{Type: "apply_patch", Patch: "--- a/ok.txt\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-a\n+b\n"}}
	if err := Validate(plan); err == nil {
		t.Fatal("expected traversal rejection")
	}
}

func TestValidateRejectsAbsoluteCwd(t *testing.T) {
	plan := validPlan()
	plan.Operations = []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "/tmp", TimeoutSeconds: 10, ExpectedExitCodes: []int{0}}}}
	if err := Validate(plan); err == nil {
		t.Fatal("expected cwd rejection")
	}
}

func validPlan() domain.ExecutionPlan {
	return domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "p", RequestID: "r", Status: "ready", Summary: "x", Risk: "low"}
}

func TestValidateRejectsRenameTraversalAndSensitivePaths(t *testing.T) {
	cases := []string{
		"diff --git a/a.txt b/../../etc/passwd\nrename from a.txt\nrename to ../../etc/passwd\n",
		"--- a/x\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=x\n",
		"--- /dev/null\n+++ b/.wharnex/knowledge/manual.md\n@@ -0,0 +1 @@\n+managed by response protocol\n",
		"diff --git \"a/x\" \"b/y\"\n",
	}
	for _, patch := range cases {
		if err := ValidatePatchPaths(patch); err == nil {
			t.Fatalf("expected patch rejection: %q", patch)
		}
	}
}

func TestValidatePatchPathsAllowsDocumentedEnvironmentTemplates(t *testing.T) {
	for _, name := range []string{".env.example", ".env.sample", ".env.template", "config/.env.example"} {
		patch := "--- /dev/null\n+++ b/" + name + "\n@@ -0,0 +1 @@\n+KEY=replace-me\n"
		if err := ValidatePatchPaths(patch); err != nil {
			t.Fatalf("safe environment template %q was denied: %v", name, err)
		}
	}
}

func TestValidateRejectsSecretLikeConcurrencyDependencies(t *testing.T) {
	plan := validPlan()
	plan.ReadFiles = []string{".env.production"}
	if err := Validate(plan); err == nil || !strings.Contains(err.Error(), "sensitive patch path denied") {
		t.Fatalf("secret-like read dependency was not denied: %v", err)
	}
	plan.ReadFiles = []string{".env.example"}
	if err := Validate(plan); err != nil {
		t.Fatalf("documented environment template should remain allowed: %v", err)
	}
}

func TestValidateRejectsSymlinkPatch(t *testing.T) {
	patch := "diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+/etc/passwd\n"
	if err := ValidatePatchPaths(patch); err == nil {
		t.Fatal("expected symlink patch rejection")
	}
}

func TestValidateWorkflowPlanRejectsPatchesAndNetwork(t *testing.T) {
	base := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "wf", RequestID: "req_12345678", Status: "ready", Summary: "inspect", Risk: "low",
		Operations:   []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"git", "status", "--short"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
		Verification: []domain.CommandSpec{},
	}
	if err := ValidateWorkflowPlan(base); err != nil {
		t.Fatal(err)
	}
	withPatch := base
	withPatch.Operations = []domain.Operation{{Type: "apply_patch", Patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n"}}
	if err := ValidateWorkflowPlan(withPatch); err == nil {
		t.Fatal("workflow patch must be rejected")
	}
	withNetwork := base
	withNetwork.Operations = []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"git", "status"}, Cwd: ".", TimeoutSeconds: 30, Network: true, ExpectedExitCodes: []int{0}}}}
	if err := ValidateWorkflowPlan(withNetwork); err == nil {
		t.Fatal("workflow network must be rejected")
	}
}

func TestValidateWorkflowPlanRejectsHostApproval(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "wf-approval", RequestID: "req_12345678", Status: "ready", Summary: "inspect", Risk: "low", RequiresApproval: true,
		Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"git", "status", "--short"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
	}
	if err := ValidateWorkflowPlan(plan); err == nil {
		t.Fatal("workflow requiring host approval must be rejected")
	}
}

func TestValidateDebugPlanAllowsBoundedHostInspection(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "debug", RequestID: "req_12345678", Status: "ready", Summary: "inspect host", Risk: "low",
		Debug:      &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Rationale: "compare the live toolchain with the project requirement"},
		Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "env", "GOVERSION", "GOOS"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
	}
	if err := ValidateWorkflowPlan(plan); err != nil {
		t.Fatalf("bounded host debug was rejected: %v", err)
	}
}

func TestValidateDebugPlanRejectsHostMutationAndArbitraryReads(t *testing.T) {
	for _, argv := range [][]string{{"git", "checkout", "main"}, {"go", "env", "GOPRIVATE"}, {"cat", "/etc/passwd"}, {"npm", "install"}} {
		plan := domain.ExecutionPlan{
			Protocol: domain.ProtocolV1, PlanID: "debug", RequestID: "req_12345678", Status: "ready", Summary: "inspect host", Risk: "low",
			Debug:      &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Rationale: "inspect a local mismatch"},
			Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
		}
		if err := ValidateWorkflowPlan(plan); err == nil {
			t.Fatalf("unsafe host debug command was accepted: %v", argv)
		}
	}
}

func TestValidateDebugPlanAllowsApprovedHostModification(t *testing.T) {
	command := domain.CommandSpec{Argv: []string{"npm", "install", "--global", "some-debug-tool"}, Cwd: ".", TimeoutSeconds: 120, Network: true, ExpectedExitCodes: []int{0}}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "debug-modify", RequestID: "req_12345678", Status: "ready", Summary: "install a host debug helper", Risk: "high", RequiresApproval: true,
		Debug:       &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Access: domain.DebugAccessModify, Rationale: "the requested host diagnosis needs a missing local helper"},
		SystemTools: []domain.PlanSystemTool{{Target: "host", Name: "some-debug-tool", Action: "install", Lifetime: domain.ToolLifetimePersistent, Reason: "inspect the requested host state"}},
		Operations:  []domain.Operation{{Type: "command", Command: command}},
	}
	if err := ValidateWorkflowPlan(plan); err != nil {
		t.Fatalf("approved host debug modification was rejected: %v", err)
	}
}

func TestValidateDebugPlanRejectsHostModificationWithoutDedicatedApproval(t *testing.T) {
	base := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "debug-modify", RequestID: "req_12345678", Status: "ready", Summary: "change host state", Risk: "high",
		Debug:      &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Access: domain.DebugAccessModify, Rationale: "perform the user-requested host change"},
		Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"npm", "cache", "verify"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
	}
	if err := ValidateWorkflowPlan(base); err == nil || !strings.Contains(err.Error(), "explicit approval") {
		t.Fatalf("host modify without approval was not rejected: %v", err)
	}
	base.RequiresApproval = true
	base.Risk = "medium"
	if err := ValidateWorkflowPlan(base); err == nil || !strings.Contains(err.Error(), "risk must be high") {
		t.Fatalf("host modify without high risk was not rejected: %v", err)
	}
}

func TestValidateDebugPlanRequiresLifetimeForHostToolMutation(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "debug-modify", RequestID: "req_12345678", Status: "ready", Summary: "install a host debug helper", Risk: "high", RequiresApproval: true,
		Debug:       &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Access: domain.DebugAccessModify, Rationale: "install a helper for the requested host diagnosis"},
		SystemTools: []domain.PlanSystemTool{{Target: "host", Name: "helper", Action: "install", Reason: "required by the requested diagnosis"}},
		Operations:  []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"npm", "--version"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
	}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "lifetime") {
		t.Fatalf("host tool mutation without lifetime was not rejected: %v", err)
	}
}

func TestValidateChangePlanRejectsDebugExtension(t *testing.T) {
	plan := validPlan()
	plan.VersionIncrement = &domain.VersionIncrement{Component: domain.VersionComponentPatch, Amount: 1}
	plan.Debug = &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "sandbox", Rationale: "diagnose before changing"}
	if err := ValidateChangePlan(plan); err == nil || !strings.Contains(err.Error(), "must not contain debug") {
		t.Fatalf("change/debug ambiguity was not rejected: %v", err)
	}
}

func TestValidateBaselineAndImpactMetadata(t *testing.T) {
	plan := validPlan()
	plan.BaseContextSHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	plan.ImpactFiles = []string{"services/backend/a.go", "services/frontend/App.tsx"}
	if err := Validate(plan); err != nil {
		t.Fatal(err)
	}

	plan.BaseContextSHA256 = "NOT-A-SHA"
	if err := Validate(plan); err == nil {
		t.Fatal("expected invalid baseline hash rejection")
	}

	plan.BaseContextSHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	plan.ImpactFiles = []string{"../../outside"}
	if err := Validate(plan); err == nil {
		t.Fatal("expected impact traversal rejection")
	}
}

func TestValidateChangePlanRequiresVersionIncrement(t *testing.T) {
	plan := validPlan()
	plan.Document = "# Execution contract"
	plan.Dependencies = []domain.PlanDependency{}
	plan.SystemTools = []domain.PlanSystemTool{}
	if err := ValidateChangePlan(plan); err == nil || !strings.Contains(err.Error(), "requires version_increment") {
		t.Fatalf("missing version increment was not rejected: %v", err)
	}
	plan.VersionIncrement = &domain.VersionIncrement{Component: domain.VersionComponentMinor, Amount: 1}
	if err := ValidateChangePlan(plan); err != nil {
		t.Fatalf("valid change increment was rejected: %v", err)
	}
	plan.VersionIncrement.Amount = 0
	if err := ValidateChangePlan(plan); err == nil {
		t.Fatal("zero version increment amount must be rejected")
	}
	plan.VersionIncrement = &domain.VersionIncrement{Component: "medion", Amount: 1}
	if err := ValidateChangePlan(plan); err == nil {
		t.Fatal("unknown version increment component must be rejected")
	}
}

func TestValidateChangePlanRequiresExplicitExecutionContract(t *testing.T) {
	plan := validPlan()
	plan.Protocol = domain.ProtocolV2
	plan.VersionIncrement = &domain.VersionIncrement{Component: domain.VersionComponentPatch, Amount: 1}
	if err := ValidateChangePlan(plan); err == nil || !strings.Contains(err.Error(), "execution-contract document") {
		t.Fatalf("missing plan document was accepted: %v", err)
	}
	plan.Document = "# Execution contract"
	if err := ValidateChangePlan(plan); err == nil || !strings.Contains(err.Error(), "dependencies") {
		t.Fatalf("omitted dependency disclosure was accepted: %v", err)
	}
	plan.Dependencies = []domain.PlanDependency{}
	if err := ValidateChangePlan(plan); err == nil || !strings.Contains(err.Error(), "system_tools") {
		t.Fatalf("omitted system-tool disclosure was accepted: %v", err)
	}
	plan.SystemTools = []domain.PlanSystemTool{}
	plan.ImpactFiles = []string{}
	if err := ValidateChangePlan(plan); err != nil {
		t.Fatalf("explicit empty impact inventories were rejected: %v", err)
	}
}

func TestValidateChangePlanRequiresEveryRenamePathInImpactFiles(t *testing.T) {
	plan := validPlan()
	plan.Protocol = domain.ProtocolV2
	plan.Document = "# Rename execution contract"
	plan.Dependencies = []domain.PlanDependency{}
	plan.SystemTools = []domain.PlanSystemTool{}
	plan.VersionIncrement = &domain.VersionIncrement{Component: domain.VersionComponentPatch, Amount: 1}
	plan.Operations = []domain.Operation{{Type: "apply_patch", Patch: "diff --git a/old.txt b/new.txt\nrename from old.txt\nrename to new.txt\n"}}
	plan.ImpactFiles = []string{"new.txt"}
	if err := ValidateChangePlan(plan); err == nil || !strings.Contains(err.Error(), `"old.txt"`) {
		t.Fatalf("rename source omitted from impact_files was accepted: %v", err)
	}
	plan.ImpactFiles = []string{"old.txt", "new.txt"}
	if err := ValidateChangePlan(plan); err != nil {
		t.Fatalf("complete rename impact was rejected: %v", err)
	}
}

func TestValidatePatchPathsRejectsEngineOwnedVersion(t *testing.T) {
	patches := []string{
		"diff --git a/VERSION b/VERSION\n--- a/VERSION\n+++ b/VERSION\n@@ -1 +1 @@\n-v1.0.0.0\n+v1.0.0.1\n",
		"diff --git a/old.txt b/VERSION\nrename from old.txt\nrename to VERSION\n",
	}
	for _, patch := range patches {
		if err := ValidatePatchPaths(patch); err == nil {
			t.Fatalf("VERSION mutation was not rejected: %q", patch)
		}
	}
}

func TestValidateWorkflowPlanRejectsVersionIncrement(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "wf-version", RequestID: "req_12345678", Status: "ready", Summary: "inspect version", Risk: "low",
		VersionIncrement: &domain.VersionIncrement{Component: domain.VersionComponentPatch, Amount: 1},
		Operations:       []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"git", "status", "--short"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
	}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "must not contain version_increment") {
		t.Fatalf("workflow version increment was not rejected: %v", err)
	}
}

func TestValidateWorkflowPlanAcceptsEngineOwnedProjectExecutionSummary(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV2, PlanID: "wf-execution-summary", RequestID: "req_12345678", Status: "ready", Summary: "summarize local executions", Document: "# Diagnostic execution summary", Risk: "low",
		Dependencies: []domain.PlanDependency{}, SystemTools: []domain.PlanSystemTool{}, Operations: []domain.Operation{}, Verification: []domain.CommandSpec{},
		Debug: &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Query: domain.DebugQueryProjectExecutionSummary, Rationale: "the requested rates live in the durable local audit ledger"},
	}
	if err := ValidateWorkflowPlan(plan); err != nil {
		t.Fatalf("engine-owned execution summary query was rejected: %v", err)
	}
	plan.Debug.Target = "sandbox"
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "host") {
		t.Fatalf("host-owned execution ledger query was accepted for sandbox target: %v", err)
	}
}
