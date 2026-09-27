package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestServiceStartupSkipsMissingProjectWithoutPendingCandidate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "removed")
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_missing", ProjectPath: root}); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()

	_ = NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())

	assertNoStartupCleanupEvent(t, bus.History("ses_missing"), "integration.branch_cleanup_failed")
	assertNoStartupCleanupEvent(t, bus.History("ses_missing"), "integration.branch_cleanup_deferred")
}

func TestServiceStartupDefersMissingProjectWithPendingCandidate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "removed")
	store := session.NewStore()
	pending := startupCleanupPendingChange("whx/req_keep")
	if err := store.Put(domain.Session{
		ID: "ses_pending", ProjectPath: root, State: "conflict_resolution_pending",
		ExecutionMode: domain.ExecutionModeProtected, PendingHostChanges: []domain.PendingHostChange{pending},
	}); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()

	_ = NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())

	item, err := store.Get("ses_pending")
	if err != nil {
		t.Fatal(err)
	}
	if len(item.PendingHostChanges) != 1 || item.PendingHostChanges[0].IntegrationBranch != "whx/req_keep" {
		t.Fatalf("missing root must preserve the live candidate: %#v", item.PendingHostChanges)
	}
	event := requireStartupCleanupEvent(t, bus.History("ses_pending"), "integration.branch_cleanup_deferred")
	if event.Data["reason"] != "startup_repository_unavailable" || event.Data["action"] != "restore_project_root_or_discard_candidate" {
		t.Fatalf("unexpected deferred event: %#v", event.Data)
	}
	assertNoStartupCleanupEvent(t, bus.History("ses_pending"), "integration.branch_cleanup_failed")
}

func TestServiceStartupDisposesArchivedCandidateBeforeMissingRootCheck(t *testing.T) {
	root := filepath.Join(t.TempDir(), "removed")
	archivedAt := time.Now().UTC()
	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID: "ses_archived", ProjectPath: root, ArchivedAt: &archivedAt,
		PendingHostChanges: []domain.PendingHostChange{startupCleanupPendingChange("whx/req_archived")},
	}); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()

	_ = NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())

	item, err := store.Get("ses_archived")
	if err != nil {
		t.Fatal(err)
	}
	if len(item.PendingHostChanges) != 0 {
		t.Fatalf("archived pending candidate survived startup cleanup: %#v", item.PendingHostChanges)
	}
	requireStartupCleanupEvent(t, bus.History("ses_archived"), "host.pending_disposed")
	assertNoStartupCleanupEvent(t, bus.History("ses_archived"), "integration.branch_cleanup_deferred")
}

func TestServiceStartupRechecksProjectAfterMissingRootReturns(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepo(t, "README.md")
	runGitForApp(t, root, "branch", "whx/req_stale")
	parked := root + "-parked"
	if err := os.Rename(root, parked); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_restore", ProjectPath: root}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	if err := os.Rename(parked, root); err != nil {
		t.Fatal(err)
	}

	service.reconcileOrphanedIntegrationBranches()

	assertIntegrationBranchAbsent(t, root, "whx/req_stale")
}

func startupCleanupPendingChange(branch string) domain.PendingHostChange {
	return domain.PendingHostChange{
		Plan: domain.ExecutionPlan{
			PlanID: "plan_pending", RequestID: "req_pending",
			Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n content\n+pending\n"}},
		},
		IntegrationBranch: branch,
	}
}
