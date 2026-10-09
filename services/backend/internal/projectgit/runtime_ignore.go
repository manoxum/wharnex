package projectgit

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const runtimeIgnoreRule = "/.harness/"

// ensureRuntimeIgnored keeps Wharnex's local state out of future commits. An
// existing tracked runtime tree must also leave the index: Git ignore rules do
// not apply to paths that are already tracked.
func ensureRuntimeIgnored(ctx context.Context, root string) error {
	path := filepath.Join(root, ".gitignore")
	info, err := os.Lstat(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("inspect project .gitignore: %w", err)
	}
	if err == nil && !info.Mode().IsRegular() {
		return fmt.Errorf("project .gitignore must be a regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read project .gitignore: %w", err)
	}
	if !containsIgnoreRule(string(data), runtimeIgnoreRule) {
		prefix := ""
		if len(data) > 0 && data[len(data)-1] != '\n' {
			prefix = "\n"
		}
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o644)
		if err != nil {
			return fmt.Errorf("open project .gitignore: %w", err)
		}
		_, writeErr := file.WriteString(prefix + runtimeIgnoreRule + "\n")
		closeErr := file.Close()
		if writeErr != nil {
			return fmt.Errorf("write project .gitignore: %w", writeErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close project .gitignore: %w", closeErr)
		}
	}
	// Listing is read-only; only an actually tracked tree pays for `git rm`,
	// which takes the index lock. Ensure runs on every project open, and an
	// unconditional rm would fail it on any foreign lock even with nothing to do.
	tracked, err := exec.CommandContext(ctx, "git", "-C", root, "ls-files", "-z", "--", ".harness").Output()
	if err != nil {
		return fmt.Errorf("list tracked .harness in Git index: %w", err)
	}
	if len(tracked) == 0 {
		return nil
	}
	cmd := exec.CommandContext(ctx, "git", "-C", root, "rm", "-q", "-r", "--cached", "--ignore-unmatch", "--", ".harness")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("remove tracked .harness from Git index: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func containsIgnoreRule(content, rule string) bool {
	for _, line := range strings.Split(content, "\n") {
		if strings.TrimSpace(line) == rule {
			return true
		}
	}
	return false
}
