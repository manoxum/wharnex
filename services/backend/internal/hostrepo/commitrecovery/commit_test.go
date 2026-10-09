package commitrecovery_test

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/hostrepo"
)

func git(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func repository(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	git(t, root, "init", "-q", "-b", "main")
	git(t, root, "config", "user.name", "Tester")
	git(t, root, "config", "user.email", "tester@example.invalid")
	git(t, root, "config", "commit.gpgSign", "false")
	write(t, filepath.Join(root, "file.txt"), "initial\n")
	git(t, root, "add", "file.txt")
	git(t, root, "commit", "-qm", "initial")
	return root
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCommitRecoversOldLockThroughHostBridge(t *testing.T) {
	for _, shape := range []string{"ordinary", "submodule", "worktree"} {
		t.Run(shape, func(t *testing.T) {
			root := repository(t)
			switch shape {
			case "submodule":
				parent := repository(t)
				git(t, parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", root, "child")
				root = filepath.Join(parent, "child")
			case "worktree":
				linked := filepath.Join(t.TempDir(), "linked")
				git(t, root, "worktree", "add", "-q", "-b", "linked", linked)
				root = linked
			}
			gitDir := git(t, root, "rev-parse", "--absolute-git-dir")
			lock := filepath.Join(gitDir, "index.lock")
			write(t, lock, "")
			old := time.Now().Add(-24 * time.Hour)
			if err := os.Chtimes(lock, old, old); err != nil {
				t.Fatal(err)
			}
			write(t, filepath.Join(root, "file.txt"), "changed\n")
			write(t, filepath.Join(root, "unrelated.txt"), "leave untracked\n")
			bridge(t, root, lock)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			sha, err := hostrepo.CommitPaths(ctx, root, "fix: recover commit", []string{"file.txt"})
			if err != nil || sha == "" {
				t.Fatalf("commit must recover its abandoned lock: sha=%q err=%v", sha, err)
			}
			if got := git(t, root, "show", "HEAD:file.txt"); got != "changed" {
				t.Fatalf("wrong committed content: %q", got)
			}
			if got := git(t, root, "status", "--porcelain"); !strings.Contains(got, "?? unrelated.txt") {
				t.Fatalf("unselected work must survive: %q", got)
			}
		})
	}
}

// The adapter contract is tested separately from the host process proof: other
// tests run real Git concurrently, so this fixture supplies the host decision.
func bridge(t *testing.T, root, lock string) {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "whx-git-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "git.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	t.Setenv("HARNESS_HOST_GIT_SOCKET", socket)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		var request struct{ Operation, Root string }
		if err := json.NewDecoder(conn).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if request.Operation != "recover_index_lock" || request.Root != root {
			t.Errorf("unexpected recovery request: %+v", request)
			return
		}
		if err := os.Remove(lock); err != nil {
			t.Error(err)
			return
		}
		_ = json.NewEncoder(conn).Encode(map[string]any{"exit_code": 0, "recovery": map[string]any{"recovered": true, "reason": "abandoned", "path": lock}})
	}()
}
