package app

import (
	"context"
	"errors"
	"path/filepath"
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

func TestServiceStartupCleansOrphanedIntegrationBranchesAndPreservesPendingOnes(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "modules/child")
	child := filepath.Join(root, "modules", "child")

	for _, repo := range []string{root, child} {
		runGitForApp(t, repo, "branch", "whx/req_keep")
		runGitForApp(t, repo, "branch", "whx/req_stale")
		runGitForApp(t, repo, "branch", "feature/operator")
	}
	runGitForApp(t, child, "branch", "whx/req_child_keep")

	store := session.NewStore()
	plan := domain.ExecutionPlan{
		PlanID: "plan_keep", RequestID: "req_keep",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n content\n+pending\n"}},
	}
	if err := store.Put(domain.Session{
		ID: "ses_keep", ProjectPath: root, State: "conflict_resolution_pending", ExecutionMode: domain.ExecutionModeProtected,
		PendingHostChanges: []domain.PendingHostChange{{
			Plan: plan, IntegrationBranch: "whx/req_keep",
			SubmoduleIntegrations: []domain.RepositoryIntegration{{Path: "modules/child", Branch: "whx/req_keep", TargetBranch: "main"}},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	childPlan := plan
	childPlan.PlanID = "plan_child_keep"
	childPlan.RequestID = "req_child_keep"
	if err := store.Put(domain.Session{
		ID: "ses_child_keep", ProjectPath: child, State: "conflict_resolution_pending", ExecutionMode: domain.ExecutionModeProtected,
		PendingHostChanges: []domain.PendingHostChange{{Plan: childPlan, IntegrationBranch: "whx/req_child_keep"}},
	}); err != nil {
		t.Fatal(err)
	}

	_ = NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())

	assertIntegrationBranches(t, root, false)
	assertIntegrationBranches(t, child, true)
}

func TestFailedIntegrationPublishCleansRootAndSubmoduleBranches(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "modules/child")
	child := filepath.Join(root, "modules", "child")
	branch := "whx/req_publish_failed"
	runGitForApp(t, root, "branch", branch)
	runGitForApp(t, child, "branch", branch)

	service := &Service{bus: audit.NewBus()}
	item := domain.Session{ID: "ses_publish_failed", ProjectPath: root}
	cause := errors.New("persist candidate")
	_, _, err := service.cleanupFailedIntegrationPublish(
		context.Background(), item.ID, item, domain.ExecutionResult{}, branch,
		[]domain.RepositoryIntegration{{Path: "modules/child", Branch: branch, TargetBranch: "main"}}, cause,
	)
	if !errors.Is(err, cause) {
		t.Fatalf("expected persistence error to be returned, got %v", err)
	}
	for _, repo := range []string{root, child} {
		branches, listErr := hostrepo.Branches(context.Background(), repo)
		if listErr != nil {
			t.Fatal(listErr)
		}
		for _, candidate := range branches {
			if candidate.Remote == "" && candidate.Name == branch {
				t.Fatalf("failed publish branch survived cleanup in %s", repo)
			}
		}
	}
}

func assertIntegrationBranches(t *testing.T, repo string, expectChildPending bool) {
	t.Helper()
	branches, err := hostrepo.Branches(context.Background(), repo)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, branch := range branches {
		if branch.Remote == "" {
			names[branch.Name] = true
		}
	}
	if !names["whx/req_keep"] {
		t.Fatalf("pending integration branch was removed from %s: %+v", repo, names)
	}
	if names["whx/req_stale"] {
		t.Fatalf("orphaned integration branch survived startup cleanup in %s: %+v", repo, names)
	}
	if !names["feature/operator"] {
		t.Fatalf("non-Wharnex branch was removed from %s: %+v", repo, names)
	}
	if expectChildPending && !names["whx/req_child_keep"] {
		t.Fatalf("pending integration branch owned by the child project was removed: %+v", names)
	}
}
