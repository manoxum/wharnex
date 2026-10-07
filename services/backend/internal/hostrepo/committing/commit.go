// Package committing owns selective host commits, preserving unrelated index work.
package committing

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/gitops"
)

var (
	ErrNothingToCommit  = errors.New("the selected paths hold no uncommitted change")
	ErrNoCommitIdentity = errors.New("this repository has no configured Git identity (user.name / user.email)")
)

// Failure retains the host repository's typed, redacted write-error boundary.
type Failure func(output, action string) error

// Paths commits the current contents of selected paths. Operator commits retain
// their configured identity and hooks; internal metadata commits disable hooks
// and signing and retain the already-shipped bookkeeping author identity.
func Paths(ctx context.Context, root, message string, paths []string, internal bool, failure Failure) (string, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return "", errors.New("a commit message is required")
	}
	if len(paths) == 0 {
		return "", errors.New("at least one path is required")
	}
	if !internal && !HasIdentity(ctx, root) {
		return "", ErrNoCommitIdentity
	}
	stagePaths, err := pathsToStage(ctx, root, paths, failure)
	if err != nil {
		return "", err
	}
	label := "selected"
	if internal {
		label = "internal"
	}
	if len(stagePaths) > 0 {
		stage := append([]string{"add", "--all", "--"}, literalPaths(stagePaths)...)
		if output, err := gitops.Combined(ctx, root, stage...); err != nil {
			return "", failure(output, "stage "+label+" paths")
		}
	}
	inspect := append([]string{"diff", "--cached", "--name-only", "-z", "--"}, literalPaths(paths)...)
	staged, err := gitops.Output(ctx, root, inspect...)
	if err != nil {
		return "", failure(staged, "inspect "+label+" staged paths")
	}
	if staged == "" {
		return "", ErrNothingToCommit
	}
	args := []string{"commit", "-q", "-m", message, "--"}
	if internal {
		args = []string{
			"-c", "user.name=Wharnex", "-c", "user.email=wharness@localhost",
			"-c", "commit.gpgSign=false", "-c", "core.hooksPath=" + filepath.Join(root, ".git", "wharnex-hooks-disabled"),
			"commit", "-q", "--no-verify", "-m", message, "--",
		}
	}
	args = append(args, literalPaths(paths)...)
	if output, err := gitops.Combined(ctx, root, args...); err != nil {
		return "", failure(output, "commit "+label+" paths")
	}
	sha, err := gitops.Combined(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return "", failure(sha, "resolve new commit")
	}
	return sha, nil
}

// HasIdentity resolves Git's local/global/system identity without inventing one.
func HasIdentity(ctx context.Context, root string) bool {
	email, err := gitops.Combined(ctx, root, "config", "--get", "user.email")
	if err != nil || strings.TrimSpace(email) == "" {
		return false
	}
	name, err := gitops.Combined(ctx, root, "config", "--get", "user.name")
	return err == nil && strings.TrimSpace(name) != ""
}
