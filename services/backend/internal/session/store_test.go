package session

import (
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestStoreDeleteRemovesOnlyRequestedSession(t *testing.T) {
	store := NewStore()
	if err := store.Put(domain.Session{ID: "a"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(domain.Session{ID: "b"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete("a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("a"); err != ErrNotFound {
		t.Fatalf("expected a to be deleted, got %v", err)
	}
	if _, err := store.Get("b"); err != nil {
		t.Fatalf("b should remain: %v", err)
	}
	if err := store.Delete("missing"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestPersistentStoreRestoresPlanAndPendingRequest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	store, err := NewPersistentStore(path)
	if err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "plan_1", RequestID: "req_1", Status: "ready", Summary: "persist me", Risk: "low"}
	item := domain.Session{ID: "ses_1", ProjectPath: "/tmp/project", ExecutionMode: domain.ExecutionModeProtected, State: "planned", Plan: &plan, LastRequestID: "req_2", PendingManualRequestIDs: []string{"req_2"}, LastManualPrompt: "prompt"}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}

	reloaded, err := NewPersistentStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := reloaded.Get("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Plan == nil || got.Plan.PlanID != "plan_1" {
		t.Fatalf("plan not restored: %#v", got.Plan)
	}
	if got.LastRequestID != "req_2" || len(got.PendingManualRequestIDs) != 1 || got.PendingManualRequestIDs[0] != "req_2" {
		t.Fatalf("request state not restored: %#v", got)
	}
	if got.LastManualPrompt != "prompt" {
		t.Fatalf("manual prompt not restored: %q", got.LastManualPrompt)
	}
}

func TestPersistentStoreDefaultsAutomationModeForLegacyState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	legacy := `{"version":1,"sessions":[{"id":"ses_legacy","project_path":"/tmp/project","execution_mode":"protected","state":"ready","created_at":"2026-09-03T00:00:00Z","context":{"id":"","manifest":{"id":"","project_root":"/tmp/project","sha256":"","files":[],"excluded":[],"text_truncated":false}}}]}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewPersistentStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.Get("ses_legacy")
	if err != nil {
		t.Fatal(err)
	}
	if got.AutomationMode != domain.AutomationModeManual {
		t.Fatalf("expected manual default, got %q", got.AutomationMode)
	}
}
