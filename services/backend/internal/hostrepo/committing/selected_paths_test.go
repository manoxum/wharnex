package committing_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/hostrepo"
)

func TestCommitPathsWithStagedDeletionOrRename(t *testing.T) {
	const oldPath = "services/desktop/agent/automation/artifact-workers/ui-test-capacity.mjs"
	const newPath = "services/desktop/agent/automation/ui-testing/capacity.mjs"
	for _, test := range []struct {
		name     string
		rename   bool
		staged   bool
		internal bool
	}{
		{name: "staged deletion", staged: true},
		{name: "staged rename", rename: true, staged: true},
		{name: "unstaged deletion"},
		{name: "unstaged rename", rename: true},
		{name: "internal staged deletion", staged: true, internal: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := newRepo(t, oldPath, "capacity\n")
			selected := []string{oldPath}
			if test.rename {
				write(t, root, newPath, "capacity\n")
				selected = append(selected, newPath)
			}
			if err := os.Remove(filepath.Join(root, oldPath)); err != nil {
				t.Fatal(err)
			}
			if test.staged {
				git(t, root, "add", "--all")
			}
			write(t, root, "unrelated.txt", "leave staged\n")
			git(t, root, "add", "--", "unrelated.txt")
			state, err := hostrepo.Working(context.Background(), root)
			if err != nil || state.Statuses[oldPath] != "deleted" {
				t.Fatalf("deleted path must remain selectable: %+v, %v", state, err)
			}
			commit := hostrepo.CommitPaths
			if test.internal {
				commit = hostrepo.CommitInternalPaths
			}
			sha, err := commit(context.Background(), root, "fix: update capacity", selected)
			if err != nil {
				t.Fatalf("commit selectable %s: %v", test.name, err)
			}
			files := git(t, root, "show", "--format=", "--name-only", "--no-renames", sha)
			if !strings.Contains(files, oldPath) || (test.rename && !strings.Contains(files, newPath)) || strings.Contains(files, "unrelated.txt") {
				t.Fatalf("commit must contain exactly the selected change: %q", files)
			}
			if staged := git(t, root, "diff", "--cached", "--name-only"); staged != "unrelated.txt" {
				t.Fatalf("unrelated staged work must survive: %q", staged)
			}
		})
	}
}
