package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/sandbox"
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

// This reproduces the flowKey-deploy failure identified by context snapshot
// 7310ea4afc10: the request base captured an already-moved services/app
// checkout, so the superproject preflight saw the same gitlink as a sibling
// request-base commit and called it a conflict. The gitlink belongs to a unit
// this integration will merge first; it must not be sent to the planner as
// Wharnex-managed state.
func TestMergeIntegrationBranchesDoesNotRejectOwnedSubmoduleGitlinkDrift(t *testing.T) {
	submoduleSource := t.TempDir()
	gitIn(t, submoduleSource, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(submoduleSource, "lib.txt"), []byte("one\ntwo\nthree\nfour\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gitIn(t, submoduleSource, "add", "lib.txt")
	gitIn(t, submoduleSource, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "base")

	host := t.TempDir()
	gitIn(t, host, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(host, "README.md"), []byte("host\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gitIn(t, host, "add", "README.md")
	gitIn(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "host base")
	gitIn(t, host, "-c", "protocol.file.allow=always", "submodule", "add", "-q", submoduleSource, "services/app")
	gitIn(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qam", "record app")

	appRoot := filepath.Join(host, "services", "app")
	const branch = "whx/req_owned_gitlink"
	gitIn(t, appRoot, "checkout", "-qb", branch)
	if err := os.WriteFile(filepath.Join(appRoot, "lib.txt"), []byte("one\ntwo\nthree\ncandidate\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gitIn(t, appRoot, "add", "lib.txt")
	gitIn(t, appRoot, "-c", "user.name=Wharnex", "-c", "user.email=wharness@localhost", "commit", "-qm", "candidate app change")
	appCandidate := gitIn(t, appRoot, "rev-parse", "HEAD")
	gitIn(t, host, "checkout", "-qb", branch)
	gitIn(t, host, "add", "services/app")
	gitIn(t, host, "-c", "user.name=Wharnex", "-c", "user.email=wharness@localhost", "commit", "-qm", "candidate pointer")
	rootCandidate := gitIn(t, host, "rev-parse", "HEAD")

	gitIn(t, host, "checkout", "-q", "main")
	gitIn(t, appRoot, "checkout", "-q", "main")
	if err := os.WriteFile(filepath.Join(appRoot, "lib.txt"), []byte("one\npeer\nthree\nfour\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gitIn(t, appRoot, "add", "lib.txt")
	gitIn(t, appRoot, "-c", "user.name=Peer", "-c", "user.email=peer@example.invalid", "commit", "-qm", "peer app change")
	if status := gitIn(t, host, "status", "--porcelain"); !strings.Contains(status, "services/app") {
		t.Fatalf("fixture must reproduce the moved host gitlink, got %q", status)
	}
	legacyConflict, err := sandbox.PreflightMergeIntoHost(context.Background(), host, branch)
	if err != nil {
		t.Fatalf("legacy preflight: %v", err)
	}
	if legacyConflict == nil || len(legacyConflict.Paths) != 1 || legacyConflict.Paths[0] != "services/app" {
		t.Fatalf("fixture must reproduce the false services/app conflict, got %#v", legacyConflict)
	}

	plan := domain.ExecutionPlan{
		PlanID: "plan_owned_gitlink", RequestID: "req_owned_gitlink",
		Summary: "update app", CommitMessage: "fix(app): update app",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/services/app/lib.txt\n+++ b/services/app/lib.txt\n"}},
	}
	pending := domain.PendingHostChange{
		Plan: plan, IntegrationBranch: branch, IntegrationCommit: rootCandidate,
		IntegrationUnits: []domain.IntegrationUnit{
			{Path: "services/app", Branch: branch, Commit: appCandidate},
			{Path: hostrepo.RootUnitPath, Branch: branch, Commit: rootCandidate, PointerUpdates: []string{"services/app"}},
		},
	}
	service := &Service{bus: audit.NewBus()}
	integrated, _, failedPlanID, err := service.mergeIntegrationBranches(context.Background(), "ses_owned_gitlink", host, []domain.PendingHostChange{pending})
	if err != nil {
		t.Fatalf("owned services/app gitlink drift must reconcile locally, got %v", err)
	}
	if failedPlanID != "" || len(integrated) != 1 {
		t.Fatalf("integration did not complete: failed_plan=%q integrated=%+v", failedPlanID, integrated)
	}
	rootPointer := gitIn(t, host, "rev-parse", "HEAD:services/app")
	appHead := gitIn(t, appRoot, "rev-parse", "HEAD")
	if rootPointer != appHead {
		t.Fatalf("superproject records %s, want integrated app HEAD %s", rootPointer, appHead)
	}
	if got, err := os.ReadFile(filepath.Join(appRoot, "lib.txt")); err != nil || string(got) != "one\npeer\nthree\ncandidate\n" {
		t.Fatalf("candidate app content was not integrated: err=%v content=%q", err, got)
	}
	if status := gitIn(t, host, "status", "--porcelain"); strings.TrimSpace(status) != "" {
		t.Fatalf("integration left the host dirty:\n%s", status)
	}
}
