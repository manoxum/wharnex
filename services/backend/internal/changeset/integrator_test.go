package changeset

import (
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPrepareMergesIndependentHunksInSameFile(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "file.txt", "ONE\nmiddle\nthree\n")
	set := domain.ChangeSet{ID: "cs-1", Mutations: []domain.FileMutation{{
		Path: "file.txt", BaseExists: true, ResultExists: true,
		BaseContent: "one\nmiddle\nthree\n", ResultContent: "one\nmiddle\nTHREE\n",
	}}}

	prepared, err := Prepare(root, []domain.ChangeSet{set})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Outcome != domain.IntegrationReady || len(prepared.Writes) != 1 {
		t.Fatalf("unexpected prepared integration: %#v", prepared)
	}
	if got := string(prepared.Writes[0].Content); got != "ONE\nmiddle\nTHREE\n" {
		t.Fatalf("merged content=%q", got)
	}
}

func TestPrepareReportsOneFocusedConflict(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "file.txt", "host\n")
	set := domain.ChangeSet{ID: "cs-1", Mutations: []domain.FileMutation{{
		Path: "file.txt", BaseExists: true, ResultExists: true,
		BaseContent: "base\n", ResultContent: "task\n",
	}}}

	prepared, err := Prepare(root, []domain.ChangeSet{set})
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Outcome != domain.IntegrationConflict || len(prepared.Conflicts) != 1 || prepared.Conflicts[0].Path != "file.txt" {
		t.Fatalf("expected focused conflict, got %#v", prepared)
	}
}

func TestCommitRejectsExternalRaceWithoutOverwriting(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "file.txt", "current\n")
	prepared, err := Prepare(root, []domain.ChangeSet{{ID: "cs-1", Mutations: []domain.FileMutation{{
		Path: "file.txt", BaseExists: true, ResultExists: true,
		BaseContent: "current\n", ResultContent: "task\n",
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, root, "file.txt", "external\n")
	journal, err := Commit(root, prepared)
	if err == nil || journal.Outcome != domain.IntegrationRetryableRace {
		t.Fatalf("expected retryable race, journal=%#v err=%v", journal, err)
	}
	data, readErr := os.ReadFile(filepath.Join(root, "file.txt"))
	if readErr != nil || string(data) != "external\n" {
		t.Fatalf("external value was overwritten: %q err=%v", data, readErr)
	}
}

func TestCommitRejectsExternalModeRace(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "script.sh", "old\n")
	prepared, err := Prepare(root, []domain.ChangeSet{{ID: "cs-mode", Mutations: []domain.FileMutation{{
		Path: "script.sh", BaseExists: true, ResultExists: true,
		BaseContent: "old\n", ResultContent: "new\n", BaseMode: 0o600, ResultMode: 0o600,
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(root, "script.sh"), 0o700); err != nil {
		t.Fatal(err)
	}
	journal, err := Commit(root, prepared)
	if err == nil || journal.Outcome != domain.IntegrationRetryableRace {
		t.Fatalf("expected mode-only CAS race, journal=%#v err=%v", journal, err)
	}
	info, statErr := os.Stat(filepath.Join(root, "script.sh"))
	if statErr != nil {
		t.Fatal(statErr)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("external mode was overwritten: mode=%v", info.Mode().Perm())
	}
}

func TestMaterializeCapturesCreateModifyAndDelete(t *testing.T) {
	base := t.TempDir()
	result := t.TempDir()
	writeTestFile(t, base, "modify.txt", "old\n")
	writeTestFile(t, result, "modify.txt", "new\n")
	writeTestFile(t, base, "delete.txt", "gone\n")
	writeTestFile(t, result, "create.txt", "made\n")

	set, err := Materialize("cs-1", "base-1", base, result, []string{"modify.txt", "delete.txt", "create.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if len(set.Mutations) != 3 {
		t.Fatalf("mutations=%#v", set.Mutations)
	}
}

func TestPrepareClassifiesChangedReadAndBarrierDependencies(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "read.txt", "new read\n")
	writeTestFile(t, root, "go.mod", "module new\n")
	set := domain.ChangeSet{
		ID: "cs-deps", ReadHashes: map[string]string{"read.txt": hashText("old read\n")},
		BarrierHashes: map[string]string{"go.mod": hashText("module old\n")},
	}
	prepared, err := Prepare(root, []domain.ChangeSet{set})
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.SemanticFiles) != 1 || prepared.SemanticFiles[0] != "read.txt" {
		t.Fatalf("semantic files=%v", prepared.SemanticFiles)
	}
	if len(prepared.BarrierFiles) != 1 || prepared.BarrierFiles[0] != "go.mod" {
		t.Fatalf("barrier files=%v", prepared.BarrierFiles)
	}
}

func TestPrepareIntegratesFourDisjointCandidatesFromOneRevision(t *testing.T) {
	root := t.TempDir()
	sets := make([]domain.ChangeSet, 0, 4)
	for index, name := range []string{"a.txt", "b.txt", "c.txt", "d.txt"} {
		writeTestFile(t, root, name, "base\n")
		sets = append(sets, domain.ChangeSet{ID: name, BaseRevision: "same-base", Mutations: []domain.FileMutation{{
			Path: name, BaseExists: true, ResultExists: true, BaseContent: "base\n", ResultContent: string(rune('A'+index)) + "\n", BaseMode: 0o600, ResultMode: 0o600,
		}}})
	}
	prepared, err := Prepare(root, sets)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Outcome != domain.IntegrationReady || len(prepared.Writes) != 4 {
		t.Fatalf("four disjoint candidates did not integrate: %#v", prepared)
	}
}

func TestRollbackRefusesToOverwriteExternalValue(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "file.txt", "external-after-commit\n")
	journal := Journal{Outcome: domain.IntegrationIntegrated, entries: []journalEntry{{
		write:    Write{Path: "file.txt", ResultExists: true, Content: []byte("wharness\n"), Mode: 0o600},
		previous: fileValue{exists: true, data: []byte("before\n"), mode: 0o600},
	}}}
	if err := journal.Rollback(root); err == nil {
		t.Fatal("rollback unexpectedly overwrote an external value")
	}
	data, err := os.ReadFile(filepath.Join(root, "file.txt"))
	if err != nil || string(data) != "external-after-commit\n" {
		t.Fatalf("external value changed during refused rollback: %q err=%v", data, err)
	}
}

func hashText(value string) string {
	return hashValue(fileValue{exists: true, data: []byte(value), mode: 0o600})
}

func writeTestFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
