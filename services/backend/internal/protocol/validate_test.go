package protocol

import (
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

func TestValidateRejectsSymlinkPatch(t *testing.T) {
	patch := "diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+/etc/passwd\n"
	if err := ValidatePatchPaths(patch); err == nil {
		t.Fatal("expected symlink patch rejection")
	}
}
