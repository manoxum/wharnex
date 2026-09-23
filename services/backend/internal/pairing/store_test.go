package pairing

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPairingCodeIsOneTimeAndSessionPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pairing.json")
	store := NewStore(path)
	code, _, err := store.Begin()
	if err != nil {
		t.Fatal(err)
	}
	token, err := store.Claim(code)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Claim(code); err == nil {
		t.Fatal("pairing code was reusable")
	}
	if !store.Authenticate(token) {
		t.Fatal("new session was not authenticated")
	}
	if !NewStore(path).Authenticate(token) {
		t.Fatal("session did not persist")
	}
	if err := store.Revoke(token); err != nil {
		t.Fatal(err)
	}
	if store.Authenticate(token) {
		t.Fatal("revoked session remained valid")
	}
}

func TestPairingSessionExpiresServerSide(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "pairing.json"))
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	code, _, err := store.Begin()
	if err != nil {
		t.Fatal(err)
	}
	token, err := store.Claim(code)
	if err != nil {
		t.Fatal(err)
	}
	store.now = func() time.Time { return now.Add(sessionLifetime + time.Second) }
	if store.Authenticate(token) {
		t.Fatal("expired pairing session remained authenticated")
	}
}

func TestExpiredPairingCodeIsRejected(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "pairing.json"))
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	code, _, err := store.Begin()
	if err != nil {
		t.Fatal(err)
	}
	store.now = func() time.Time { return now.Add(pendingLifetime + time.Second) }
	if _, err := store.Claim(code); err == nil {
		t.Fatal("expired pairing code was accepted")
	}
}
