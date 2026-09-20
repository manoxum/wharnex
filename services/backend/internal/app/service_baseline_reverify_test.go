package app

import (
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestMaterializeLegacyCandidateAppliesChangeSetAtItsBase(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "file.txt")
	if err := os.WriteFile(path, []byte("base\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	calledPatchReplay := false
	err := materializeLegacyCandidate(root, domain.PendingHostChange{ChangeSet: &domain.ChangeSet{
		ID: "legacy-set",
		Mutations: []domain.FileMutation{{
			Path: "file.txt", BaseExists: true, BaseContent: "base\n", BaseMode: 0o600,
			ResultExists: true, ResultContent: "candidate\n", ResultMode: 0o600,
		}},
	}}, func() error {
		calledPatchReplay = true
		return nil
	})
	if err != nil {
		t.Fatalf("materialize legacy ChangeSet: %v", err)
	}
	if calledPatchReplay {
		t.Fatal("ChangeSet promotion delegated to raw-patch replay")
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "candidate\n" {
		t.Fatalf("ChangeSet was not materialized: %q", contents)
	}
}
