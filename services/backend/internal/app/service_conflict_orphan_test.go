package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// Production released an orphaned conflict on a component and, with it,
// retired that component's implementation from the candidate while keeping
// the tests written for it: the tests reached the host and failed there. An
// orphan's round will never deliver a replacement, so its release must leave
// every candidate whole.
func TestOrphanedConflictReleaseKeepsTheCandidateWhole(t *testing.T) {
	requireGitForApp(t)
	service, _ := gitSurfaceService(t)
	host := gitRepo(t, "app.go", "package main\n")
	started, err := service.StartSessionWithModes(context.Background(), host, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, host, "add", "-A")
	runGitForApp(t, host, "commit", "-qm", "chore: add project config")
	candidate := publishTestCandidateFiles(t, host, "req_component", map[string]string{
		"component.go": "package main\n// component\n", "component_test.go": "package main\n",
	})

	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "failed"
		item.LastRequestID = "req_newer"
		item.PendingHostChanges = []domain.PendingHostChange{candidate}
		item.IntegrationConflict = &domain.ConflictResolution{
			ID: "conflict-orphan", RequestID: "req_stale", Paths: []string{"component.go"},
			OriginalPlanIDs: []string{candidate.Plan.PlanID},
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	item, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	healed, updated, err := service.healPendingIntegrationState(context.Background(), started.ID, item, item.PendingHostChanges)
	if err != nil {
		t.Fatal(err)
	}
	if updated.IntegrationConflict != nil {
		t.Fatal("the orphaned record must be released")
	}
	if len(healed) != 1 || healed[0].IntegrationBranch != candidate.IntegrationBranch || healed[0].IntegrationCommit != candidate.IntegrationCommit {
		t.Fatalf("the candidate must keep its integration branch untouched: %+v", healed)
	}
	paths := actualPatchFiles(&healed[0].Plan)
	if len(paths) != 2 {
		t.Fatalf("both the implementation and its test must survive, got %v", paths)
	}
}
