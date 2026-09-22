package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

// Every prefix below names a temporary directory Wharnex creates itself and
// removes on its normal path, so one surviving past the obsolescence grace is a
// leak. Only the context and workspace prefixes were ever swept, which is why a
// long-lived checkout accumulated hundreds of request-base extractions,
// changeset snapshots and attachment stores in its private temporary root.
func TestReclaimObsoleteStorageSweepsEveryDisposableWharnexTempPrefix(t *testing.T) {
	tempRoot := t.TempDir()
	cutoff := time.Now().Add(-time.Hour)
	stale := cutoff.Add(-time.Hour)

	makeDir := func(name string, modified time.Time) string {
		t.Helper()
		dir := filepath.Join(tempRoot, name)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "payload"), []byte("leaked"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(dir, modified, modified); err != nil {
			t.Fatal(err)
		}
		return dir
	}

	obsolete := map[string]string{}
	for _, prefix := range disposableTempPrefixes {
		obsolete[prefix] = makeDir(prefix+"obsolete", stale)
	}
	// A directory still being written by an in-flight request is younger than
	// the grace, and one Wharnex does not own is never a candidate at all.
	inFlight := makeDir("wharness-task-base-inflight", time.Now())
	foreign := makeDir("some-other-tool-cache", stale)

	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})

	result, err := service.ReclaimObsoleteStorage(tempRoot, "", cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if result.TempDirectories != len(disposableTempPrefixes) {
		t.Fatalf("expected every disposable prefix to be reclaimed, got %d of %d: %#v",
			result.TempDirectories, len(disposableTempPrefixes), result)
	}
	for prefix, dir := range obsolete {
		if _, statErr := os.Stat(dir); !os.IsNotExist(statErr) {
			t.Fatalf("leaked %s directory survived reclamation: %v", prefix, statErr)
		}
	}
	for _, kept := range []string{inFlight, foreign} {
		if _, statErr := os.Stat(kept); statErr != nil {
			t.Fatalf("reclamation removed a directory it does not own or that is still in flight: %s: %v", kept, statErr)
		}
	}
}

// A session's own context directory stays protected whatever its age: request
// history is persisted state, not disposable scratch.
func TestReclaimObsoleteStorageKeepsReferencedContextWhateverItsAge(t *testing.T) {
	tempRoot := t.TempDir()
	referenced := filepath.Join(tempRoot, "wharness-context-referenced")
	if err := os.MkdirAll(referenced, 0o700); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(referenced, "context.zip")
	if err := os.WriteFile(archive, []byte("history"), 0o600); err != nil {
		t.Fatal(err)
	}
	ancient := time.Now().Add(-30 * 24 * time.Hour)
	if err := os.Chtimes(referenced, ancient, ancient); err != nil {
		t.Fatal(err)
	}

	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID:          "ses_reclaim_protection",
		ProjectPath: t.TempDir(),
		CreatedAt:   time.Now().UTC(),
		Context:     domain.ContextBundle{ZipPath: archive},
	}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})

	result, err := service.ReclaimObsoleteStorage(tempRoot, "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if result.TempDirectories != 0 {
		t.Fatalf("a referenced context directory must never be reclaimed: %#v", result)
	}
	if _, statErr := os.Stat(archive); statErr != nil {
		t.Fatalf("persisted request context was removed: %v", statErr)
	}
}
