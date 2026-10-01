package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestServiceStartupStillReportsExistingInvalidRepository(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_invalid", ProjectPath: root}); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()

	_ = NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())

	event := requireStartupCleanupEvent(t, bus.History("ses_invalid"), "integration.branch_cleanup_failed")
	if event.Data["reason"] != "startup_repository_inventory" {
		t.Fatalf("existing invalid repository must stay visible: %#v", event.Data)
	}
}

func TestServiceStartupPreservesCheckedOutIntegrationBranch(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepo(t, "README.md")
	runGitForApp(t, root, "switch", "-c", "whx/req_current")
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_current", ProjectPath: root}); err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()

	_ = NewService(store, bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())

	branches, err := hostrepo.Branches(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	foundCurrent := false
	for _, branch := range branches {
		if branch.Name == "whx/req_current" && branch.Current {
			foundCurrent = true
		}
	}
	if !foundCurrent {
		t.Fatal("checked-out integration branch was removed or switched")
	}
	event := requireStartupCleanupEvent(t, bus.History("ses_current"), "integration.branch_cleanup_failed")
	if event.Data["reason"] != "startup_orphan_reconcile" {
		t.Fatalf("expected checked-out branch cleanup refusal, got %#v", event.Data)
	}
}

func requireStartupCleanupEvent(t *testing.T, events []domain.Event, eventType string) domain.Event {
	t.Helper()
	for _, event := range events {
		if event.Type == eventType {
			return event
		}
	}
	t.Fatalf("expected %s in %#v", eventType, events)
	return domain.Event{}
}

func assertNoStartupCleanupEvent(t *testing.T, events []domain.Event, eventType string) {
	t.Helper()
	for _, event := range events {
		if event.Type == eventType {
			t.Fatalf("did not expect %s: %#v", eventType, event.Data)
		}
	}
}

func assertIntegrationBranchAbsent(t *testing.T, repo, name string) {
	t.Helper()
	branches, err := hostrepo.Branches(context.Background(), repo)
	if err != nil {
		t.Fatal(err)
	}
	for _, branch := range branches {
		if branch.Remote == "" && branch.Name == name {
			t.Fatalf("integration branch %s survived startup cleanup", name)
		}
	}
}
