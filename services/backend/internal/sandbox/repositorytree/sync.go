package repositorytree

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/gitops"
	"kernl.local/harness/backend/internal/hostrepo"
)

func Sync(ctx context.Context, hostRoot string, before []hostrepo.Submodule, integrations []domain.RepositoryIntegration, rollback bool) hostrepo.SyncResult {
	result := hostrepo.SyncResult{}
	for _, integration := range integrations {
		repository := filepath.Join(hostRoot, filepath.FromSlash(integration.Path))
		destination := integration.Commit
		expected := integration.BaseCommit
		if rollback {
			destination, expected = integration.BaseCommit, integration.Commit
		}
		if destination == "" {
			continue
		}
		topology, err := hostrepo.Inspect(ctx, repository)
		if err != nil {
			result.Skipped = append(result.Skipped, hostrepo.SyncSkip{Path: integration.Path, Reason: err.Error()})
			continue
		}
		head, err := head(ctx, repository)
		if err != nil {
			result.Skipped = append(result.Skipped, hostrepo.SyncSkip{Path: integration.Path, Reason: err.Error()})
			continue
		}
		if !rollback && head != destination {
			if _, integratedErr := gitops.Combined(ctx, repository, "merge-base", "--is-ancestor", destination, head); integratedErr == nil {
				result.Updated = append(result.Updated, integration.Path)
				continue
			}
		}
		if integration.TargetBranch == "" {
			if output, checkoutErr := gitops.Combined(ctx, repository, "checkout", "--detach", destination); checkoutErr != nil {
				result.Skipped = append(result.Skipped, hostrepo.SyncSkip{Path: integration.Path, Reason: strings.TrimSpace(output)})
				continue
			}
			result.Updated = append(result.Updated, integration.Path)
			continue
		}
		if topology.Branch != integration.TargetBranch {
			result.Skipped = append(result.Skipped, hostrepo.SyncSkip{Path: integration.Path, Reason: fmt.Sprintf("branch changed from %s to %s", integration.TargetBranch, topology.Branch)})
			continue
		}
		if head != destination {
			if expected != "" && head != expected {
				result.Skipped = append(result.Skipped, hostrepo.SyncSkip{Path: integration.Path, Reason: fmt.Sprintf("branch %s moved to %s", integration.TargetBranch, head)})
				continue
			}
			args := []string{"merge", "--ff-only", destination}
			if rollback {
				args = []string{"reset", "--hard", destination}
			}
			if output, moveErr := gitops.Combined(ctx, repository, args...); moveErr != nil {
				result.Skipped = append(result.Skipped, hostrepo.SyncSkip{Path: integration.Path, Reason: strings.TrimSpace(output)})
				continue
			}
		}
		result.Updated = append(result.Updated, integration.Path)
	}

	// Tell generic reconciliation that repositories handled above are already
	// at the desired gitlink. Omitting them would make the generic pass treat
	// them as newly discovered and detach them with `submodule update`.
	filtered := append([]hostrepo.Submodule(nil), before...)
	recordedAfter := map[string]string{}
	if after, err := hostrepo.Inspect(ctx, hostRoot); err == nil {
		for _, submodule := range after.Submodules {
			recordedAfter[submodule.Path] = submodule.CommitSHA
		}
	}
	for _, submodule := range before {
		for index := range integrations {
			if integrations[index].Path == submodule.Path {
				destination := integrations[index].Commit
				if rollback {
					destination = integrations[index].BaseCommit
				}
				if recorded := recordedAfter[submodule.Path]; recorded != "" {
					destination = recorded
				}
				for filteredIndex := range filtered {
					if filtered[filteredIndex].Path == submodule.Path {
						filtered[filteredIndex].CommitSHA = destination
					}
				}
			}
		}
	}
	generic, _ := hostrepo.SyncSubmodules(ctx, hostRoot, filtered)
	result.Updated = append(result.Updated, generic.Updated...)
	result.Skipped = append(result.Skipped, generic.Skipped...)
	return result
}

func head(ctx context.Context, root string) (string, error) {
	output, err := gitops.Combined(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("resolve HEAD: %s", output)
	}
	return output, nil
}
