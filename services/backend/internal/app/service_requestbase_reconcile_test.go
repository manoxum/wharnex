package app

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// The patch shape that broke reconciliation in production: it edits existing
// files and creates new ones in the same change.
const createAndModifyPatch = `--- a/services/backend/internal/domain/types.go
+++ b/services/backend/internal/domain/types.go
@@ -1,2 +1,3 @@
 package domain

+type Placeholder = DebugRun
--- /dev/null
+++ b/services/backend/internal/domain/debug.go
@@ -0,0 +1,3 @@
+package domain
+
+type DebugRun struct{}
`

func writeArchive(t *testing.T, entries map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "base.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, body := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPatchCreatedPathsRecognizesCreationOnly(t *testing.T) {
	created := patchCreatedPaths(createAndModifyPatch)
	if len(created) != 1 || created[0] != "services/backend/internal/domain/debug.go" {
		t.Fatalf("created paths = %v", created)
	}
	// A deletion is not a creation: /dev/null on the +++ side must not count.
	deletion := "--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n"
	if got := patchCreatedPaths(deletion); len(got) != 0 {
		t.Fatalf("a deletion must not be reported as a creation: %v", got)
	}
	// Every touched path is still reported by the unchanged helper, so merge and
	// overlap decisions keep seeing the full write set.
	touched := patchTouchedPaths(createAndModifyPatch)
	if len(touched) != 2 {
		t.Fatalf("touched paths = %v, want both files", touched)
	}
}

// A change that creates a file must still reconcile from its immutable request
// base. Requiring the created file to be present in that archive is impossible
// to satisfy — the file did not exist when the request was planned — and the
// fallthrough retargeted the plan onto a tree it was not authored against,
// wasting three repair rounds on "patch does not apply cleanly" and rejecting
// three command-bearing bundles outright.
func TestArchiveReconciliationAcceptsAPatchThatCreatesFiles(t *testing.T) {
	archive := writeArchive(t, map[string]string{
		"services/backend/internal/domain/types.go": "package domain\n",
		"AGENTS.md": "# rules\n",
	})
	plan := &domain.ExecutionPlan{
		PlanID: "plan_create", RequestID: "req_create",
		ReadFiles:  []string{"AGENTS.md"},
		Operations: []domain.Operation{{Type: "apply_patch", Patch: createAndModifyPatch}},
	}
	item := domain.Session{RequestContextArchives: map[string]string{"req_create": archive}}
	if !canReconcilePlanFromArchive(item, plan) {
		t.Fatal("a patch that creates a file must still reconcile from its immutable base")
	}
}

// The guard must stay a guard: a patch MODIFYING a file absent from the archive
// genuinely cannot be reconciled, because the tree it was authored against
// cannot be reconstructed.
func TestArchiveReconciliationStillRefusesAMissingModifiedFile(t *testing.T) {
	archive := writeArchive(t, map[string]string{"AGENTS.md": "# rules\n"})
	plan := &domain.ExecutionPlan{
		PlanID: "plan_modify", RequestID: "req_modify",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: createAndModifyPatch}},
	}
	item := domain.Session{RequestContextArchives: map[string]string{"req_modify": archive}}
	if canReconcilePlanFromArchive(item, plan) {
		t.Fatal("a modified file missing from the archive must still refuse reconciliation")
	}
}

// A declared read/barrier dependency missing from the archive is likewise still
// a refusal; only creations are exempt.
func TestArchiveReconciliationStillRefusesAMissingReadDependency(t *testing.T) {
	archive := writeArchive(t, map[string]string{
		"services/backend/internal/domain/types.go": "package domain\n",
	})
	plan := &domain.ExecutionPlan{
		PlanID: "plan_read", RequestID: "req_read",
		ReadFiles:  []string{"AGENTS.md"},
		Operations: []domain.Operation{{Type: "apply_patch", Patch: createAndModifyPatch}},
	}
	item := domain.Session{RequestContextArchives: map[string]string{"req_read": archive}}
	if canReconcilePlanFromArchive(item, plan) {
		t.Fatal("a missing read dependency must still refuse reconciliation")
	}
}
