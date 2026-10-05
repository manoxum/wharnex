// Package sessionvault persists the browser sessions UI Lab tests leave
// behind, so a dependent test resumes from its prerequisites instead of
// re-running them. The vault stores the state already sealed by its caller;
// it never sees cookie or storage plaintext.
package sessionvault

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"
)

// ErrNotFound reports a snapshot that does not exist for the project.
var ErrNotFound = errors.New("UI test session not found")

// TTL bounds how long a captured session may be reused.
const TTL = 12 * time.Hour

// Snapshot is one persisted browser session, captured after TestID passed.
// Covers lists every test whose effects that browser state holds, and Digests
// the definition each of them had when it was captured.
type Snapshot struct {
	SID           string
	Project       string
	EnvironmentID string
	TestID        string
	ProfileID     string
	Origin        string
	Covers        []string
	Digests       map[string]string
	Sealed        string
	CapturedAt    time.Time
	ExpiresAt     time.Time
}

// Filter narrows a deletion to an environment, a profile or one test. Empty
// fields match everything within the project.
type Filter struct {
	EnvironmentID string
	ProfileID     string
	TestID        string
}

func (f Filter) matches(snapshot Snapshot) bool {
	return (f.EnvironmentID == "" || f.EnvironmentID == snapshot.EnvironmentID) &&
		(f.ProfileID == "" || f.ProfileID == snapshot.ProfileID) &&
		(f.TestID == "" || f.TestID == snapshot.TestID)
}

// Vault keeps at most one live snapshot per (project, environment, test).
type Vault interface {
	// Save replaces the snapshot for the same project, environment and test.
	// The stored row keeps its identity; only its content is replaced.
	Save(ctx context.Context, snapshot Snapshot) (Snapshot, error)
	Get(ctx context.Context, project, sid string) (Snapshot, error)
	// List returns the project's unexpired snapshots.
	List(ctx context.Context, project string, now time.Time) ([]Snapshot, error)
	Delete(ctx context.Context, project string, filter Filter) (int, error)
	// Prune deletes every expired snapshot.
	Prune(ctx context.Context, now time.Time) error
}

// NewSID returns a fresh stable snapshot identity.
func NewSID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		panic("sessionvault: system randomness unavailable")
	}
	return "uts_" + hex.EncodeToString(raw)
}
