package workflowbaseline

import (
	"path"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// Compatible proves that a scoped workflow's semantic inputs did not move.
func Compatible(plan *domain.ExecutionPlan, before, after map[string]string) bool {
	if plan == nil || plan.Debug == nil || len(plan.ReadFiles) == 0 || len(plan.ImpactFiles) != 0 || before == nil || after == nil {
		return false
	}
	for _, op := range plan.Operations {
		if op.Type == "apply_patch" || strings.TrimSpace(op.Patch) != "" {
			return false
		}
		if op.Type == "filesystem" && (op.Filesystem == nil || (op.Filesystem.Action != "read" && op.Filesystem.Action != "list" && op.Filesystem.Action != "stat")) {
			return false
		}
	}
	for _, file := range append(append([]string(nil), plan.ReadFiles...), plan.BarrierFiles...) {
		if file == "" || path.Clean(file) != file || path.IsAbs(file) || file == "." || file == ".." || strings.HasPrefix(file, "../") {
			return false
		}
		if before[file] == "" || after[file] == "" || before[file] != after[file] {
			return false
		}
	}
	return true
}
