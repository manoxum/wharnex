package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func candidateFor(requestID, planID string, paths ...string) domain.PendingHostChange {
	operations := make([]domain.Operation, 0, 1)
	if len(paths) > 0 {
		patch := ""
		for _, path := range paths {
			patch += "--- a/" + path + "\n+++ b/" + path + "\n@@ -1 +1 @@\n-old\n+new\n"
		}
		operations = append(operations, domain.Operation{Type: "apply_patch", Patch: patch})
	}
	return domain.PendingHostChange{Plan: domain.ExecutionPlan{
		PlanID: planID, RequestID: requestID, ImpactFiles: paths, Operations: operations,
	}}
}

// The exact shape a real chat reached: the original candidate plus two
// conflict-resolution rounds for the same file, all still pending. Three
// candidates claiming one path cannot be reconciled by any merge, so every
// later Apply reproduced the same collision.
func TestSupersededConflictResolutionRetiresEarlierRoundsOfTheSameThread(t *testing.T) {
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		"req-original": {RequestID: "req-original", Kind: requestKindStandard},
		"req-r2":       {RequestID: "req-r2", ParentRequestID: "req-original", Kind: requestKindConflict},
		"req-r3":       {RequestID: "req-r3", ParentRequestID: "req-r2", Kind: requestKindConflict},
	}}
	pending := []domain.PendingHostChange{
		candidateFor("req-original", "plan-original", "services/frontend/src/styles.css", "services/frontend/src/App.tsx"),
		candidateFor("req-r2", "plan-r2", "services/frontend/src/styles.css"),
		candidateFor("req-r3", "plan-r3", "services/frontend/src/styles.css"),
	}

	superseded := supersededConflictResolution(item, pending)
	if superseded == nil {
		t.Fatal("expected the earlier rounds of this conflict thread to be superseded")
	}
	if len(superseded.Paths) != 1 || superseded.Paths[0] != "services/frontend/src/styles.css" {
		t.Fatalf("only the resolved path may be retired, got %v", superseded.Paths)
	}
	// Both earlier links must be retired: retiring only the nearest one leaves
	// the original still claiming the same file.
	assertContains(t, superseded.OriginalPlanIDs, "plan-original")
	assertContains(t, superseded.OriginalPlanIDs, "plan-r2")
	if containsString(superseded.OriginalPlanIDs, "plan-r3") {
		t.Fatal("the newest resolution must never retire itself")
	}
}

// AGENTS.md is explicit that whether two changes combine is decided by a real
// three-way merge, never by impact-file overlap. Two unrelated candidates that
// happen to touch one file must therefore be left alone.
func TestSupersededConflictResolutionIgnoresUnrelatedCandidatesSharingAPath(t *testing.T) {
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		"req-a": {RequestID: "req-a", Kind: requestKindStandard},
		"req-b": {RequestID: "req-b", Kind: requestKindStandard},
	}}
	pending := []domain.PendingHostChange{
		candidateFor("req-a", "plan-a", "shared.go"),
		candidateFor("req-b", "plan-b", "shared.go"),
	}

	if superseded := supersededConflictResolution(item, pending); superseded != nil {
		t.Fatalf("independent candidates must stay a real merge, got retirement of %v", superseded.Paths)
	}
}

// A candidate promoted from a legacy ChangeSet onto a Git-native integration
// branch carries both representations. Retirement used to filter the ChangeSet
// and stop there, leaving untouched the branch Apply actually merges — so it
// reported success while changing nothing that mattered, and that candidate
// collided on the very same path on every later Apply no matter how many
// resolutions arrived. This is what made one real chat unresolvable for hours.
func TestRetireConflictingMutationsNarrowsTheBranchNotOnlyTheChangeSet(t *testing.T) {
	change := candidateFor("req-original", "plan-original", "services/frontend/src/styles.css")
	change.IntegrationBranch = "whx/req-original"
	change.IntegrationCommit = "531d0e5"
	change.ChangeSet = &domain.ChangeSet{ID: "chg-1", Mutations: []domain.FileMutation{
		{Path: "services/frontend/src/styles.css"},
	}}

	remaining, retiredBranches, err := retireConflictingMutations(
		context.Background(), t.TempDir(), "base-sha", []domain.PendingHostChange{change},
		&domain.ConflictResolution{
			Paths:           []string{"services/frontend/src/styles.css"},
			OriginalPlanIDs: []string{"plan-original"},
		})
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 0 {
		t.Fatalf("a candidate whose every path was superseded must not stay pending: %#v", remaining)
	}
	// The branch is the part that matters: leaving it behind is exactly how the
	// same collision came back on every Apply.
	if len(retiredBranches) != 1 || retiredBranches[0] != "whx/req-original" {
		t.Fatalf("the integration branch was not retired: %v", retiredBranches)
	}
}

// A conflict record is cleared only by the exact request it was created for, so
// a thread that moved on left it behind forever — and because Apply refuses
// while any record exists, that orphan parked every later Apply permanently.
func TestOrphanedIntegrationConflictReleasesAParkedSession(t *testing.T) {
	orphaned := domain.Session{
		State:               "verified",
		LastRequestID:       "req-newer",
		IntegrationConflict: &domain.ConflictResolution{ID: "conflict-1", RequestID: "req-stale", Paths: []string{"TODO.md"}},
	}
	if !orphanedIntegrationConflict(orphaned) {
		t.Fatal("a conflict whose round can no longer arrive must be released")
	}

	// Every shape of a still-live conflict must keep blocking.
	live := orphaned
	live.PendingManualRequestIDs = []string{"req-stale"}
	if orphanedIntegrationConflict(live) {
		t.Fatal("a conflict with its own round still pending is live")
	}
	inFlight := orphaned
	inFlight.PlannerInFlight = true
	if orphanedIntegrationConflict(inFlight) {
		t.Fatal("a conflict with the planner in flight is live")
	}
	resolving := orphaned
	resolving.State = "conflict_resolution_pending"
	if orphanedIntegrationConflict(resolving) {
		t.Fatal("a session actively resolving is live")
	}
	sameRequest := orphaned
	sameRequest.LastRequestID = "req-stale"
	if orphanedIntegrationConflict(sameRequest) {
		t.Fatal("the conflict's own request is still the session's current one")
	}
	if orphanedIntegrationConflict(domain.Session{State: "verified"}) {
		t.Fatal("no conflict record means nothing to release")
	}
}
