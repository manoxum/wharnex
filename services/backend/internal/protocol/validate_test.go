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
