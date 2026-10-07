// Package recovery implements the host-owned proof for abandoned index locks.
package recovery

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const MinimumAge = 15 * time.Minute

type Result struct {
	Recovered  bool   `json:"recovered"`
	Reason     string `json:"reason"`
	Path       string `json:"path,omitempty"`
	AgeSeconds int64  `json:"age_seconds,omitempty"`
}

func repositoryLock(ctx context.Context, root string) (string, error) {
	if root == "" || !filepath.IsAbs(root) || filepath.Clean(root) != root {
		return "", errors.New("invalid_repository_root")
	}
	if err := noSymlinks(root); err != nil {
		return "", err
	}
	read := func(args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...)
		// The host derives topology independently of backend/private indexes.
		for _, entry := range os.Environ() {
			if !strings.HasPrefix(entry, "GIT_") {
				cmd.Env = append(cmd.Env, entry)
			}
		}
		cmd.Env = append(cmd.Env, "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0")
		out, err := cmd.Output()
		if err != nil || len(out) > 4096 {
			return "", errors.New("repository_unobservable")
		}
		return strings.TrimSpace(string(out)), nil
	}
	top, err := read("rev-parse", "--show-toplevel")
	if err != nil || top != root {
		return "", errors.New("invalid_repository_root")
	}
	dir, err := read("rev-parse", "--absolute-git-dir")
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(dir) {
		return "", errors.New("invalid_git_directory")
	}
	if err := noSymlinks(dir); err != nil {
		return "", err
	}
	if err := noSymlinks(filepath.Join(root, ".git")); err != nil {
		return "", err
	}
	entry, err := os.Lstat(filepath.Join(root, ".git"))
	if err != nil {
		return "", errors.New("repository_unobservable")
	}
	if entry.IsDir() {
		if dir != filepath.Join(root, ".git") {
			return "", errors.New("unowned_git_directory")
		}
	} else if entry.Mode().IsRegular() {
		// A gitfile alone can point at unrelated metadata. Linked worktrees
		// prove their backlink; submodules prove their configured worktree.
		backlink, backlinkErr := os.ReadFile(filepath.Join(dir, "gitdir"))
		if backlinkErr == nil {
			if len(backlink) > 4096 || strings.TrimSpace(string(backlink)) != filepath.Join(root, ".git") {
				return "", errors.New("unowned_git_directory")
			}
		} else {
			worktree, err := read("config", "--local", "--get", "core.worktree")
			if err != nil || worktree == "" {
				return "", errors.New("unowned_git_directory")
			}
			if !filepath.IsAbs(worktree) {
				worktree = filepath.Join(dir, worktree)
			}
			if filepath.Clean(worktree) != root {
				return "", errors.New("unowned_git_directory")
			}
		}
	} else {
		return "", errors.New("invalid_git_directory")
	}
	for _, name := range []string{"MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer", "BISECT_LOG"} {
		if _, err := os.Lstat(filepath.Join(dir, name)); !errors.Is(err, os.ErrNotExist) {
			return "", errors.New("operation_in_progress")
		}
	}
	return filepath.Join(dir, "index.lock"), nil
}

func noSymlinks(path string) error {
	real, err := filepath.EvalSymlinks(path)
	if err != nil || real != filepath.Clean(path) {
		return errors.New("path_unobservable_or_symlink")
	}
	return nil
}
