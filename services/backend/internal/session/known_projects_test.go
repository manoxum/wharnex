package session

import (
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestProjectHistoryIncludesDesktopOpenWithoutSession(t *testing.T) {
	store := NewStore()
	seen := time.Date(2026, 9, 23, 22, 40, 0, 0, time.UTC)
	if err := store.RememberKnownProject("/work/opened-only", seen); err != nil {
		t.Fatal(err)
	}
	projects, err := store.ProjectHistory()
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].ProjectPath != "/work/opened-only" || projects[0].Open {
		t.Fatalf("unexpected project history: %#v", projects)
	}
}

func TestProjectHistoryMergesSessionAndOpenHistoryByRecency(t *testing.T) {
	store := NewStore()
	older := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	newer := older.Add(48 * time.Hour)
	if err := store.Put(domain.Session{ID: "ses-history", ProjectPath: "/work/session", State: "ready", CreatedAt: older}); err != nil {
		t.Fatal(err)
	}
	if err := store.RememberKnownProject("/work/opened", newer); err != nil {
		t.Fatal(err)
	}
	projects, err := store.ProjectHistory()
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 2 || projects[0].ProjectPath != "/work/opened" || projects[1].ProjectPath != "/work/session" || !projects[1].Open {
		t.Fatalf("unexpected merged project history: %#v", projects)
	}
}

func TestProjectHistoryPersistsWithoutPostgres(t *testing.T) {
	state := filepath.Join(t.TempDir(), "sessions.json")
	store, err := NewPersistentStore(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RememberKnownProject("/work/persisted", time.Date(2026, 9, 23, 22, 45, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewPersistentStore(state)
	if err != nil {
		t.Fatal(err)
	}
	projects, err := reloaded.ProjectHistory()
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].ProjectPath != "/work/persisted" {
		t.Fatalf("history was not persisted: %#v", projects)
	}
}
