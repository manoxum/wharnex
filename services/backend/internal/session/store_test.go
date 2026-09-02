package session

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestStoreDeleteRemovesOnlyRequestedSession(t *testing.T) {
	store := NewStore()
	store.Put(domain.Session{ID: "a"})
	store.Put(domain.Session{ID: "b"})
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
