package workflowbaseline

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestWorkflowCompatibilityRequiresCompleteUnchangedDependencies(t *testing.T) {
	for _, name := range []string{"unchanged", "changed-read", "missing-read", "missing-before", "changed-barrier", "no-reads", "patch", "filesystem-write", "project-impact", "not-debug", "traversal", "unknown-snapshot"} {
		t.Run(name, func(t *testing.T) {
			plan := &domain.ExecutionPlan{Debug: &domain.DebugSpec{}, ReadFiles: []string{"rules.txt"}, BarrierFiles: []string{"schema.sql"}}
			before := map[string]string{"rules.txt": "rules-hash", "schema.sql": "schema-hash"}
			after := map[string]string{"rules.txt": "rules-hash", "schema.sql": "schema-hash", "parallel-fixture.txt": "new"}
			switch name {
			case "changed-read":
				after["rules.txt"] = "changed"
			case "missing-read":
				delete(after, "rules.txt")
			case "missing-before":
				delete(before, "rules.txt")
			case "changed-barrier":
				after["schema.sql"] = "changed"
			case "no-reads":
				plan.ReadFiles = nil
			case "patch":
				plan.Operations = []domain.Operation{{Type: "apply_patch"}}
			case "filesystem-write":
				plan.Operations = []domain.Operation{{Type: "filesystem", Filesystem: &domain.InteractiveFilesystemSpec{Action: "write", Path: "rules.txt"}}}
			case "project-impact":
				plan.ImpactFiles = []string{"rules.txt"}
			case "not-debug":
				plan.Debug = nil
			case "traversal":
				plan.ReadFiles = []string{"../rules.txt"}
				before["../rules.txt"], after["../rules.txt"] = "same", "same"
			case "unknown-snapshot":
				before = nil
			}
			if got := Compatible(plan, before, after); got != (name == "unchanged") {
				t.Fatalf("compatibility = %v", got)
			}
		})
	}
}
