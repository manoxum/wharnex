package app

import (
	"errors"
	"fmt"
	"testing"

	"kernl.local/harness/backend/internal/changeset"
	"kernl.local/harness/backend/internal/domain"
)

func pendingWithChangeSet(id, path string) []domain.PendingHostChange {
	return []domain.PendingHostChange{{
		Plan:      domain.ExecutionPlan{PlanID: "plan-" + id},
		ChangeSet: &domain.ChangeSet{ID: id, Mutations: []domain.FileMutation{{Path: path}}},
	}}
}

func TestRacingConflictDetailsAttributesThePathToItsChangeSet(t *testing.T) {
	pending := pendingWithChangeSet("cs-1", "services/frontend/src/App.executionRecovery.test.ts")
	// Exactly the error changeset.Commit returns, before any classification
	// wrapping — escalation must decide on this, not on a rendered message.
	cause := error(&changeset.ExternalWriteRaceError{Path: "services/frontend/src/App.executionRecovery.test.ts"})

	details := racingConflictDetails(pending, cause)
	if len(details) != 1 {
		t.Fatalf("expected one conflicting path, got %d", len(details))
	}
	if details[0].ChangeSetID != "cs-1" {
		t.Fatalf("race was not attributed to its ChangeSet: %+v", details[0])
	}
	if details[0].Path != "services/frontend/src/App.executionRecovery.test.ts" {
		t.Fatalf("wrong path: %+v", details[0])
	}
	if details[0].Reason == "" {
		t.Fatal("a conflict detail must explain itself to the resolver")
	}
}

// The race error travels wrapped through several layers before the decision to
// escalate is made, so extraction must be by type, never by message matching.
func TestRacingConflictDetailsUnwrapsNestedRaceErrors(t *testing.T) {
	pending := pendingWithChangeSet("cs-1", "a.txt")
	nested := fmt.Errorf("commit: %w", fmt.Errorf("integration: %w", &changeset.ExternalWriteRaceError{Path: "a.txt"}))
	if len(racingConflictDetails(pending, nested)) != 1 {
		t.Fatal("a wrapped race error must still be recognized")
	}
}

// Escalation reads the raw commit error deliberately. Classification wrapping
// uses %v, which severs the chain, so wrapping before escalating would
// silently restore the endless-retry behavior this replaced.
func TestRacingConflictDetailsIsNotReachedThroughValueFormattedWrapping(t *testing.T) {
	pending := pendingWithChangeSet("cs-1", "a.txt")
	severed := fmt.Errorf("%w: %v", ErrHostIntegrationRace, &changeset.ExternalWriteRaceError{Path: "a.txt"})
	if details := racingConflictDetails(pending, severed); details != nil {
		t.Fatal("value-formatted wrapping is expected to sever the chain; escalate before classifying")
	}
}

func TestRacingConflictDetailsIgnoresUnrelatedFailures(t *testing.T) {
	pending := pendingWithChangeSet("cs-1", "a.txt")
	if details := racingConflictDetails(pending, errors.New("disk full")); details != nil {
		t.Fatalf("a non-race failure must not be escalated as a conflict: %+v", details)
	}
}

// Without an owning candidate there is no BASE/RESULT content to resolve
// against, so inventing a conflict would produce an unanswerable request.
func TestRacingConflictDetailsRequiresAnOwningCandidate(t *testing.T) {
	pending := pendingWithChangeSet("cs-1", "a.txt")
	cause := &changeset.ExternalWriteRaceError{Path: "somewhere/else.txt"}
	if details := racingConflictDetails(pending, cause); details != nil {
		t.Fatalf("an unattributable race must not become a conflict: %+v", details)
	}
}

func TestChangeSetIDForPathIsTheInverseOfMutationLookup(t *testing.T) {
	pending := []domain.PendingHostChange{
		{Plan: domain.ExecutionPlan{PlanID: "p1"}, ChangeSet: &domain.ChangeSet{ID: "cs-1", Mutations: []domain.FileMutation{{Path: "a.txt"}}}},
		{Plan: domain.ExecutionPlan{PlanID: "p2"}, ChangeSet: &domain.ChangeSet{ID: "cs-2", Mutations: []domain.FileMutation{{Path: "b.txt"}}}},
	}
	if id := changeSetIDForPath(pending, "b.txt"); id != "cs-2" {
		t.Fatalf("expected cs-2, got %q", id)
	}
	if id := changeSetIDForPath(pending, "missing.txt"); id != "" {
		t.Fatalf("expected no owner, got %q", id)
	}
}
