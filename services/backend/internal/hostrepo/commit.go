package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo/committing"
)

// ErrNothingToCommit reports a selection whose paths hold no change.
var ErrNothingToCommit = committing.ErrNothingToCommit

// ErrNoCommitIdentity reports a repository without the operator's Git identity.
var ErrNoCommitIdentity = committing.ErrNoCommitIdentity

// CommitPaths commits only selected paths with the operator's identity and hooks.
func CommitPaths(ctx context.Context, root, message string, paths []string) (string, error) {
	return committing.Paths(ctx, root, message, paths, false, commitFailure(ctx, root))
}

// CommitInternalPaths records engine metadata with its fixed identity and no hooks.
func CommitInternalPaths(ctx context.Context, root, message string, paths []string) (string, error) {
	return committing.Paths(ctx, root, message, paths, true, commitFailure(ctx, root))
}

func commitFailure(ctx context.Context, root string) committing.Failure {
	return func(output, action string) error {
		return hostGitFailure(ctx, root, output, action)
	}
}

// HasCommitIdentity reports whether Git can attribute an operator commit.
func HasCommitIdentity(ctx context.Context, root string) bool {
	return committing.HasIdentity(ctx, root)
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
