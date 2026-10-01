package orchestrator

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestMemoryStorePendingTaskReviewsUseDurableReviewOrder(t *testing.T) {
	store := NewMemoryStore()
	assertPendingTaskReviews(t, store)
}

func TestPostgresStorePendingTaskReviewsUseDurableReviewOrder(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	store := newPostgresReviewTestStore(t, databaseURL)
	assertPendingTaskReviews(t, store)
}

func assertPendingTaskReviews(t *testing.T, store *Store) {
	t.Helper()
	ctx := context.Background()
	projectPath := "/project/reviews"
	base := time.Date(2026, time.September, 29, 1, 0, 0, 0, time.UTC)
	type fixture struct {
		taskID string
		runID  string
		status TaskStatus
		hour   int
	}
	fixtures := []fixture{
		{taskID: "review-1", runID: "run-a", status: TaskReview, hour: 1},
		{taskID: "review-2", runID: "run-b", status: TaskReview, hour: 2},
		{taskID: "review-3", runID: "run-c", status: TaskReview, hour: 3},
		{taskID: "review-4", runID: "run-d", status: TaskReview, hour: 4},
		{taskID: "review-5", runID: "run-e", status: TaskReview, hour: 5},
		{taskID: "review-6", runID: "run-y", status: TaskReview, hour: 6},
		{taskID: "review-7", runID: "run-z", status: TaskReview, hour: 6},
		{taskID: "complete-newer", runID: "run-complete", status: TaskComplete, hour: 9},
		{taskID: "archived-newest", runID: "run-archived", status: TaskArchived, hour: 10},
	}
	for _, item := range fixtures {
		created := base.Add(time.Duration(item.hour) * time.Hour)
		task := Task{ID: item.taskID, ProjectPath: projectPath, Title: item.taskID, Status: item.status, CreatedAt: created, UpdatedAt: created}
		if err := store.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
		completed := created
		if err := store.AppendRun(ctx, TaskRun{ID: item.runID, TaskID: item.taskID, ProjectPath: projectPath, Attempt: 1, Status: "review", StartedAt: created.Add(-time.Minute), CompletedAt: &completed}); err != nil {
			t.Fatal(err)
		}
	}

	want := []string{"review-7", "review-6", "review-5", "review-4", "review-3"}
	assertReviewTaskIDs(t, store, projectPath, want)

	changed, err := store.GetTask(ctx, "review-3")
	if err != nil {
		t.Fatal(err)
	}
	changed.Title = "metadata changed later"
	changed.UpdatedAt = base.Add(72 * time.Hour)
	if err := store.PutTask(ctx, changed); err != nil {
		t.Fatal(err)
	}
	assertReviewTaskIDs(t, store, projectPath, want)

	finished, err := store.GetTask(ctx, "review-7")
	if err != nil {
		t.Fatal(err)
	}
	finished.Status = TaskComplete
	finished.UpdatedAt = base.Add(96 * time.Hour)
	if err := store.PutTask(ctx, finished); err != nil {
		t.Fatal(err)
	}
	assertReviewTaskIDs(t, store, projectPath, []string{"review-6", "review-5", "review-4", "review-3", "review-2"})
}

func assertReviewTaskIDs(t *testing.T, store *Store, projectPath string, want []string) {
	t.Helper()
	items, err := store.ListPendingTaskReviews(context.Background(), projectPath, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != len(want) {
		t.Fatalf("pending review count=%d want=%d: %#v", len(items), len(want), items)
	}
	for index, taskID := range want {
		if items[index].TaskID != taskID || items[index].Status != TaskReview {
			t.Fatalf("pending review[%d]=%#v want task=%s status=%s", index, items[index], taskID, TaskReview)
		}
	}
}

func newPostgresReviewTestStore(t *testing.T, databaseURL string) *Store {
	t.Helper()
	schema := fmt.Sprintf("orchestrator_recent_reviews_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		_ = admin.Close()
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
	store, err := NewPostgresStore(context.Background(), testURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}
