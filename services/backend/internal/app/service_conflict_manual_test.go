package app

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestBuildManualConflictPatchUsesCurrentAsPatchBase(t *testing.T) {
	workbench := ConflictWorkbench{Files: []ConflictWorkbenchFile{{Path: "demo.txt", CurrentExists: true, Current: "current\n"}}}
	patch, paths, err := buildManualConflictPatch(context.Background(), workbench, []ConflictManualResolution{{Path: "demo.txt", Content: "resolved\n", Exists: true}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != "demo.txt" {
		t.Fatalf("unexpected paths: %#v", paths)
	}
	if !strings.Contains(patch, "-current") || !strings.Contains(patch, "+resolved") {
		t.Fatalf("manual patch was not authored against CURRENT:\n%s", patch)
	}
}

func TestAugmentConflictResolutionPlanLocksManualPaths(t *testing.T) {
	item := domain.Session{IntegrationConflict: &domain.ConflictResolution{
		RequestID: "req_conflict", Paths: []string{"manual.txt", "gpt.txt"},
		ManualPaths: []string{"manual.txt"}, ManualPatch: "diff --git a/manual.txt b/manual.txt\n--- a/manual.txt\n+++ b/manual.txt\n@@ -1 +1 @@\n-old\n+human\n",
	}}
	plan := domain.ExecutionPlan{RequestID: "req_conflict", ImpactFiles: []string{"gpt.txt"}, Operations: []domain.Operation{{Type: "apply_patch", Patch: "diff --git a/gpt.txt b/gpt.txt\n--- a/gpt.txt\n+++ b/gpt.txt\n@@ -1 +1 @@\n-old\n+model\n"}}}
	if err := augmentConflictResolutionPlan(item, &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Operations) != 2 || !strings.Contains(plan.Operations[1].Patch, "+human") {
		t.Fatalf("manual patch was not injected: %#v", plan.Operations)
	}

	plan = domain.ExecutionPlan{RequestID: "req_conflict", Operations: []domain.Operation{{Type: "apply_patch", Patch: "diff --git a/manual.txt b/manual.txt\n--- a/manual.txt\n+++ b/manual.txt\n@@ -1 +1 @@\n-old\n+model\n"}}}
	if err := augmentConflictResolutionPlan(item, &plan); err == nil {
		t.Fatal("expected GPT write to a manually locked path to be rejected")
	}
}

func TestBuildManualConflictPatchIncludesNewFile(t *testing.T) {
	workbench := ConflictWorkbench{Files: []ConflictWorkbenchFile{{Path: "new.txt", CurrentExists: false}}}
	patch, paths, err := buildManualConflictPatch(context.Background(), workbench, []ConflictManualResolution{{Path: "new.txt", Content: "created\n", Exists: true}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != "new.txt" {
		t.Fatalf("unexpected paths: %#v", paths)
	}
	if !strings.Contains(patch, "new file mode") || !strings.Contains(patch, "+created") {
		t.Fatalf("manual patch did not include new file:\n%s", patch)
	}
}

func TestManualConflictPlanRetainsOriginalVerification(t *testing.T) {
	gate := domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "services/backend", TimeoutSeconds: 120, ExpectedExitCodes: []int{0}}
	item := domain.Session{
		IntegrationConflict: &domain.ConflictResolution{RequestID: "req_conflict", OriginalPlanIDs: []string{"original"}},
		PendingHostChanges:  []domain.PendingHostChange{{Plan: domain.ExecutionPlan{PlanID: "original", Verification: []domain.CommandSpec{gate}}}},
	}
	plan := manualConflictPlan(item, []string{"demo.txt"}, "diff --git a/demo.txt b/demo.txt\n--- a/demo.txt\n+++ b/demo.txt\n@@ -1 +1 @@\n-old\n+resolved\n")
	if len(plan.Verification) != 1 || strings.Join(plan.Verification[0].Argv, " ") != "go test ./..." {
		t.Fatalf("manual resolution lost original verification gates: %#v", plan.Verification)
	}
}
