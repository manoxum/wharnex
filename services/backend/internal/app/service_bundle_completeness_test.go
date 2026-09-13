package app

import (
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func completenessProject(t *testing.T, existing ...string) string {
	t.Helper()
	root := t.TempDir()
	for _, path := range existing {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// The exact production shape: the plan declares the definition file, the patch
// references the symbol it would define, and the file is neither written nor
// present. Verification failed with `undefined: DebugRun`.
func TestUndeliverableImpactFileIsDetectedBeforeExecution(t *testing.T) {
	root := completenessProject(t, "services/backend/internal/domain/types.go")
	plan := &domain.ExecutionPlan{
		PlanID: "plan_incomplete", RequestID: "req_incomplete",
		ImpactFiles: []string{
			"services/backend/internal/domain/types.go",
			"services/backend/internal/domain/debug.go",
			"services/backend/internal/app/service_debug.go",
		},
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/services/backend/internal/domain/types.go\n+++ b/services/backend/internal/domain/types.go\n@@ -1 +1,2 @@\n package domain\n+type P = DebugRun\n"}},
	}
	missing := undeliverableImpactFiles(root, plan)
	if len(missing) != 2 {
		t.Fatalf("missing = %v, want the two undelivered definitions", missing)
	}
	if missing[0] != "services/backend/internal/app/service_debug.go" || missing[1] != "services/backend/internal/domain/debug.go" {
		t.Fatalf("missing = %v", missing)
	}
}

// A file the patch creates is delivered, however absent it is from the project.
func TestCreatedImpactFileCountsAsDelivered(t *testing.T) {
	root := completenessProject(t, "services/backend/internal/domain/types.go")
	plan := &domain.ExecutionPlan{
		PlanID: "plan_creates", RequestID: "req_creates",
		ImpactFiles: []string{"services/backend/internal/domain/types.go", "services/backend/internal/domain/debug.go"},
		Operations:  []domain.Operation{{Type: "apply_patch", Patch: createAndModifyPatch}},
	}
	if missing := undeliverableImpactFiles(root, plan); len(missing) != 0 {
		t.Fatalf("a created file must count as delivered, got %v", missing)
	}
}

// Over-declaring a file that already exists is ordinary planner imprecision and
// must never reject a valid change: impact_files stays a forecast.
func TestDeclaringAnExistingFileWithoutPatchingItIsAccepted(t *testing.T) {
	root := completenessProject(t, "AGENTS.md", "services/backend/internal/domain/types.go")
	plan := &domain.ExecutionPlan{
		PlanID: "plan_forecast", RequestID: "req_forecast",
		ImpactFiles: []string{"AGENTS.md", "services/backend/internal/domain/types.go"},
		Operations:  []domain.Operation{{Type: "apply_patch", Patch: "--- a/services/backend/internal/domain/types.go\n+++ b/services/backend/internal/domain/types.go\n@@ -1 +1,2 @@\n package domain\n+// note\n"}},
	}
	if missing := undeliverableImpactFiles(root, plan); len(missing) != 0 {
		t.Fatalf("an existing declared file must not be treated as undeliverable: %v", missing)
	}
}

// A workflow/evidence round carries no patch; its impact_files forecast a later
// change and promise nothing for delivery now.
func TestWorkflowPlanWithoutPatchIsNeverIncomplete(t *testing.T) {
	root := completenessProject(t)
	plan := &domain.ExecutionPlan{
		PlanID: "plan_probe", RequestID: "req_probe",
		ImpactFiles: []string{"services/backend/internal/domain/debug.go"},
		Operations:  []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "vet", "./..."}}}},
	}
	if missing := undeliverableImpactFiles(root, plan); len(missing) != 0 {
		t.Fatalf("a command-only plan must never be reported incomplete: %v", missing)
	}
}

// The check fails open: an unreadable project must not reject a valid change.
func TestUnresolvableProjectNeverRejects(t *testing.T) {
	plan := &domain.ExecutionPlan{
		PlanID: "plan_open", RequestID: "req_open",
		ImpactFiles: []string{"whatever.go"},
		Operations:  []domain.Operation{{Type: "apply_patch", Patch: "--- a/x.go\n+++ b/x.go\n@@ -1 +1 @@\n-a\n+b\n"}},
	}
	if missing := undeliverableImpactFiles("", plan); len(missing) != 0 {
		t.Fatalf("an unresolvable project must fail open, got %v", missing)
	}
	// A traversal-shaped declaration is treated as existing rather than used to
	// reject, and never escapes the project root.
	root := completenessProject(t)
	escaping := &domain.ExecutionPlan{
		PlanID: "plan_escape", RequestID: "req_escape",
		ImpactFiles: []string{"../outside.go"},
		Operations:  []domain.Operation{{Type: "apply_patch", Patch: "--- a/x.go\n+++ b/x.go\n@@ -1 +1 @@\n-a\n+b\n"}},
	}
	if missing := undeliverableImpactFiles(root, escaping); len(missing) != 0 {
		t.Fatalf("a traversal declaration must fail open, got %v", missing)
	}
}
