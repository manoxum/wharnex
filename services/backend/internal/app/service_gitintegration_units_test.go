package app

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

func unitPlan() *domain.ExecutionPlan {
	return &domain.ExecutionPlan{
		PlanID: "plan_x", RequestID: "req_x",
		Summary:       "Fix the dependency install.",
		CommitMessage: "fix(app): pin the npm registry\n\nThe default mirror times out in CI.",
	}
}

// One change, one message, in every repository it touches: splitting it would
// make each repository's history describe a fragment.
func TestCommitMessageForUnitKeepsThePlannersMessageInEveryRepository(t *testing.T) {
	submodule := commitMessageForUnit(unitPlan(), "services/app", nil)
	if !strings.HasPrefix(submodule, "fix(app): pin the npm registry\n\nThe default mirror times out in CI.") {
		t.Fatalf("the planner's subject and body must survive verbatim:\n%s", submodule)
	}
	if !strings.Contains(submodule, "\nWharnex-Unit: services/app") {
		t.Fatalf("a submodule commit must record which unit it belongs to:\n%s", submodule)
	}
	if !strings.Contains(submodule, "Request-Id: req_x") || !strings.Contains(submodule, "Plan-Id: plan_x") {
		t.Fatalf("the existing trailers must be preserved:\n%s", submodule)
	}
}

// A superproject commit whose subject describes a source change would otherwise
// sit in `git log` above a diff containing nothing but a 40-character hash.
func TestCommitMessageForUnitExplainsAPointerOnlyCommit(t *testing.T) {
	root := commitMessageForUnit(unitPlan(), hostrepo.RootUnitPath, []string{"services/app"})
	if !strings.Contains(root, "Records the submodule commit(s) this change was verified against: services/app.") {
		t.Fatalf("a pointer-recording commit must say so in its body:\n%s", root)
	}
	if !strings.Contains(root, "\nWharnex-Submodule-Update: services/app") {
		t.Fatalf("the moved pointer must be machine-readable after the fact:\n%s", root)
	}
	if strings.Contains(root, "Wharnex-Unit:") {
		t.Fatalf("the superproject is the default unit and must not be labelled:\n%s", root)
	}
	// The automatic commit and the manual-mode pending record must carry
	// identical history, so both are built from this one construction.
	if commitMessageForPlan(unitPlan()) != commitMessageForUnit(unitPlan(), hostrepo.RootUnitPath, nil) {
		t.Fatal("the plan-level message must be the root unit's message with no pointers")
	}
}

// A candidate persisted before ADR-0050 has no unit records and must merge
// exactly what it always did: the superproject alone.
func TestIntegrationUnitPathsFallsBackToTheSuperproject(t *testing.T) {
	legacy := domain.PendingHostChange{IntegrationBranch: "whx/req_legacy"}
	paths := integrationUnitPaths(legacy)
	if len(paths) != 1 || paths[0] != hostrepo.RootUnitPath {
		t.Fatalf("expected the superproject alone, got %v", paths)
	}

	modern := domain.PendingHostChange{IntegrationUnits: []domain.IntegrationUnit{
		{Path: "services/app", Branch: "whx/req_x", Commit: "aaa"},
		{Path: hostrepo.RootUnitPath, Branch: "whx/req_x", Commit: "bbb", PointerUpdates: []string{"services/app"}},
	}}
	if got := integrationUnitPaths(modern); len(got) != 2 || got[0] != "services/app" {
		t.Fatalf("unexpected unit paths: %v", got)
	}
	if rootIntegrationBranch(modern.IntegrationUnits) != "whx/req_x" || rootIntegrationCommit(modern.IntegrationUnits) != "bbb" {
		t.Fatal("the legacy single-branch fields must resolve to the superproject's own record")
	}
	if pointers := rootPointerUpdates(modern); len(pointers) != 1 || pointers[0] != "services/app" {
		t.Fatalf("unexpected pointer updates: %v", pointers)
	}
}

// Unpushed commits in another repository are the one consequence of
// submodule-native integration an operator must not discover by accident.
func TestIntegratedSubmoduleUnitsDeduplicatesAcrossCandidates(t *testing.T) {
	units := integratedSubmoduleUnits([]integratedCandidate{
		{branch: "whx/a", units: []string{"services/app"}},
		{branch: "whx/b", units: []string{"services/app", "services/be"}},
		{branch: "whx/c"},
	})
	if len(units) != 2 || units[0] != "services/app" || units[1] != "services/be" {
		t.Fatalf("unexpected submodule units: %v", units)
	}
	branches := integratedBranches([]integratedCandidate{{branch: "whx/a", units: []string{"services/app"}}})
	if len(branches) != 2 {
		t.Fatalf("cleanup must cover every unit's own branch ref, got %+v", branches)
	}
	if branches[0].UnitPath != hostrepo.RootUnitPath || branches[1].UnitPath != "services/app" {
		t.Fatalf("unexpected cleanup targets: %+v", branches)
	}
}
