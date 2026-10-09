package commitrecovery_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/sandbox"
)

func TestProtectedMergeRecoversOldLockWithoutLosingDirtyWork(t *testing.T) {
	root := repository(t)
	git(t, root, "checkout", "-qb", "candidate")
	write(t, filepath.Join(root, "file.txt"), "verified candidate\n")
	git(t, root, "add", "file.txt")
	git(t, root, "commit", "-qm", "fix: verified change")
	git(t, root, "checkout", "-q", "main")
	write(t, filepath.Join(root, "unrelated.txt"), "operator work\n")
	lock := filepath.Join(root, ".git", "index.lock")
	write(t, lock, "")
	old := time.Now().Add(-24 * time.Hour)
	if err := os.Chtimes(lock, old, old); err != nil {
		t.Fatal(err)
	}
	bridge(t, root, lock)
	merged, err := sandbox.MergeBranchOnHost(context.Background(), root, "candidate")
	if err != nil {
		t.Fatalf("protected merge must resume: %v", err)
	}
	if !merged.Preservation.Committed {
		t.Fatal("dirty operator work was not preserved")
	}
	if got := git(t, root, "show", "HEAD:file.txt"); got != "verified candidate" {
		t.Fatalf("%q", got)
	}
	if got := git(t, root, "show", "HEAD:unrelated.txt"); got != "operator work" {
		t.Fatalf("%q", got)
	}
	if got := git(t, root, "rev-list", "--parents", "-1", "HEAD"); len(strings.Fields(got)) != 3 {
		t.Fatalf("expected two-parent merge: %s", got)
	}
}
