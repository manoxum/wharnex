package changeset

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

// Commit must report WHICH path lost the compare-and-swap, structurally: the
// caller decides whether a persistent race becomes a focused conflict, and it
// cannot make that decision from an error string.
func TestCommitReportsTheRacingPathStructurally(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "raced.txt")
	if err := os.WriteFile(path, []byte("staged\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	prepared := Prepared{
		Outcome: domain.IntegrationReady,
		Writes: []Write{{
			Path: "raced.txt", ExpectedExists: true, ExpectedSHA256: "not-the-current-hash", ExpectedMode: 0o600,
			ResultExists: true, Content: []byte("result\n"), Mode: 0o600,
		}},
	}
	journal, err := Commit(root, prepared)
	if err == nil {
		t.Fatal("expected the compare-and-swap to refuse an unexpected host value")
	}
	if journal.Outcome != domain.IntegrationRetryableRace {
		t.Fatalf("expected a retryable race outcome, got %s", journal.Outcome)
	}
	var race *ExternalWriteRaceError
	if !errors.As(err, &race) {
		t.Fatalf("expected a typed race error, got %T: %v", err, err)
	}
	if race.Path != "raced.txt" {
		t.Fatalf("wrong racing path: %q", race.Path)
	}
	// The host value must be left exactly as the external writer left it.
	current, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(current) != "staged\n" {
		t.Fatalf("a refused compare-and-swap overwrote the host: %q", current)
	}
}
