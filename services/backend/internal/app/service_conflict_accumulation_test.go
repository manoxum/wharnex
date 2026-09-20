package app

import (
	"context"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// TestConflictThreadAccumulatesOutstandingPathsAcrossCandidates reproduces the
// ping-pong that made a real chat unresolvable for hours.
//
// Apply merges every pending candidate in one pass, so a second candidate can
// collide while the first collision is still unresolved. The conflict record
// used to be rebuilt from the newest collision alone — same id, but its paths
// and owning plan replaced — which silently dropped the earlier pair. Because
// retireConflictingMutations reads exactly this record to decide what to strip
// from which candidate, the dropped candidate kept its conflicting content and
// collided again on the next Apply, re-recording itself and dropping the other
// one in turn. The two alternated forever, each round looking like a fresh
// first failure, and neither could converge.
func TestConflictThreadAccumulatesOutstandingPathsAcrossCandidates(t *testing.T) {
	service := &Service{}
	existing := domain.Session{IntegrationConflict: &domain.ConflictResolution{
		ID:              "conflict-thread",
		OriginalPlanIDs: []string{"plan-original"},
		Paths:           []string{"services/frontend/src/styles.css"},
		PathSources: map[string]domain.ConflictPathSource{
			"services/frontend/src/styles.css": {PlanID: "plan-original", CandidateSHA: "aaa111", MergeBaseSHA: "base111"},
		},
	}}
	conflict := &sandbox.MergeConflictError{
		Paths: []string{"TODO.md"}, Branch: "whx/req-resolution", HostSHA: "host222", MergeBaseSHA: "base222",
	}

	paths, sources, planIDs := service.accumulateConflictPaths(
		context.Background(), existing, t.TempDir(), "plan-resolution", conflict, []string{"TODO.md"}, true)

	if len(paths) != 2 {
		t.Fatalf("an unresolved path was dropped instead of carried: %v", paths)
	}
	assertContains(t, paths, "TODO.md")
	assertContains(t, paths, "services/frontend/src/styles.css")

	// Retirement is keyed on the owning plan, so losing the earlier candidate
	// here is exactly what left it colliding on every later Apply.
	if len(planIDs) != 2 {
		t.Fatalf("an owning candidate was dropped from retirement: %v", planIDs)
	}
	assertContains(t, planIDs, "plan-original")
	assertContains(t, planIDs, "plan-resolution")

	// The carried path keeps its own source commits: its BASE and RESULT are
	// only readable from the merge that discovered it, not from this one.
	carried := sources["services/frontend/src/styles.css"]
	if carried.CandidateSHA != "aaa111" || carried.MergeBaseSHA != "base111" || carried.PlanID != "plan-original" {
		t.Fatalf("carried path lost its source commits: %#v", carried)
	}
	fresh := sources["TODO.md"]
	if fresh.PlanID != "plan-resolution" || fresh.MergeBaseSHA != "base222" {
		t.Fatalf("new path recorded the wrong source: %#v", fresh)
	}
}

// A first collision has nothing to carry and must record only itself.
func TestConflictThreadRecordsOnlyItsOwnPathsWhenNotContinuing(t *testing.T) {
	service := &Service{}
	conflict := &sandbox.MergeConflictError{
		Paths: []string{"TODO.md"}, Branch: "whx/req-first", HostSHA: "host1", MergeBaseSHA: "base1",
	}

	paths, sources, planIDs := service.accumulateConflictPaths(
		context.Background(), domain.Session{}, t.TempDir(), "plan-first", conflict, []string{"TODO.md"}, false)

	if len(paths) != 1 || paths[0] != "TODO.md" {
		t.Fatalf("unexpected paths: %v", paths)
	}
	if len(planIDs) != 1 || planIDs[0] != "plan-first" {
		t.Fatalf("unexpected plans: %v", planIDs)
	}
	if sources["TODO.md"].MergeBaseSHA != "base1" {
		t.Fatalf("unexpected source: %#v", sources["TODO.md"])
	}
}

func assertContains(t *testing.T, values []string, want string) {
	t.Helper()
	for _, value := range values {
		if value == want {
			return
		}
	}
	t.Fatalf("expected %q in %v", want, values)
}
