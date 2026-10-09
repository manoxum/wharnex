package gitlive

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func git(t *testing.T, root string, args ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", root}, args...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
}

func TestSnapshotChangesForExternalGitAndWorktreeMutations(t *testing.T) {
	root := t.TempDir()
	git(t, root, "init", "-q", "-b", "main")
	git(t, root, "config", "user.name", "Tester")
	git(t, root, "config", "user.email", "test@example.invalid")
	file := filepath.Join(root, "file.txt")
	if err := os.WriteFile(file, []byte("first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, root, "add", "file.txt")
	git(t, root, "commit", "-qm", "initial")
	read := func() map[string][32]byte {
		snapshot, err := Snapshot(context.Background(), root)
		if err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	initial := read()
	if changed := Changed(initial, read()); len(changed) != 0 {
		t.Fatalf("unchanged = %v", changed)
	}
	if err := os.WriteFile(file, []byte("second\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	dirty := read()
	if changed := Changed(initial, dirty); len(changed) != 1 || changed[0] != "" {
		t.Fatalf("worktree change = %v", changed)
	}
	if err := os.WriteFile(file, []byte("third\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	modifiedAgain := read()
	if changed := Changed(dirty, modifiedAgain); len(changed) != 1 || changed[0] != "" {
		t.Fatalf("second edit = %v", changed)
	}
	git(t, root, "add", "file.txt")
	staged := read()
	if changed := Changed(modifiedAgain, staged); len(changed) != 1 || changed[0] != "" {
		t.Fatalf("staged change = %v", changed)
	}
	git(t, root, "commit", "-qm", "second")
	committed := read()
	if changed := Changed(staged, committed); len(changed) != 1 || changed[0] != "" {
		t.Fatalf("commit change = %v", changed)
	}
	git(t, root, "switch", "-qc", "feature")
	if changed := Changed(committed, read()); len(changed) != 1 || changed[0] != "" {
		t.Fatalf("branch change = %v", changed)
	}
}
