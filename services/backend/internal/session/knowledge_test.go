package session

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestProjectKnowledgeRoundTripsAndIncrementsVersion(t *testing.T) {
	store := NewStore()
	if _, ok, err := store.GetProjectKnowledge("/workspace/demo"); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("expected no knowledge before the first append")
	}

	first, err := store.AppendProjectKnowledge("/workspace/demo", "# Notes\n\n- first learning\n", "req-1")
	if err != nil {
		t.Fatal(err)
	}
	if first.Version != 1 {
		t.Fatalf("version = %d, want 1", first.Version)
	}
	if first.UpdatedByRequestID != "req-1" {
		t.Fatalf("updated_by_request_id = %q, want req-1", first.UpdatedByRequestID)
	}

	got, ok, err := store.GetProjectKnowledge("/workspace/demo")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.Content != first.Content || got.Version != 1 {
		t.Fatalf("unexpected read-back: %#v", got)
	}

	// A full-document replacement, not a diff: the second call's content
	// entirely replaces the first, and the version increments.
	second, err := store.AppendProjectKnowledge("/workspace/demo", "# Notes\n\n- consolidated learning\n", "req-2")
	if err != nil {
		t.Fatal(err)
	}
	if second.Version != 2 {
		t.Fatalf("version = %d, want 2", second.Version)
	}
	got, _, err = store.GetProjectKnowledge("/workspace/demo")
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != second.Content || got.Version != 2 {
		t.Fatalf("second append did not replace content: %#v", got)
	}
}

func TestPostgresProjectKnowledgeUpsertsAndIncrementsVersion(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("session_knowledge_test_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()

	store, err := NewPostgresStore(context.Background(), testURL.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	first, err := store.AppendProjectKnowledge("/workspace/demo", "first", "req-1")
	if err != nil {
		t.Fatal(err)
	}
	if first.Version != 1 {
		t.Fatalf("version = %d, want 1", first.Version)
	}
	second, err := store.AppendProjectKnowledge("/workspace/demo", "second", "req-2")
	if err != nil {
		t.Fatal(err)
	}
	if second.Version != 2 || second.Content != "second" {
		t.Fatalf("expected upsert to bump version and replace content, got %#v", second)
	}
	got, ok, err := store.GetProjectKnowledge("/workspace/demo")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.Content != "second" || got.Version != 2 {
		t.Fatalf("unexpected read-back: %#v", got)
	}
	if _, ok, err := store.GetProjectKnowledge("/workspace/never-touched"); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("expected no row for a project never appended to")
	}
}

func TestProjectKnowledgeIsIsolatedPerProject(t *testing.T) {
	store := NewStore()
	if _, err := store.AppendProjectKnowledge("/workspace/a", "a-content", "req-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AppendProjectKnowledge("/workspace/b", "b-content", "req-b"); err != nil {
		t.Fatal(err)
	}
	a, _, err := store.GetProjectKnowledge("/workspace/a")
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := store.GetProjectKnowledge("/workspace/b")
	if err != nil {
		t.Fatal(err)
	}
	if a.Content != "a-content" || a.Version != 1 {
		t.Fatalf("project a leaked or wrong version: %#v", a)
	}
	if b.Content != "b-content" || b.Version != 1 {
		t.Fatalf("project b leaked or wrong version: %#v", b)
	}
}
