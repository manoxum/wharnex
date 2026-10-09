package repositorytree_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/sandbox"
)

func git(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root, "-c", "user.name=Wharnex Test", "-c", "user.email=test@example.invalid", "-c", "protocol.file.allow=always"}, args...)...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func candidate(t *testing.T) (string, string, []domain.RepositoryIntegration) {
	t.Helper()
	root, source := t.TempDir(), t.TempDir()
	for _, path := range []string{root, source} {
		git(t, path, "init", "-q", "-b", "main")
		write(t, filepath.Join(path, "file.txt"), "before\n")
		git(t, path, "add", "file.txt")
		git(t, path, "commit", "-qm", "initial")
	}
	for _, name := range []string{"services/admin", "services/backend"} {
		git(t, root, "submodule", "add", "-q", source, name)
	}
	git(t, root, "commit", "-qm", "register repositories")
	runner := sandbox.NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runner.Cleanup(workspace) })
	for _, name := range []string{"services/admin", "services/backend"} {
		write(t, filepath.Join(workspace.Path, name, "file.txt"), "corrected\n")
	}
	branch := "whx/req-owned-completion"
	_, integrations, err := sandbox.CommitVerifiedRepositoryTree(context.Background(), workspace.Path, root, branch,
		"fix(visits): exclude deleted visits", []string{"services/admin/file.txt", "services/backend/file.txt"}, false)
	if err != nil {
		t.Fatal(err)
	}
	return root, branch, integrations
}

func TestOwnedCheckoutFailureBlocksAndRollsBackBeforeRetry(t *testing.T) {
	root, branch, integrations := candidate(t)
	before := git(t, root, "rev-parse", "HEAD")
	lock := filepath.Join(git(t, filepath.Join(root, "services", "backend"), "rev-parse", "--absolute-git-dir"), "index.lock")
	write(t, lock, "active lock; never eligible for cleanup\n")
	_, err := sandbox.MergeRepositoryTreeOnHost(context.Background(), root, branch, "", integrations)
	var blocked *hostrepo.BlockedError
	if err == nil || !errors.As(err, &blocked) {
		t.Fatalf("stale owned backend must block integration, got %v", err)
	}
	if got := git(t, root, "rev-parse", "HEAD"); got != before {
		t.Fatalf("partial superproject merge remains: %s, want %s", got, before)
	}
	for _, unit := range integrations {
		repository := filepath.Join(root, unit.Path)
		if got := git(t, repository, "rev-parse", "HEAD"); got != unit.BaseCommit {
			t.Fatalf("%s was not restored: %s", unit.Path, got)
		}
		if got := git(t, repository, "rev-parse", branch); got != unit.Commit {
			t.Fatalf("verified candidate %s was lost", unit.Path)
		}
		if got := git(t, repository, "branch", "--show-current"); got != unit.TargetBranch {
			t.Fatalf("rollback changed %s branch to %s", unit.Path, got)
		}
		if data, err := os.ReadFile(filepath.Join(repository, "file.txt")); err != nil || string(data) != "before\n" {
			t.Fatalf("rollback left %s content changed: %q, %v", unit.Path, data, err)
		}
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if _, err := sandbox.MergeRepositoryTreeOnHost(context.Background(), root, branch, "", integrations); err != nil {
		t.Fatalf("same authorized candidate must remain retryable: %v", err)
	}
	for _, unit := range integrations {
		if got := git(t, filepath.Join(root, unit.Path), "rev-parse", "HEAD"); got != unit.Commit {
			t.Fatalf("retry left %s stale", unit.Path)
		}
		if data, err := os.ReadFile(filepath.Join(root, unit.Path, "file.txt")); err != nil || string(data) != "corrected\n" {
			t.Fatalf("retry did not install %s content: %q, %v", unit.Path, data, err)
		}
	}
}

func TestOwnedCheckoutRetriesTransientIndexLock(t *testing.T) {
	root, branch, integrations := candidate(t)
	lock := filepath.Join(git(t, filepath.Join(root, "services", "backend"), "rev-parse", "--absolute-git-dir"), "index.lock")
	write(t, lock, "active lock\n")
	timer := time.AfterFunc(150*time.Millisecond, func() { _ = os.Remove(lock) })
	defer timer.Stop()
	merged, err := sandbox.MergeRepositoryTreeOnHost(context.Background(), root, branch, "", integrations)
	if err != nil || len(merged.SubmoduleSync.Skipped) != 0 {
		t.Fatalf("transient contention must settle locally: %+v %v", merged.SubmoduleSync, err)
	}
	for _, unit := range integrations {
		if got := git(t, filepath.Join(root, unit.Path), "rev-parse", "HEAD"); got != unit.Commit {
			t.Fatalf("successful integration left %s at %s", unit.Path, got)
		}
	}
}
