package app

import (
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestConflictAttemptRecordNamesTheGoalAndPaths(t *testing.T) {
	item := domain.Session{
		ConflictAttempt: 1,
		Plan:            &domain.ExecutionPlan{CommitMessage: "feat(api): add pagination", Summary: "s"},
	}
	record := conflictAttemptRecord(item, []string{"a.go", "b.go"})
	if !strings.Contains(record, "attempt 2") {
		t.Fatalf("attempt number missing: %s", record)
	}
	if !strings.Contains(record, "feat(api): add pagination") {
		t.Fatalf("goal missing: %s", record)
	}
	if !strings.Contains(record, "a.go, b.go") {
		t.Fatalf("paths missing: %s", record)
	}
}

func TestConflictAttemptHistoryIsBoundedKeepingRecentRounds(t *testing.T) {
	var history []string
	for round := 0; round < maxAutoRepairAttempts+6; round++ {
		history = appendConflictAttempt(history, "round-"+string(rune('a'+round)))
	}
	if len(history) > maxAutoRepairAttempts+1 {
		t.Fatalf("history grew unbounded: %d entries", len(history))
	}
	last := history[len(history)-1]
	if last != "round-"+string(rune('a'+maxAutoRepairAttempts+5)) {
		t.Fatalf("most recent round was dropped: %v", history)
	}
}

func TestConflictIntentCarriesOurGoalAndRemainingBudget(t *testing.T) {
	service := baseRootService(domain.ExecutionPlan{})
	item := domain.Session{
		ConflictAttempt: 1,
		Plan:            &domain.ExecutionPlan{Summary: "make pagination work", CommitMessage: "feat(api): add pagination"},
		IntegrationConflict: &domain.ConflictResolution{
			ID: "c1", AttemptHistory: []string{"attempt 1: collided on a.go"},
		},
	}
	intent := service.buildConflictIntent(context.Background(), item, "", nil, []string{"a.go"})
	if intent.OurGoal != "make pagination work" {
		t.Fatalf("our goal missing: %+v", intent)
	}
	if intent.OurCommitMessage != "feat(api): add pagination" {
		t.Fatalf("our commit message missing: %+v", intent)
	}
	if intent.Attempt != 2 || intent.MaxAttempts != maxAutoRepairAttempts {
		t.Fatalf("budget wrong: attempt=%d max=%d", intent.Attempt, intent.MaxAttempts)
	}
	if len(intent.PreviousAttempts) != 1 {
		t.Fatalf("previous attempts not carried: %+v", intent.PreviousAttempts)
	}
}
