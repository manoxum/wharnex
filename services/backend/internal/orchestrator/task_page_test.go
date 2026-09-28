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

func TestTaskPageContractMemory(t *testing.T) {
	runTaskPageContract(t, NewMemoryStore())
}

func TestTaskPageContractPostgres(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("orchestrator_task_page_%d", time.Now().UnixNano())
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
	store, err := NewPostgresStore(context.Background(), testURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	runTaskPageContract(t, store)
}

func runTaskPageContract(t *testing.T, store *Store) {
	t.Helper()
	ctx := context.Background()
	base := time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)
	seed := []Task{
		{ID: "task-archived", ProjectPath: "/project/a", Title: "Archived release", Description: "historical deployment", Status: TaskArchived, CreatedAt: base.Add(time.Hour), UpdatedAt: base.Add(5 * time.Hour)},
		{ID: "task-search-new", ProjectPath: "/project/a", Title: "Database cleanup", Description: "contains Needle for lookup", Status: TaskComplete, CreatedAt: base.Add(2 * time.Hour), UpdatedAt: base.Add(4 * time.Hour)},
		{ID: "task-search-old", ProjectPath: "/project/a", Title: "Needle migration", Description: "completed safely", Status: TaskComplete, CreatedAt: base.Add(3 * time.Hour), UpdatedAt: base.Add(3 * time.Hour)},
		{ID: "task-complete-old", ProjectPath: "/project/a", Title: "Old complete task", Status: TaskComplete, CreatedAt: base.Add(4 * time.Hour), UpdatedAt: base.Add(2 * time.Hour)},
		{ID: "task-active", ProjectPath: "/project/a", Title: "Still active", Status: TaskReady, CreatedAt: base.Add(5 * time.Hour), UpdatedAt: base.Add(6 * time.Hour)},
		{ID: "task-other-project", ProjectPath: "/project/b", Title: "Other project terminal", Status: TaskComplete, CreatedAt: base.Add(6 * time.Hour), UpdatedAt: base.Add(7 * time.Hour)},
	}
	for _, task := range seed {
		if err := store.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
	}

	first, err := store.ListTaskPage(ctx, "/project/a", TaskPageFilter{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 4 || len(first.Tasks) != 2 || !first.HasMore || first.NextCursor == "" {
		t.Fatalf("unexpected first page: %#v", first)
	}
	if first.Tasks[0].ID != "task-archived" || first.Tasks[1].ID != "task-search-new" {
		t.Fatalf("unexpected first page order: %#v", first.Tasks)
	}

	inserted := Task{ID: "task-concurrent", ProjectPath: "/project/a", Title: "Concurrent completion", Status: TaskComplete, CreatedAt: base.Add(7 * time.Hour), UpdatedAt: base.Add(8 * time.Hour)}
	if err := store.PutTask(ctx, inserted); err != nil {
		t.Fatal(err)
	}
	second, err := store.ListTaskPage(ctx, "/project/a", TaskPageFilter{Limit: 2, Cursor: first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Tasks) != 2 || second.Tasks[0].ID != "task-search-old" || second.Tasks[1].ID != "task-complete-old" {
		t.Fatalf("unexpected second page after concurrent insert: %#v", second)
	}
	seen := map[string]bool{}
	for _, task := range append(append([]Task(nil), first.Tasks...), second.Tasks...) {
		if seen[task.ID] {
			t.Fatalf("task %q was duplicated across cursor pages", task.ID)
		}
		seen[task.ID] = true
	}
	if seen[inserted.ID] {
		t.Fatalf("newer concurrent task leaked behind the existing cursor: %#v", second.Tasks)
	}

	search, err := store.ListTaskPage(ctx, "/project/a", TaskPageFilter{Search: "needle", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if search.Total != 2 || len(search.Tasks) != 2 {
		t.Fatalf("search page=%#v, want two matching terminal tasks", search)
	}

	archived, err := store.ListTaskPage(ctx, "/project/a", TaskPageFilter{Status: TaskArchived, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if archived.Total != 1 || len(archived.Tasks) != 1 || archived.Tasks[0].ID != "task-archived" {
		t.Fatalf("archived filter returned %#v", archived)
	}

	other, err := store.ListTaskPage(ctx, "/project/b", TaskPageFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if other.Total != 1 || len(other.Tasks) != 1 || other.Tasks[0].ProjectPath != "/project/b" {
		t.Fatalf("project filter leaked tasks: %#v", other)
	}

	empty, err := store.ListTaskPage(ctx, "/project/empty", TaskPageFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if empty.Total != 0 || len(empty.Tasks) != 0 || empty.Tasks == nil || empty.HasMore || empty.NextCursor != "" {
		t.Fatalf("empty page contract mismatch: %#v", empty)
	}
}

func TestTaskPageFilterCapsLimitAndRejectsNonTerminalStatus(t *testing.T) {
	filter, cursor, err := normalizeTaskPageFilter(TaskPageFilter{Limit: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if filter.Limit != maxTaskPageLimit || cursor != nil {
		t.Fatalf("normalized filter=%#v cursor=%#v", filter, cursor)
	}
	if _, _, err := normalizeTaskPageFilter(TaskPageFilter{Status: TaskReady}); err == nil {
		t.Fatal("non-terminal status was accepted by terminal task pagination")
	}
}
