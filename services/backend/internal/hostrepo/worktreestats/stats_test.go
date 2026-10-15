package worktreestats_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/hostrepo"
)

func TestWorktreeStatsCountsNewFileLines(t *testing.T) {
	root := t.TempDir()
	git(t, root, "init", "-q")
	write(t, root, "tracked.txt", "before\n")
	git(t, root, "add", ".")
	git(t, root, "commit", "-qm", "initial")
	write(t, root, "tracked.txt", "after\nextra\n")
	write(t, root, "new.txt", "one\ntwo\nthree\n")

	stats := hostrepo.WorktreeStats(context.Background(), root)
	for path, want := range map[string]hostrepo.DiffStat{
		"tracked.txt": {Additions: 2, Deletions: 1},
		"new.txt":     {Additions: 3},
	} {
		if got := stats[path]; got != want {
			t.Errorf("%s: got %+v, want %+v", path, got, want)
		}
	}
}

func TestWorktreeStatsPreservesExactPaths(t *testing.T) {
	for _, path := range []string{"ação.txt", "with space.txt", " spaced.txt ", "tab\tname.txt", "line\nbreak.txt", "quote\".txt", "literal => path.txt"} {
		t.Run(path, func(t *testing.T) {
			root := t.TempDir()
			git(t, root, "init", "-q")
			write(t, root, "base.txt", "base\n")
			git(t, root, "add", ".")
			git(t, root, "commit", "-qm", "initial")
			write(t, root, path, "one\ntwo")
			assertStat(t, root, path, hostrepo.DiffStat{Additions: 2})
			git(t, root, "add", "--", path)
			assertStat(t, root, path, hostrepo.DiffStat{Additions: 2})
			git(t, root, "commit", "-qm", "add file")
			write(t, root, path, "replacement\n")
			assertStat(t, root, path, hostrepo.DiffStat{Additions: 1, Deletions: 2})
		})
	}
}

func TestWorktreeStatsMatchesSeparateRenameRows(t *testing.T) {
	root := t.TempDir()
	git(t, root, "init", "-q")
	git(t, root, "config", "diff.renames", "true")
	write(t, root, "old.txt", "one\ntwo\n")
	git(t, root, "add", ".")
	git(t, root, "commit", "-qm", "initial")
	git(t, root, "mv", "old.txt", "new.txt")
	assertStat(t, root, "old.txt", hostrepo.DiffStat{Deletions: 2})
	assertStat(t, root, "new.txt", hostrepo.DiffStat{Additions: 2})
}

func TestWorktreeStatsUsesNetChangesAndHandlesNonText(t *testing.T) {
	root := t.TempDir()
	git(t, root, "init", "-q")
	write(t, root, "tracked.txt", "original\n")
	git(t, root, "add", ".")
	git(t, root, "commit", "-qm", "initial")
	write(t, root, "tracked.txt", "staged\nextra\n")
	git(t, root, "add", ".")
	write(t, root, "tracked.txt", "final\n")
	write(t, root, "empty.txt", "")
	write(t, root, "binary.bin", "\x00\x01\x02")
	assertStat(t, root, "tracked.txt", hostrepo.DiffStat{Additions: 1, Deletions: 1})
	assertStat(t, root, "empty.txt", hostrepo.DiffStat{})
	assertStat(t, root, "binary.bin", hostrepo.DiffStat{})
}

func assertStat(t *testing.T, root, path string, want hostrepo.DiffStat) {
	t.Helper()
	if got := hostrepo.WorktreeStats(context.Background(), root)[path]; got != want {
		t.Errorf("%q: got %+v, want %+v", path, got, want)
	}
}

func git(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false"}, args...)...)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
}

func write(t *testing.T, root, path, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, path), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
