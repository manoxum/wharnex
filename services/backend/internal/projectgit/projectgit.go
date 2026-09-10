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

var ErrGitUnavailable = errors.New("git executable not found")

// Ensure initializes a Git repository at root when that project does not
// already own a .git directory/file, and guarantees it has at least one
// commit. A parent repository does not count: the Wharness project root
// receives its own repository so host apply and IDE Git operations have a
// stable boundary.
//
// The commit guarantee matters beyond mere bookkeeping: a repository with no
// commits has no resolvable HEAD, which breaks any real Git operation that
// needs one — including the sandbox-to-host integration merge (see
// internal/sandbox/gitintegration.go), which every Protected project now
// goes through. A brand-new project (just `git init`, nothing committed
// yet, e.g. one created via Wharness's own "Create Project") is exactly the
// case that would otherwise hit this on its very first change.
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
		if err := ensureInitialCommit(ctx, abs); err != nil {
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
	if err := ensureInitialCommit(ctx, abs); err != nil {
		return false, err
	}
	return true, nil
}

// ensureInitialCommit gives an unborn-HEAD repository (freshly init'd, or
// pre-existing but never committed to) exactly one baseline commit of
// whatever is currently on disk. A no-op when HEAD already resolves.
func ensureInitialCommit(ctx context.Context, abs string) error {
	verify := exec.CommandContext(ctx, "git", "-C", abs, "rev-parse", "--verify", "-q", "HEAD")
	if err := verify.Run(); err == nil {
		return nil
	}
	// Embedded repositories are excluded from the baseline for the same reason
	// the pre-merge snapshot excludes them: `git add -A` records one as a bare
	// gitlink, so the commit would claim to hold the operator's files while
	// containing only an unresolvable pointer. Hooks are disabled because this
	// commit is Wharnex's own bootstrap, not the operator's contribution — a
	// project's failing pre-commit lint must not block opening it.
	state, stateErr := hostrepo.Working(ctx, abs)
	stageArgs := []string{"add", "-A"}
	if stateErr == nil {
		stageArgs = hostrepo.StageArgs(state.EmbeddedRepositories)
	}
	commit := []string{
		"-c", "user.name=Wharness", "-c", "user.email=wharness@localhost",
		"-c", "commit.gpgSign=false", "-c", "core.hooksPath=" + filepath.Join(abs, ".git", "wharnex-hooks-disabled"),
		"commit", "-q", "--no-verify", "--allow-empty", "-m", "Wharness project baseline",
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

// Clone creates a new project checkout and recursively initializes every Git
// submodule. The destination must not already exist, which prevents accidental
// replacement of an existing workspace.
func Clone(ctx context.Context, source, parent, directory string) (string, error) {
	source = strings.TrimSpace(source)
	if err := validateCloneSource(source); err != nil {
		return "", err
	}
	parentAbs, err := filepath.Abs(strings.TrimSpace(parent))
	if err != nil {
		return "", fmt.Errorf("resolve clone parent: %w", err)
	}
	info, err := os.Stat(parentAbs)
	if err != nil || !info.IsDir() {
		return "", errors.New("clone parent must be an existing directory")
	}
	if directory == "" {
		directory = cloneDirectoryName(source)
	}
	if err := validateDirectoryName(directory); err != nil {
		return "", err
	}
	destination := filepath.Join(parentAbs, directory)
	if _, err := os.Lstat(destination); err == nil {
		return "", fmt.Errorf("clone destination already exists: %s", destination)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("inspect clone destination: %w", err)
	}
	if _, err := exec.LookPath("git"); err != nil {
		return "", ErrGitUnavailable
	}
	cmd := exec.CommandContext(ctx, "git", "clone", "--recurse-submodules", "--", source, destination)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if output, err := cmd.CombinedOutput(); err != nil {
		message := strings.ReplaceAll(strings.TrimSpace(string(output)), source, "<repository>")
		return "", fmt.Errorf("git clone --recurse-submodules: %s", message)
	}
	return destination, nil
}

func validateCloneSource(source string) error {
	if source == "" || strings.HasPrefix(source, "-") {
		return errors.New("git repository URL/path is required")
	}
	if filepath.IsAbs(source) {
		return nil
	}
	for _, prefix := range []string{"https://", "http://", "ssh://", "git://", "file://"} {
		if strings.HasPrefix(source, prefix) {
			return nil
		}
	}
	at, colon := strings.Index(source, "@"), strings.Index(source, ":")
	if at > 0 && colon > at+1 && colon < len(source)-1 {
		return nil
	}
	return errors.New("git repository must be an absolute local path or a supported Git URL")
}

func cloneDirectoryName(source string) string {
	value := strings.TrimSuffix(strings.TrimSpace(source), "/")
	if idx := strings.LastIndex(value, ":"); idx >= 0 && !strings.Contains(value[idx+1:], "/") {
		value = value[idx+1:]
	}
	value = filepath.Base(value)
	value = strings.TrimSuffix(value, ".git")
	if value == "." || value == string(filepath.Separator) || value == "" {
		return "project"
	}
	return value
}

func validateDirectoryName(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || filepath.Base(value) != value || strings.ContainsAny(value, `/\\`) {
		return errors.New("project directory name must be a single path segment")
	}
	if strings.HasPrefix(value, "-") {
		return errors.New("project directory name must not start with '-'")
	}
	return nil
}

// Create makes an empty project directory and initializes its Git boundary.
func Create(ctx context.Context, parent, directory string) (string, error) {
	parentAbs, err := filepath.Abs(strings.TrimSpace(parent))
	if err != nil {
		return "", fmt.Errorf("resolve project parent: %w", err)
	}
	info, err := os.Stat(parentAbs)
	if err != nil || !info.IsDir() {
		return "", errors.New("project parent must be an existing directory")
	}
	if err := validateDirectoryName(directory); err != nil {
		return "", err
	}
	root := filepath.Join(parentAbs, strings.TrimSpace(directory))
	if err := os.Mkdir(root, 0o755); err != nil {
		if os.IsExist(err) {
			return "", fmt.Errorf("project directory already exists: %s", root)
		}
		return "", fmt.Errorf("create project directory: %w", err)
	}
	if _, err := Ensure(ctx, root); err != nil {
		_ = os.RemoveAll(root)
		return "", err
	}
	return root, nil
}
