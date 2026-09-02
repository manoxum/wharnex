package projectgit

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var ErrGitUnavailable = errors.New("git executable not found")

// Ensure initializes a Git repository at root when that project does not
// already own a .git directory/file. A parent repository does not count: the
// Wharness project root receives its own repository so host apply and IDE Git
// operations have a stable boundary.
func Ensure(ctx context.Context, root string) (initialized bool, err error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return false, fmt.Errorf("resolve project root: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return false, errors.New("project path must be an existing directory")
	}
	if _, err := os.Lstat(filepath.Join(abs, ".git")); err == nil {
		return false, nil
	} else if !os.IsNotExist(err) {
		return false, fmt.Errorf("inspect .git: %w", err)
	}
	if _, err := exec.LookPath("git"); err != nil {
		return false, ErrGitUnavailable
	}
	cmd := exec.CommandContext(ctx, "git", "-C", abs, "init", "-q")
	if output, err := cmd.CombinedOutput(); err != nil {
		return false, fmt.Errorf("git init: %s", strings.TrimSpace(string(output)))
	}
	if _, err := os.Lstat(filepath.Join(abs, ".git")); err != nil {
		return false, fmt.Errorf("git init completed without creating .git: %w", err)
	}
	return true, nil
}
