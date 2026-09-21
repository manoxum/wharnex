package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// CommitChangedPaths returns the repository-relative paths changed by one commit.
// The caller decides which of those paths it is allowed to expose.
func CommitChangedPaths(ctx context.Context, root, sha string) ([]string, error) {
	sha, err := fullCommitSHA(sha)
	if err != nil {
		return nil, err
	}
	output, err := runRaw(ctx, root, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-m", "-z", sha)
	if err != nil {
		return nil, fmt.Errorf("read commit paths failed")
	}
	seen := map[string]struct{}{}
	paths := make([]string, 0)
	for _, item := range strings.Split(output, "\x00") {
		path := item
		if path == "" {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, nil
}

// WorktreeMatchesCommitPaths reports whether every path changed by one commit
// already has exactly that commit's result in the current worktree.
//
// This is deliberately narrower than asking whether the whole tree matches the
// commit. Manual commit mode intentionally moves HEAD back after a verified
// integration while leaving the integrated files on disk as ordinary
// uncommitted work. A restart in that window must be able to prove that the
// candidate's own paths are already materialized without treating unrelated
// host changes as evidence either way.
func WorktreeMatchesCommitPaths(ctx context.Context, root, sha string) (bool, error) {
	sha, err := fullCommitSHA(sha)
	if err != nil {
		return false, err
	}
	paths, err := CommitChangedPaths(ctx, root, sha)
	if err != nil {
		return false, err
	}
	if len(paths) == 0 {
		return false, nil
	}
	for _, path := range paths {
		match, matchErr := worktreePathMatchesCommit(ctx, root, sha, path)
		if matchErr != nil {
			return false, matchErr
		}
		if !match {
			return false, nil
		}
	}
	return true, nil
}

func worktreePathMatchesCommit(ctx context.Context, root, sha, path string) (bool, error) {
	rel := filepath.Clean(filepath.FromSlash(path))
	if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false, fmt.Errorf("invalid commit path %q", path)
	}
	entry, err := runRaw(ctx, root, "ls-tree", "-z", sha, "--", path)
	if err != nil {
		return false, fmt.Errorf("read commit entry for %s: %w", path, err)
	}
	absolute := filepath.Join(root, rel)
	info, statErr := os.Lstat(absolute)
	if entry == "" {
		if os.IsNotExist(statErr) {
			return true, nil
		}
		if statErr != nil {
			return false, fmt.Errorf("inspect worktree path %s: %w", path, statErr)
		}
		return false, nil
	}
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return false, nil
		}
		return false, fmt.Errorf("inspect worktree path %s: %w", path, statErr)
	}

	entry = strings.TrimSuffix(entry, "\x00")
	meta, _, ok := strings.Cut(entry, "\t")
	if !ok {
		return false, fmt.Errorf("parse commit entry for %s", path)
	}
	fields := strings.Fields(meta)
	if len(fields) != 3 {
		return false, fmt.Errorf("parse commit entry metadata for %s", path)
	}
	mode, objectType, objectID := fields[0], fields[1], fields[2]
	switch objectType {
	case "blob":
		content, contentErr := runRaw(ctx, root, "cat-file", "blob", objectID)
		if contentErr != nil {
			return false, fmt.Errorf("read commit blob for %s: %w", path, contentErr)
		}
		if mode == "120000" {
			if info.Mode()&os.ModeSymlink == 0 {
				return false, nil
			}
			target, readErr := os.Readlink(absolute)
			if readErr != nil {
				return false, fmt.Errorf("read worktree symlink %s: %w", path, readErr)
			}
			return target == content, nil
		}
		if !info.Mode().IsRegular() {
			return false, nil
		}
		current, readErr := os.ReadFile(absolute)
		if readErr != nil {
			return false, fmt.Errorf("read worktree path %s: %w", path, readErr)
		}
		if string(current) != content {
			return false, nil
		}
		wantExecutable := mode == "100755"
		hasExecutable := info.Mode().Perm()&0o111 != 0
		return wantExecutable == hasExecutable, nil
	case "commit":
		if !info.IsDir() {
			return false, nil
		}
		head, headErr := run(ctx, absolute, "rev-parse", "HEAD")
		if headErr != nil {
			return false, nil
		}
		return strings.EqualFold(strings.TrimSpace(head), objectID), nil
	default:
		return false, nil
	}
}

// CommitDiffPaths returns one commit's patch restricted to the supplied paths.
// This lets request-bundle assembly reuse the context manifest as the security
// allowlist instead of accidentally reintroducing excluded files through Git.
func CommitDiffPaths(ctx context.Context, root, sha string, paths []string, limitBytes int) (diff string, truncated bool, err error) {
	sha, err = fullCommitSHA(sha)
	if err != nil {
		return "", false, err
	}
	if len(paths) == 0 {
		return "", false, nil
	}
	args := []string{"show", "-m", "--format=", "--no-color", "--no-ext-diff", sha, "--"}
	args = append(args, paths...)
	output, err := runRaw(ctx, root, args...)
	if err != nil {
		return "", false, fmt.Errorf("read commit diff failed")
	}
	if limitBytes > 0 && len(output) > limitBytes {
		return output[:limitBytes], true, nil
	}
	return output, false, nil
}

func fullCommitSHA(sha string) (string, error) {
	sha = strings.TrimSpace(sha)
	if len(sha) != 40 {
		return "", errors.New("a full commit sha is required")
	}
	for _, r := range sha {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return "", errors.New("invalid commit sha")
		}
	}
	return sha, nil
}
