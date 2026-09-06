package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestPostgresStoreMigratesLegacySnapshotIntoIndependentRecords(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("session_test_%d", time.Now().UnixNano())
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

	legacyPath := filepath.Join(t.TempDir(), "sessions.json")
	first := domain.Session{ID: "ses_one", ProjectPath: "/tmp/one", State: "ready", CreatedAt: time.Unix(1, 0).UTC()}
	second := domain.Session{ID: "ses_two", ProjectPath: "/tmp/two", State: "planned", CreatedAt: time.Unix(2, 0).UTC()}
	raw, err := json.MarshalIndent(persistenceEnvelope{Version: persistenceVersion, Sessions: []persistedSession{persistSession(first), persistSession(second)}}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewPostgresStore(context.Background(), testURL.String(), legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.List(); len(got) != 2 || got[0].ID != first.ID || got[1].ID != second.ID {
		t.Fatalf("unexpected migrated sessions: %#v", got)
	}
	if _, err := store.Update(first.ID, func(item *domain.Session) error {
		item.State = "applied"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewPostgresStore(context.Background(), testURL.String(), legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	got, err := reopened.Get(first.ID)
	if err != nil || got.State != "applied" {
		t.Fatalf("database record was overwritten by repeated legacy migration: item=%#v err=%v", got, err)
	}
	var records int
	if err := admin.QueryRow(`SELECT count(*) FROM ` + schema + `.harness_sessions`).Scan(&records); err != nil {
		t.Fatal(err)
	}
	if records != 2 {
		t.Fatalf("session record count = %d, want 2", records)
	}
	after, err := os.ReadFile(legacyPath)
	if err != nil || string(after) != string(raw) {
		t.Fatal("legacy snapshot was modified during migration")
	}
}
