package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// ErrNothingToCommit reports a commit request whose paths hold no change.
// It is a routine outcome — the operator may have reverted the file, or
// committed it by hand in their own terminal — not a failure of the request.
var ErrNothingToCommit = errors.New("the selected paths hold no uncommitted change")

// ErrNoCommitIdentity reports a repository with no configured user identity.
// A human-authored commit deliberately does not fall back to Wharnex's own
// identity: the commit is the operator's, and silently attributing their work
// to a bot is worse than asking them to configure Git once.
var ErrNoCommitIdentity = errors.New("this repository has no configured Git identity (user.name / user.email)")

// CommitPaths stages exactly the given paths and commits them under the
// operator's own Git identity, running the project's own hooks.
//
// Both of those are deliberate inversions of how Wharnex commits internally.
// A snapshot or integration commit is Wharnex's plumbing — fixed identity,
// hooks disabled — but this commit is the operator's own contribution, made
// because they asked for it from the Git surface. It belongs to them, so it
// carries their name and passes through their own pre-commit gate.
func CommitPaths(ctx context.Context, root, message string, paths []string) (commitSHA string, err error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return "", errors.New("a commit message is required")
	}
	if len(paths) == 0 {
		return "", errors.New("at least one path is required")
	}
	if !HasCommitIdentity(ctx, root) {
		return "", ErrNoCommitIdentity
	}
	// Staging with `--` and explicit paths keeps an unrelated concurrent edit
	// elsewhere in the worktree out of this commit, which is what makes
	// committing one pending change at a time meaningful at all.
	stage := append([]string{"add", "--all", "--"}, paths...)
	if output, addErr := run(ctx, root, stage...); addErr != nil {
		return "", hostGitFailure(ctx, root, output, "stage selected paths")
	}
	staged, err := run(ctx, root, "diff", "--cached", "--name-only", "--")
	if err == nil && strings.TrimSpace(staged) == "" {
		// Leave the index as the operator had it rather than carrying a
		// half-staged state forward from a commit that did not happen.
		_, _ = run(ctx, root, "reset", "--quiet", "HEAD", "--")
		return "", ErrNothingToCommit
	}
	commit := append([]string{"commit", "-q", "-m", message, "--"}, paths...)
	if output, commitErr := run(ctx, root, commit...); commitErr != nil {
		return "", hostGitFailure(ctx, root, output, "commit selected paths")
	}
	sha, err := run(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("resolve new commit: %s", sha)
	}
	return sha, nil
}

// HasCommitIdentity reports whether Git can attribute a commit without
// inventing an identity. `git config user.email` resolves the full
// system/global/local chain, so a normally configured machine passes.
// CommitInternalPaths records Wharnex-owned metadata without attributing it
// to the operator or running project hooks. Only the explicit paths are staged.
func CommitInternalPaths(ctx context.Context, root, message string, paths []string) (string, error) {
	message = strings.TrimSpace(message)
	if message == "" || len(paths) == 0 {
		return "", errors.New("internal commit requires a message and at least one path")
	}
	stage := append([]string{"add", "--all", "--"}, paths...)
	if output, err := run(ctx, root, stage...); err != nil {
		return "", hostGitFailure(ctx, root, output, "stage internal paths")
	}
	staged, err := run(ctx, root, "diff", "--cached", "--name-only", "--")
	if err != nil {
		return "", fmt.Errorf("inspect internal staged paths: %s", staged)
	}
	if strings.TrimSpace(staged) == "" {
		return "", ErrNothingToCommit
	}
	args := []string{
		"-c", "user.name=Wharnex", "-c", "user.email=wharness@localhost",
		"-c", "commit.gpgSign=false", "-c", "core.hooksPath=" + filepath.Join(root, ".git", "wharnex-hooks-disabled"),
		"commit", "-q", "--no-verify", "-m", message, "--",
	}
	args = append(args, paths...)
	if output, err := run(ctx, root, args...); err != nil {
		return "", hostGitFailure(ctx, root, output, "commit internal paths")
	}
	sha, err := run(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("resolve internal commit: %s", sha)
	}
	return sha, nil
}

func HasCommitIdentity(ctx context.Context, root string) bool {
	email, err := run(ctx, root, "config", "--get", "user.email")
	if err != nil || strings.TrimSpace(email) == "" {
		return false
	}
	name, err := run(ctx, root, "config", "--get", "user.name")
	return err == nil && strings.TrimSpace(name) != ""
}

// UnwindToCommit moves the branch back to a commit while leaving every file
// in the working tree exactly as it is.
//
// This is what turns a completed integration into uncommitted work: the merge
// has already run and been verified, so the files on disk are the verified
// result; resetting the branch pointer with `--mixed` discards only the
// history Wharnex created on the way there, leaving the change — and the
// operator's own pre-existing edits, which the pre-merge snapshot had
// committed — as ordinary uncommitted changes for them to commit themselves.
func UnwindToCommit(ctx context.Context, root, commitSHA string) error {
	commitSHA = strings.TrimSpace(commitSHA)
	if commitSHA == "" {
		return errors.New("a target commit is required")
	}
	if output, err := run(ctx, root, "reset", "--mixed", "--quiet", commitSHA); err != nil {
		return hostGitFailure(ctx, root, output, "return host history to "+commitSHA)
	}
	return nil
}

// StagedPathsHaveChanges reports which of the given paths currently differ
// from HEAD, so a caller can tell a pending record that is still real from one
// the operator has already dealt with themselves.
func PathsWithChanges(ctx context.Context, root string, paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	args := append([]string{"status", "--porcelain=v2", "-z", "--untracked-files=all", "--no-renames", "--"}, paths...)
	output, err := run(ctx, root, args...)
	if err != nil {
		return nil, fmt.Errorf("inspect selected paths: %s", output)
	}
	changed := make([]string, 0, len(paths))
	seen := map[string]bool{}
	for _, record := range strings.Split(output, "\x00") {
		if record == "" {
			continue
		}
		var path string
		switch record[0] {
		case '1', '2':
			path = recordPath(record, 8)
		case 'u':
			path = recordPath(record, 10)
		case '?':
			path = recordPath(record, 1)
		}
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		changed = append(changed, path)
	}
	return changed, nil
}
