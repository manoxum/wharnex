package pendingcommit

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	return NewStore(filepath.Join(t.TempDir(), "git-pending-commits.json"))
}

func record(id, project, message string, paths ...string) Record {
	return Record{ID: id, ProjectPath: project, Message: message, Paths: paths, CreatedAt: time.Now().UTC()}
}

func TestStoreRoundTripsRecordsPerProject(t *testing.T) {
	store := newStore(t)
	if err := store.Append(record("p1", "/w/alpha", "feat: one\n\nBody.", "a.go")); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(record("p2", "/w/alpha", "fix: two", "b.go")); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(record("p3", "/w/beta", "feat: other project", "c.go")); err != nil {
		t.Fatal(err)
	}

	alpha, err := store.List("/w/alpha")
	if err != nil {
		t.Fatal(err)
	}
	if len(alpha) != 2 || alpha[0].ID != "p1" || alpha[1].ID != "p2" {
		t.Fatalf("expected queue order preserved, got %+v", alpha)
	}
	if alpha[0].Subject != "feat: one" {
		t.Fatalf("the subject must be derived from the message, got %q", alpha[0].Subject)
	}
	beta, err := store.List("/w/beta")
	if err != nil || len(beta) != 1 {
		t.Fatalf("projects must not leak into each other, got %+v err=%v", beta, err)
	}
	// A path spelled differently must resolve to the same queue.
	same, err := store.List("/w/alpha/")
	if err != nil || len(same) != 2 {
		t.Fatalf("expected path normalization, got %+v err=%v", same, err)
	}
}

func TestStoreRemovesSelectedRecords(t *testing.T) {
	store := newStore(t)
	for _, id := range []string{"p1", "p2", "p3"} {
		if err := store.Append(record(id, "/w/alpha", "feat: "+id, id+".go")); err != nil {
			t.Fatal(err)
		}
	}
	removed, err := store.Remove("/w/alpha", []string{"p2", "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("expected exactly one removal, got %d", removed)
	}
	remaining, _ := store.List("/w/alpha")
	if len(remaining) != 2 || remaining[0].ID != "p1" || remaining[1].ID != "p3" {
		t.Fatalf("expected p1 and p3 left in order, got %+v", remaining)
	}
}

func TestStoreTruncatesAnOversizedDiff(t *testing.T) {
	store := newStore(t)
	entry := record("p1", "/w/alpha", "feat: huge", "a.go")
	entry.Diff = strings.Repeat("x", MaxDiffBytes+500)
	if err := store.Append(entry); err != nil {
		t.Fatal(err)
	}
	stored, _ := store.List("/w/alpha")
	if len(stored[0].Diff) != MaxDiffBytes || !stored[0].DiffTruncated {
		t.Fatalf("expected the diff bounded and flagged, got %d truncated=%v", len(stored[0].Diff), stored[0].DiffTruncated)
	}
}

func TestStoreBoundsQueueLength(t *testing.T) {
	store := newStore(t)
	for index := 0; index < MaxRecordsPerProject+5; index++ {
		if err := store.Append(record(string(rune('a'+index%26))+string(rune('0'+index/26)), "/w/alpha", "feat: x", "a.go")); err != nil {
			t.Fatal(err)
		}
	}
	stored, _ := store.List("/w/alpha")
	if len(stored) != MaxRecordsPerProject {
		t.Fatalf("expected the queue bounded to %d, got %d", MaxRecordsPerProject, len(stored))
	}
}

// Committing a path takes its current working-tree content, which already
// contains every earlier change to that path. Committing a later record alone
// would silently fold an earlier one into it under the wrong message.
func TestBlockingPredecessorsNamesEarlierRecordsSharingAPath(t *testing.T) {
	first := record("p1", "/w/alpha", "feat: first", "shared.go")
	first.CreatedAt = time.Unix(100, 0).UTC()
	second := record("p2", "/w/alpha", "feat: unrelated", "other.go")
	second.CreatedAt = time.Unix(200, 0).UTC()
	third := record("p3", "/w/alpha", "fix: third", "shared.go")
	third.CreatedAt = time.Unix(300, 0).UTC()
	records := []Record{first, second, third}

	blockers := BlockingPredecessors(records, map[string]bool{"p3": true})
	if len(blockers) != 1 || blockers[0].ID != "p1" {
		t.Fatalf("expected p1 to block p3, got %+v", blockers)
	}
	// Selecting both is fine: the earlier one is included.
	if blockers := BlockingPredecessors(records, map[string]bool{"p1": true, "p3": true}); len(blockers) != 0 {
		t.Fatalf("expected no blockers when the predecessor is selected, got %+v", blockers)
	}
	// A record touching different paths never blocks.
	if blockers := BlockingPredecessors(records, map[string]bool{"p2": true}); len(blockers) != 0 {
		t.Fatalf("a disjoint record must be committable alone, got %+v", blockers)
	}
	// An earlier record is never blocked by a later one.
	if blockers := BlockingPredecessors(records, map[string]bool{"p1": true}); len(blockers) != 0 {
		t.Fatalf("expected no blockers for the oldest record, got %+v", blockers)
	}
}

func TestSelectReportsMissingIDs(t *testing.T) {
	records := []Record{record("p1", "/w/a", "feat: one", "a.go"), record("p2", "/w/a", "feat: two", "b.go")}
	matched, missing := Select(records, []string{"p2", "nope"})
	if len(matched) != 1 || matched[0].ID != "p2" {
		t.Fatalf("expected p2 matched, got %+v", matched)
	}
	if len(missing) != 1 || missing[0] != "nope" {
		t.Fatalf("expected the unknown id reported, got %+v", missing)
	}
}

func TestListOnAMissingFileIsEmptyNotAnError(t *testing.T) {
	store := newStore(t)
	records, err := store.List("/w/alpha")
	if err != nil || len(records) != 0 {
		t.Fatalf("a store with no file yet is empty, got %+v err=%v", records, err)
	}
}
