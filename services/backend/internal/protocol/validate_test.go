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

func TestValidateDebugPlanRejectsRetiredHostModification(t *testing.T) {
	command := domain.CommandSpec{Argv: []string{"npm", "install", "--global", "some-debug-tool"}, Cwd: ".", TimeoutSeconds: 120, Network: true, ExpectedExitCodes: []int{0}}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "debug-modify", RequestID: "req_12345678", Status: "ready", Summary: "install a host debug helper", Risk: "low",
		Debug:       &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Access: domain.DebugAccessModify, Rationale: "the requested host diagnosis needs a missing local helper"},
		SystemTools: []domain.PlanSystemTool{{Target: "host", Name: "some-debug-tool", Action: "install", Lifetime: domain.ToolLifetimePersistent, Reason: "inspect the requested host state"}},
		Operations:  []domain.Operation{{Type: "command", Command: func() domain.CommandSpec { command.Network = false; return command }()}},
	}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "retired") {
		t.Fatalf("host debug modification must be retired, got: %v", err)
	}
}

func TestValidateDebugPlanRejectsHostModificationWithoutDedicatedApproval(t *testing.T) {
	base := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "debug-modify", RequestID: "req_12345678", Status: "ready", Summary: "change host state", Risk: "high",
		Debug:      &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Access: domain.DebugAccessModify, Rationale: "perform the user-requested host change"},
		Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"npm", "cache", "verify"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
	}
	if err := ValidateWorkflowPlan(base); err == nil {
		t.Fatalf("host modify without approval was not rejected: %v", err)
	}
	base.RequiresApproval = true
	base.Risk = "medium"
	if err := ValidateWorkflowPlan(base); err == nil {
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
	if err := ValidateWorkflowPlan(plan); err == nil {
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

func TestValidateInteractiveV2RejectsInvalidShellEnvironmentName(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "interactive-v2-shell-env", RequestID: "req_12345678", Status: "ready", Summary: "inspect worker", Risk: "medium", RequiresApproval: true,
		Debug:      &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2, Target: "host", Access: domain.DebugAccessObserve, Rationale: "inspect worker", Capabilities: []string{domain.InteractiveCapabilityShell}},
		Operations: []domain.Operation{{Type: "shell", Shell: &domain.InteractiveShellSpec{Script: "printf ok", Shell: "bash", Cwd: ".", TimeoutSeconds: 10, EnvAllowlist: []string{"--privileged"}}}},
	}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "invalid variable name") {
		t.Fatalf("invalid environment name must be rejected: %v", err)
	}
}

func TestValidateInteractiveV2RejectsEngineHostAdapterForSandboxTarget(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "interactive-v2-sandbox-logs", RequestID: "req_12345678", Status: "ready", Summary: "inspect logs", Risk: "medium",
		Debug:      &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2, Target: "sandbox", Access: domain.DebugAccessObserve, Rationale: "inspect sandbox logs", Capabilities: []string{domain.InteractiveCapabilityLogs}, Scope: domain.InteractiveScope{LogSources: []string{"audit"}}},
		Operations: []domain.Operation{{Type: "logs", Logs: &domain.InteractiveLogsSpec{Source: "audit", Limit: 10}}},
	}
	err := ValidateWorkflowPlan(plan)
	if err == nil || !strings.Contains(err.Error(), "requires host target") {
		t.Fatalf("sandbox target must not route engine/host adapters onto the host: %v", err)
	}
}

func TestValidateInteractiveV2RequiresDeclaredCapabilityAndScope(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "interactive-v2", RequestID: "req_12345678", Status: "ready", Summary: "inspect TODO worker logs", Risk: "medium", RequiresApproval: true,
		Debug:      &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2, Target: "host", Access: domain.DebugAccessObserve, Rationale: "inspect worker state", Capabilities: []string{domain.InteractiveCapabilityLogs}, Scope: domain.InteractiveScope{LogSources: []string{"audit"}}},
		Operations: []domain.Operation{{Type: "logs", Logs: &domain.InteractiveLogsSpec{Source: "audit", Limit: 100}}},
	}
	if err := ValidateWorkflowPlan(plan); err != nil {
		t.Fatalf("valid interactive v2 logs probe rejected: %v", err)
	}
	plan.Debug.Capabilities = []string{domain.InteractiveCapabilitySQL}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "undeclared capability") {
		t.Fatalf("undeclared capability should fail, got %v", err)
	}
}

func TestValidateInteractiveV2RejectsScopeEscapeAndObserveWrites(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "interactive-v2", RequestID: "req_12345678", Status: "ready", Summary: "inspect database", Risk: "medium", RequiresApproval: true,
		Debug:      &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2, Target: "host", Rationale: "inspect TODO records", Capabilities: []string{domain.InteractiveCapabilitySQL}, Scope: domain.InteractiveScope{Connections: []string{"wharnex-internal"}}},
		Operations: []domain.Operation{{Type: "sql", SQL: &domain.InteractiveSQLSpec{ConnectionID: "other", Statement: "select 1", Mode: "read_only", TimeoutSeconds: 5, MaxRows: 10}}},
	}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "outside approved scope") {
		t.Fatalf("connection scope escape should fail, got %v", err)
	}
	plan.Operations[0].SQL.ConnectionID = "wharnex-internal"
	plan.Operations[0].SQL.Mode = "write"
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "write requires modify") {
		t.Fatalf("observe SQL write should fail, got %v", err)
	}
}

func TestValidateInteractiveV2ModifyIsHighRiskApprovalGated(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "interactive-v2", RequestID: "req_12345678", Status: "ready", Summary: "restart worker", Risk: "medium", RequiresApproval: false,
		Debug:      &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2, Target: "host", Access: domain.DebugAccessModify, Rationale: "restart stuck worker", Capabilities: []string{domain.InteractiveCapabilityService}, Scope: domain.InteractiveScope{Services: []string{"wharnex-worker.service"}}},
		Operations: []domain.Operation{{Type: "service", Service: &domain.InteractiveServiceSpec{Action: "restart", Name: "wharnex-worker.service"}}},
	}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "risk=high") {
		t.Fatalf("modify without high-risk approval should fail, got %v", err)
	}
	plan.Risk, plan.RequiresApproval = "high", true
	if err := ValidateWorkflowPlan(plan); err != nil {
		t.Fatalf("approved high-risk modify rejected: %v", err)
	}
}

func TestInteractiveV2CommandNetworkRequiresNetworkCapability(t *testing.T) {
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV2, PlanID: "iv2-command-network", RequestID: "req_12345678", Status: "ready",
		Summary: "probe a scoped endpoint", Risk: "medium", RequiresApproval: true,
		Debug: &domain.DebugSpec{
			Protocol: domain.InteractiveProtocolV2, Target: "host", Access: domain.DebugAccessObserve,
			Rationale: "probe runtime health", Capabilities: []string{domain.InteractiveCapabilityCommand},
		},
		Operations:   []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"curl", "http://127.0.0.1:3260/health"}, Cwd: ".", TimeoutSeconds: 10, Network: true, ExpectedExitCodes: []int{0}}}},
		Verification: []domain.CommandSpec{},
	}
	if err := ValidateWorkflowPlan(plan); err == nil || !strings.Contains(err.Error(), "network capability") {
		t.Fatalf("expected command network capability rejection, got %v", err)
	}
}

func TestValidateAcquisitionStrategiesRejectsAutomaticHostMutation(t *testing.T) {
	plan := validPlan()
	plan.SystemTools = []domain.PlanSystemTool{{
		Target: "host", Name: "pnpm", Action: "install", Lifetime: domain.ToolLifetimePersistent, Reason: "run post-merge verification",
		Acquisition: []domain.PlanAcquisitionStrategy{{Method: "package_manager", Manager: "npm", Package: "pnpm", Version: "10.17.1", Automatic: true, Reason: "install missing package manager"}},
	}}
	if err := Validate(plan); err == nil || !strings.Contains(err.Error(), "cannot be automatic") {
		t.Fatalf("automatic host tool mutation must be rejected, got %v", err)
	}
	plan.SystemTools[0].Acquisition[0].Automatic = false
	if err := Validate(plan); err != nil {
		t.Fatalf("approval-gated host acquisition should be valid: %v", err)
	}
}

func TestValidateAcquisitionStrategiesAcceptsAutomaticSandboxLockfileHydration(t *testing.T) {
	plan := validPlan()
	plan.Dependencies = []domain.PlanDependency{{
		Scope: "services/app", Manager: "pnpm", Name: "workspace dependencies", Action: "use", Reason: "run verification",
		Acquisition: []domain.PlanAcquisitionStrategy{{Method: "lockfile_install", Manager: "pnpm", Automatic: true, Reason: "hydrate missing node_modules from the committed lockfile"}},
	}}
	if err := Validate(plan); err != nil {
		t.Fatalf("automatic sandbox lockfile acquisition should be valid: %v", err)
	}
}
