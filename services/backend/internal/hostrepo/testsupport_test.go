package hostrepo

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

// git runs a command with the repository-local settings every test needs:
// a fixed identity, no signing, and permission to use file:// submodule
// sources (Git denies those by default since CVE-2022-39253).
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	output, err := tryGit(dir, args...)
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return output
}

func tryGit(dir string, args ...string) (string, error) {
	base := []string{
		"-C", dir,
		"-c", "user.name=Tester",
		"-c", "user.email=test@example.invalid",
		"-c", "commit.gpgSign=false",
		"-c", "protocol.file.allow=always",
	}
	cmd := exec.Command("git", append(base, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1")
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

// newRepo creates a repository with one commit, matching what every Wharnex
// project is guaranteed to be.
func newRepo(t *testing.T, fileName, content string) string {
	t.Helper()
	root := t.TempDir()
	git(t, root, "init", "-q", "-b", "main")
	write(t, root, fileName, content)
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "initial")
	return root
}

// newRepoWithSubmodule builds a superproject with one initialized submodule at
// subPath, and returns both roots. This is the shape that broke every
// host-facing Git operation Wharnex performs.
func newRepoWithSubmodule(t *testing.T, subPath string) (root, submoduleOrigin string) {
	t.Helper()
	submoduleOrigin = newRepo(t, "lib.txt", "v1\n")
	root = newRepo(t, "README.md", "root\n")
	git(t, root, "submodule", "add", "-q", "--", submoduleOrigin, subPath)
	git(t, root, "commit", "-qm", "add submodule")
	return root, submoduleOrigin
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
