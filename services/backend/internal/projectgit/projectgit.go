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
