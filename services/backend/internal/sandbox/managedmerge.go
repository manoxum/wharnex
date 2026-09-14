package sandbox

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/projectknowledge"
)

func partitionManagedMergePaths(paths []string) (managed, ordinary []string) {
	for _, path := range paths {
		if projectknowledge.IsManagedPath(path) {
			managed = append(managed, path)
			continue
		}
		ordinary = append(ordinary, path)
	}
	return managed, ordinary
}

func partitionLocallyResolvedMergePaths(paths []string, gitlinks map[string]string) (local, ordinary []string) {
	managed, ordinary := partitionManagedMergePaths(paths)
	local = append(local, managed...)
	if len(gitlinks) == 0 {
		return local, ordinary
	}
	remaining := make([]string, 0, len(ordinary))
	for _, path := range ordinary {
		if _, found := gitlinks[path]; found {
			local = append(local, path)
			continue
		}
		remaining = append(remaining, path)
	}
	return local, remaining
}

// resolveLocalMergeConflicts resolves paths whose value the Engine can prove
// without a planner. Wharnex-owned knowledge preserves the host side. An owned
// repository-tree gitlink uses the descendant commit selected before the merge
// from the validated nested candidate and checkout base.
func resolveLocalMergeConflicts(ctx context.Context, hostPath string, topology hostrepo.Topology, preMergeSHA string, paths []string, gitlinks map[string]string) error {
	for _, path := range paths {
		if commit := strings.TrimSpace(gitlinks[path]); commit != "" {
			if output, err := runGit(ctx, hostPath, "update-index", "--add", "--cacheinfo", "160000", commit, path); err != nil {
				return fmt.Errorf("select locally reconciled gitlink %s at %s: %s", path, commit, output)
			}
			continue
		}
		listed, listErr := runGit(ctx, hostPath, "ls-tree", "--name-only", preMergeSHA, "--", path)
		if listErr != nil {
			return fmt.Errorf("inspect host version of managed conflict %s: %s", path, listed)
		}
		if strings.TrimSpace(listed) == "" {
			if output, err := runGit(ctx, hostPath, "rm", "-q", "-f", "--ignore-unmatch", "--", path); err != nil {
				return fmt.Errorf("preserve host deletion for managed conflict %s: %s", path, output)
			}
			continue
		}
		if output, err := runGit(ctx, hostPath, "checkout", preMergeSHA, "--", path); err != nil {
			return fmt.Errorf("restore host version for managed conflict %s: %s", path, output)
		}
	}
	commitArgs := append(hostrepo.InternalGitArgs(topology), "commit", "-q", "--no-edit")
	if output, err := runGit(ctx, hostPath, commitArgs...); err != nil {
		return fmt.Errorf("commit merge after local managed-state reconciliation: %s", output)
	}
	return nil
}
