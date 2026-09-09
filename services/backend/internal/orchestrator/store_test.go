package orchestrator

import (
	"context"
	"testing"
	"time"
)

func TestMemoryStoreAppendRunUpsertsByRunID(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now().UTC()
	run := TaskRun{ID: "run-1", TaskID: "task-1", Attempt: 1, Status: "starting", StartedAt: now}
	if err := store.AppendRun(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	run.Status = "review"
	if err := store.AppendRun(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	runs, err := store.ListRuns(context.Background(), run.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].Status != "review" {
		t.Fatalf("expected one updated run, got %#v", runs)
	}
}
