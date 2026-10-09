// Package gitops owns engine Git command execution and bounded index-lock
// recovery. It is never an executor for model-authored operations.
package gitops

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
)

var ErrUnavailable = errors.New("git executable not found")

// Combined preserves the existing combined, trimmed diagnostic contract.
func Combined(ctx context.Context, root string, args ...string) (string, error) {
	output, err := execute(ctx, root, true, args...)
	return strings.TrimSpace(output), err
}

// Output preserves stdout byte-for-byte and keeps stderr out of file content.
func Output(ctx context.Context, root string, args ...string) (string, error) {
	return execute(ctx, root, false, args...)
}

func environment() []string {
	return append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_OPTIONAL_LOCKS=0", "LC_ALL=C")
}

func execute(ctx context.Context, root string, combined bool, args ...string) (string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", ErrUnavailable
	}
	return retry(ctx, root, func() (string, string, error) {
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...)
		cmd.Env = environment()
		if combined {
			output, err := cmd.CombinedOutput()
			return string(output), string(output), err
		}
		var stderr strings.Builder
		cmd.Stderr = &stderr
		output, err := cmd.Output()
		return string(output), stderr.String(), err
	}, recoverLock)
}
