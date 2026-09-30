package conflict

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestValidateResolutionPlanRequiresOnlyCapsulePaths(t *testing.T) {
	item := domain.Session{IntegrationConflict: &domain.ConflictResolution{
		RequestID: "req-1", Paths: []string{"src/main.go", "src/state.go"}, ManualPaths: []string{"src/state.go"},
	}}
	plan := &domain.ExecutionPlan{RequestID: "req-1"}
	if err := ValidateResolutionPlan(item, plan, []string{"src/main.go"}); err != nil {
		t.Fatalf("valid focused resolution rejected: %v", err)
	}
	if err := ValidateResolutionPlan(item, plan, []string{"outside.go"}); err == nil || !strings.Contains(err.Error(), "outside the capsule") {
		t.Fatalf("outside path was accepted: %v", err)
	}
	item.IntegrationConflict.ManualPaths = nil
	if err := ValidateResolutionPlan(item, plan, []string{"src/main.go"}); err == nil || !strings.Contains(err.Error(), "omitted path") {
		t.Fatalf("unresolved capsule path was accepted: %v", err)
	}
}

func TestPartitionManagedPathsDoesNotGrantPlannerManagedState(t *testing.T) {
	managed, resolvable := PartitionManagedPaths([]string{".wharnex/knowledge/catalog.json", "src/main.go"})
	if len(managed) != 1 || managed[0] != ".wharnex/knowledge/catalog.json" {
		t.Fatalf("managed paths = %v", managed)
	}
	if len(resolvable) != 1 || resolvable[0] != "src/main.go" {
		t.Fatalf("resolvable paths = %v", resolvable)
	}
}
