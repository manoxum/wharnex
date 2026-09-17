package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestRequestGitContextCarriesFilteredWorktreeAndUnpushedCommitDiffs(t *testing.T) {
	root := t.TempDir()
	gitTestCommand(t, root, "init", "-b", "main")
	gitTestCommand(t, root, "config", "user.name", "Wharnex Test")
	gitTestCommand(t, root, "config", "user.email", "wharnex@example.invalid")
	writeGitTestFile(t, root, "allowed.txt", "base\n")
	writeGitTestFile(t, root, "secret.env", "BASE_SECRET\n")
	gitTestCommand(t, root, "add", "allowed.txt", "secret.env")
	gitTestCommand(t, root, "commit", "-m", "chore: base")

	remote := filepath.Join(t.TempDir(), "remote.git")
	gitTestCommand(t, "", "init", "--bare", "-b", "main", remote)
	gitTestCommand(t, root, "remote", "add", "origin", remote)
	gitTestCommand(t, root, "push", "-u", "origin", "main")

	writeGitTestFile(t, root, "allowed.txt", "committed local\n")
	writeGitTestFile(t, root, "secret.env", "COMMIT_SECRET\n")
	gitTestCommand(t, root, "add", "allowed.txt", "secret.env")
	gitTestCommand(t, root, "commit", "-m", "feat: local request context")
	writeGitTestFile(t, root, "allowed.txt", "committed local\nuncommitted local\n")
	writeGitTestFile(t, root, "secret.env", "WORKTREE_SECRET\n")
	writeGitTestFile(t, root, "not-in-context.txt", "UNTRACKED_SECRET\n")

	companion := t.TempDir()
	gitTestCommand(t, companion, "init", "-b", "feature/local")
	gitTestCommand(t, companion, "config", "user.name", "Wharnex Test")
	gitTestCommand(t, companion, "config", "user.email", "wharnex@example.invalid")
	writeGitTestFile(t, companion, "companion.txt", "related base\n")
	writeGitTestFile(t, companion, "companion.secret", "RELATED_BASE_SECRET\n")
	gitTestCommand(t, companion, "add", "companion.txt", "companion.secret")
	gitTestCommand(t, companion, "commit", "-m", "chore: related base")
	writeGitTestFile(t, companion, "companion.txt", "related base\nrelated uncommitted\n")
	writeGitTestFile(t, companion, "companion.secret", "RELATED_WORKTREE_SECRET\n")

	item := domain.Session{ProjectPath: root, Context: domain.ContextBundle{
		Manifest: domain.ContextManifest{Files: []domain.ContextFile{{Path: "allowed.txt"}}},
		RelatedProjects: []domain.RelatedProjectContext{{
			ProjectPath: companion, Name: "companion", Prefix: "RELATED_PROJECTS/01-companion/",
			Manifest: domain.ContextManifest{Files: []domain.ContextFile{{Path: "companion.txt"}}},
		}},
	}}
	snapshot := requestGitContextForItem(context.Background(), item)
	if snapshot.State != "present" || snapshot.Ref != "main" || snapshot.Upstream != "origin/main" || snapshot.Ahead != 1 {
		t.Fatalf("unexpected Git context identity: %#v", snapshot)
	}
	if len(snapshot.Files) < 5 {
		t.Fatalf("expected index, worktree state/diff and commit metadata/diff, got %d files", len(snapshot.Files))
	}
	joined := strings.Builder{}
	for _, file := range snapshot.Files {
		joined.WriteString(file.Path)
		joined.WriteByte('\n')
		joined.WriteString(file.Content)
		joined.WriteByte('\n')
	}
	body := joined.String()
	for _, forbidden := range []string{"COMMIT_SECRET", "WORKTREE_SECRET", "UNTRACKED_SECRET", "not-in-context.txt", "RELATED_BASE_SECRET", "RELATED_WORKTREE_SECRET", "companion.secret"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("Git context leaked excluded material %q", forbidden)
		}
	}
	for _, required := range []string{"git-context/index.json", "git-context/main/uncommited/diff", "git-context/main/uncommited/state.json", "git-context/related-01-companion/uncommited/diff", "committed local", "uncommitted local", "related uncommitted", "feat: local request context"} {
		if !strings.Contains(body, required) {
			t.Fatalf("Git context is missing %q", required)
		}
	}
}

func gitTestCommand(t *testing.T, dir string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	if dir != "" {
		command.Dir = dir
	}
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
}

func writeGitTestFile(t *testing.T, root, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
