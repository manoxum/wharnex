package repositorytree

import (
	"context"
	"fmt"
	"path/filepath"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/gitops"
	"kernl.local/harness/backend/internal/hostrepo"
)

const BlockedIncomplete hostrepo.BlockedReason = "submodule_sync_incomplete"

// CompletionError measures owned checkouts before their content can be used as
// verification evidence. Generic reconciliation skips remain advisory.
func CompletionError(ctx context.Context, root string, units []domain.RepositoryIntegration, result hostrepo.SyncResult, rollback bool) error {
	for _, unit := range units {
		repository := filepath.Join(root, filepath.FromSlash(unit.Path))
		for _, skipped := range result.Skipped {
			if skipped.Path == unit.Path {
				if blocked := hostrepo.HostGitBlocked(ctx, repository, skipped.Reason); blocked != nil {
					return blocked
				}
				return incomplete(unit.Path, skipped.Reason)
			}
		}
		topology, err := hostrepo.Inspect(ctx, repository)
		if err != nil {
			return incomplete(unit.Path, err.Error())
		}
		if topology.Branch != unit.TargetBranch {
			return incomplete(unit.Path, "checkout branch differs from the verified branch")
		}
		actual, err := head(ctx, repository)
		if err != nil {
			return incomplete(unit.Path, err.Error())
		}
		if rollback {
			if actual != unit.BaseCommit {
				return incomplete(unit.Path, fmt.Sprintf("rollback left HEAD at %s, expected %s", actual, unit.BaseCommit))
			}
		} else if _, err := gitops.Combined(ctx, repository, "merge-base", "--is-ancestor", unit.Commit, actual); err != nil {
			return incomplete(unit.Path, fmt.Sprintf("checkout %s does not contain verified commit %s", actual, unit.Commit))
		}
	}
	return nil
}

func incomplete(path, detail string) error {
	return &hostrepo.BlockedError{
		Reason: BlockedIncomplete, Paths: []string{path}, Detail: detail,
		Remedy: "restore the owned repository checkout and retry the verified integration",
	}
}
