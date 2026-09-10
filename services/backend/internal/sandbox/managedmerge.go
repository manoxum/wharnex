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

// preserveManagedMergeConflicts resolves Wharnex-owned knowledge conflicts to
// the host side. A planner can never patch this subtree, so a candidate-side
// difference there can only be ancestry noise from an older request snapshot,
// never part of the verified change's write set.
func preserveManagedMergeConflicts(ctx context.Context, hostPath string, topology hostrepo.Topology, preMergeSHA string, paths []string) error {
	for _, path := range paths {
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
		return fmt.Errorf("commit merge after preserving managed state: %s", output)
	}
	return nil
}
