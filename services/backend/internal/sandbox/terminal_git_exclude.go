package sandbox

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

const terminalRuntimeGitExclude = "**/.harness/terminal/"

var terminalGitExcludeMu sync.Mutex

// ensureTerminalRuntimeGitExclude keeps Wharnex-owned terminal state out of
// Git without modifying the project's versioned .gitignore. The repository's
// local exclude is the right boundary for runtime state created by this
// installation, and one rule also covers projects rooted below a worktree.
func ensureTerminalRuntimeGitExclude(projectRoot string) error {
	excludePath, found, err := terminalGitExcludePath(projectRoot)
	if err != nil || !found {
		return err
	}
	terminalGitExcludeMu.Lock()
	defer terminalGitExcludeMu.Unlock()
	return appendTerminalGitExclude(excludePath)
}

func terminalGitExcludePath(projectRoot string) (string, bool, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", false, nil
	}
	inside, err := terminalGitOutput(projectRoot, "rev-parse", "--is-inside-work-tree")
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("inspect project Git repository: %w", err)
	}
	if strings.TrimSpace(inside) != "true" {
		return "", false, nil
	}
	output, err := terminalGitOutput(projectRoot, "rev-parse", "--git-path", "info/exclude")
	if err != nil {
		return "", false, fmt.Errorf("resolve project Git exclude file: %w", err)
	}
	path := strings.TrimSpace(output)
	if path == "" {
		return "", false, errors.New("Git returned an empty local exclude path")
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(projectRoot, path)
	}
	return filepath.Clean(path), true, nil
}

func terminalGitOutput(root string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	env := make([]string, 0, len(os.Environ())+1)
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "GIT_") {
			env = append(env, entry)
		}
	}
	cmd.Env = append(env, "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	return string(output), err
}

func appendTerminalGitExclude(path string) error {
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("project Git exclude path must be a regular file")
		}
		if info.Size() > 1024*1024 {
			return errors.New("project Git exclude file exceeds 1 MiB")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect project Git exclude file: %w", err)
	}
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read project Git exclude file: %w", err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == terminalRuntimeGitExclude {
			return nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("prepare project Git exclude directory: %w", err)
	}
	prefix := ""
	if len(data) > 0 && data[len(data)-1] != '\n' {
		prefix = "\n"
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open project Git exclude file: %w", err)
	}
	if _, err := file.WriteString(prefix + terminalRuntimeGitExclude + "\n"); err != nil {
		_ = file.Close()
		return fmt.Errorf("write project Git exclude file: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close project Git exclude file: %w", err)
	}
	return nil
}
