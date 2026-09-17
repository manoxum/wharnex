package hostrepo

import (
	"context"
	"errors"
	"fmt"
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
