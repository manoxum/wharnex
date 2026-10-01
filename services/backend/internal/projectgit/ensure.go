package projectgit

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// Ensure gives the project its own Git boundary and a resolvable HEAD. Runtime
// state is excluded before any baseline commit can stage the project tree.
func Ensure(ctx context.Context, root string) (initialized bool, err error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return false, fmt.Errorf("resolve project root: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return false, errors.New("project path must be an existing directory")
	}
	if _, statErr := os.Lstat(filepath.Join(abs, ".git")); statErr == nil {
		if err := prepareProjectRepository(ctx, abs); err != nil {
			return false, err
		}
		return false, nil
	} else if !os.IsNotExist(statErr) {
		return false, fmt.Errorf("inspect .git: %w", statErr)
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
	if err := prepareProjectRepository(ctx, abs); err != nil {
		return false, err
	}
	return true, nil
}

func prepareProjectRepository(ctx context.Context, root string) error {
	if err := ensureRuntimeIgnored(ctx, root); err != nil {
		return err
	}
	return ensureInitialCommit(ctx, root)
}

// ensureInitialCommit gives an unborn-HEAD repository exactly one baseline
// commit. Embedded repositories are excluded rather than staged as gitlinks.
func ensureInitialCommit(ctx context.Context, abs string) error {
	verify := exec.CommandContext(ctx, "git", "-C", abs, "rev-parse", "--verify", "-q", "HEAD")
	if err := verify.Run(); err == nil {
		return nil
	}
	state, stateErr := hostrepo.Working(ctx, abs)
	stageArgs := []string{"add", "-A"}
	if stateErr == nil {
		stageArgs = hostrepo.StageArgs(state.EmbeddedRepositories)
	}
	// Hooks are disabled for Wharnex's own bootstrap commit.
	commit := []string{
		"-c", "user.name=Wharnex", "-c", "user.email=wharnex@localhost",
		"-c", "commit.gpgSign=false", "-c", "core.hooksPath=" + filepath.Join(abs, ".git", "wharnex-hooks-disabled"),
		"commit", "-q", "--no-verify", "--allow-empty", "-m", "Wharnex project baseline",
	}
	commands := [][]string{
		append([]string{"git", "-C", abs}, stageArgs...),
		append([]string{"git", "-C", abs}, commit...),
	}
	for _, args := range commands {
		cmd := exec.CommandContext(ctx, args[0], args[1:]...)
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s: %s", strings.Join(args, " "), strings.TrimSpace(string(output)))
		}
	}
	return nil
}
