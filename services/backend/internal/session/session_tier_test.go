package session

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestDisabledSessionTierKeepsEverySessionWhole(t *testing.T) {
	store := NewStore()
	if err := store.Put(heavySession("ses_mem")); err != nil {
		t.Fatal(err)
	}
	if got := store.List()[0]; len(got.Context.Manifest.Files) != 1 {
		t.Fatalf("memory-only store must not slim sessions: %#v", got.Context.Manifest)
	}
}

func TestPostgresStoreKeepsColdSessionsSlimAndHydratesOnDemand(t *testing.T) {
	store := tieredTestStore(t)
	for _, id := range []string{"ses_a", "ses_b", "ses_c"} {
		if err := store.Put(heavySession(id)); err != nil {
			t.Fatal(err)
		}
	}
	store.mu.Lock()
	store.tier.maxItems = 1
	store.keepWholeLocked(store.items["ses_c"], 1)
	store.mu.Unlock()

	for _, item := range store.List() {
		if item.ID != "ses_c" && (item.Context.Manifest.Files != nil || item.RequestKnowledge != nil || item.BaselineFileSnapshots != nil) {
			t.Fatalf("cold session %s must be resident only as a slim view", item.ID)
		}
		if item.Context.Manifest.SHA256 != "sha-"+item.ID {
			t.Fatalf("slim view must keep light fields, got %q", item.Context.Manifest.SHA256)
		}
	}
	full, err := store.Get("ses_a")
	if err != nil {
		t.Fatal(err)
	}
	assertHeavy(t, full)

	if _, err := store.Update("ses_b", func(item *domain.Session) error {
		item.State = "applied"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewPostgresStore(context.Background(), store.testURL, "")
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.Get("ses_b")
	if err != nil {
		t.Fatal(err)
	}
	if persisted.State != "applied" {
		t.Fatalf("update was not persisted: %q", persisted.State)
	}
	assertHeavy(t, persisted)
}

func heavySession(id string) domain.Session {
	item := domain.Session{ID: id, ProjectPath: "/tmp/" + id, State: "ready", CreatedAt: time.Now().UTC()}
	item.Context.Manifest = domain.ContextManifest{SHA256: "sha-" + id, Files: []domain.ContextFile{{Path: "main.go"}}}
	item.RequestKnowledge = map[string]domain.RequestKnowledgeSnapshot{"req_1": {}}
	item.BaselineFileSnapshots = map[string]map[string]string{"sha": {"main.go": "h"}}
	return item
}

func assertHeavy(t *testing.T, item domain.Session) {
	t.Helper()
	if len(item.Context.Manifest.Files) != 1 || len(item.RequestKnowledge) != 1 || len(item.BaselineFileSnapshots) != 1 {
		t.Fatalf("session %s lost heavy fields: files=%d knowledge=%d snapshots=%d", item.ID, len(item.Context.Manifest.Files), len(item.RequestKnowledge), len(item.BaselineFileSnapshots))
	}
}

type tieredStore struct {
	*Store
	testURL string
}

func tieredTestStore(t *testing.T) tieredStore {
	t.Helper()
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("session_tier_test_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`); admin.Close() })
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
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
	t.Cleanup(func() { store.Close() })
	return tieredStore{Store: store, testURL: testURL.String()}
}
