package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
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

func TestMemoryStoreFirstDoingAtSurvivesRoundTripAndReconstruction(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	base := time.Date(2026, time.September, 28, 12, 0, 0, 0, time.UTC)
	task := Task{ID: "task-first-doing", ProjectPath: "/project/a", Title: "Lifecycle", Status: TaskReady, CreatedAt: base, UpdatedAt: base}
	if err := store.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	task.Status = TaskDoing
	task.UpdatedAt = base.Add(time.Minute)
	if err := store.PutTask(ctx, task); err != nil {
		t.Fatal(err)
	}
	started, err := store.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if started.FirstDoingAt == nil {
		t.Fatal("first DOING persistence did not record first_doing_at")
	}
	firstDoingAt := *started.FirstDoingAt

	started.Status = TaskReview
	started.FirstDoingAt = nil
	started.UpdatedAt = base.Add(2 * time.Minute)
	if err := store.PutTask(ctx, started); err != nil {
		t.Fatal(err)
	}
	archived, err := store.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	archived.Status = TaskArchived
	archived.FirstDoingAt = nil
	archived.UpdatedAt = base.Add(3 * time.Minute)
	if err := store.PutTask(ctx, archived); err != nil {
		t.Fatal(err)
	}
	archived, err = store.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if archived.FirstDoingAt == nil || !archived.FirstDoingAt.Equal(firstDoingAt) {
		t.Fatalf("archive lost first_doing_at: got=%v want=%v", archived.FirstDoingAt, firstDoingAt)
	}

	payload, err := json.Marshal(archived)
	if err != nil {
		t.Fatal(err)
	}
	var restored Task
	if err := json.Unmarshal(payload, &restored); err != nil {
		t.Fatal(err)
	}
	restarted := NewMemoryStore()
	if err := restarted.PutTask(ctx, restored); err != nil {
		t.Fatal(err)
	}
	reloaded, err := restarted.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.FirstDoingAt == nil || !reloaded.FirstDoingAt.Equal(firstDoingAt) {
		t.Fatalf("reconstructed store lost first_doing_at: got=%v want=%v", reloaded.FirstDoingAt, firstDoingAt)
	}
}

func TestPostgresStoreFirstDoingAtSurvivesReopen(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("orchestrator_first_doing_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
		_ = admin.Close()
	})
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()

	ctx := context.Background()
	store, err := NewPostgresStore(ctx, testURL.String())
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, time.September, 28, 13, 0, 0, 0, time.UTC)
	task := Task{ID: "task-postgres-first-doing", ProjectPath: "/project/a", Title: "Persistent lifecycle", Status: TaskDoing, CreatedAt: base, UpdatedAt: base}
	if err := store.PutTask(ctx, task); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	started, err := store.GetTask(ctx, task.ID)
	if err != nil || started.FirstDoingAt == nil {
		_ = store.Close()
		t.Fatalf("persisted first_doing_at=%v err=%v", started.FirstDoingAt, err)
	}
	firstDoingAt := *started.FirstDoingAt
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	restarted, err := NewPostgresStore(ctx, testURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restarted.Close() })
	reloaded, err := restarted.GetTask(ctx, task.ID)
	if err != nil || reloaded.FirstDoingAt == nil || !reloaded.FirstDoingAt.Equal(firstDoingAt) {
		t.Fatalf("reopened store first_doing_at=%v want=%v err=%v", reloaded.FirstDoingAt, firstDoingAt, err)
	}
	reloaded.Status = TaskArchived
	reloaded.FirstDoingAt = nil
	reloaded.UpdatedAt = base.Add(time.Hour)
	if err := restarted.PutTask(ctx, reloaded); err != nil {
		t.Fatal(err)
	}
	archived, err := restarted.GetTask(ctx, task.ID)
	if err != nil || archived.FirstDoingAt == nil || !archived.FirstDoingAt.Equal(firstDoingAt) {
		t.Fatalf("archived reopened task first_doing_at=%v want=%v err=%v", archived.FirstDoingAt, firstDoingAt, err)
	}
}
