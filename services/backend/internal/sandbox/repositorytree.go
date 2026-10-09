package sandbox

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/sandbox/repositorytree"
)

// CommitVerifiedRepositoryTree commits a verified patch in every repository
// that owns one of paths. Nested repositories are committed first, so their
// parent commits record the resulting gitlink. Every branch is pushed only to
// the matching local host repository.
func CommitVerifiedRepositoryTree(ctx context.Context, workspaceRoot, hostRoot, branch, message string, paths []string, rootBaseRooted bool) (string, []domain.RepositoryIntegration, error) {
	repositories, err := repositorytree.Discover(ctx, hostRoot)
	if err != nil {
		return "", nil, err
	}
	groups := map[string][]string{}
	for _, path := range paths {
		owner := repositorytree.ForPath(repositories, path)
		rel := strings.TrimPrefix(path, owner.Path+"/")
		groups[owner.Path] = append(groups[owner.Path], rel)
	}
	sort.Slice(repositories, func(i, j int) bool {
		return repositorytree.Depth(repositories[i].Path) > repositorytree.Depth(repositories[j].Path)
	})
	integrations := make([]domain.RepositoryIntegration, 0)
	published := make([]repositorytree.Node, 0)
	cleanupPublished := func() {
		for index := len(published) - 1; index >= 0; index-- {
			hostPath := filepath.Join(hostRoot, filepath.FromSlash(published[index].Path))
			_ = DeleteHostBranch(ctx, hostPath, branch)
		}
	}
	rootCommit := ""
	for _, repository := range repositories {
		owned := repositorytree.NormalizePaths(groups[repository.Path])
		if len(owned) == 0 {
			continue
		}
		workspacePath := filepath.Join(workspaceRoot, filepath.FromSlash(repository.Path))
		hostPath := filepath.Join(hostRoot, filepath.FromSlash(repository.Path))
		var commit string
		if repository.Path == "." && rootBaseRooted {
			commit, err = CommitBaseRootedPatch(ctx, workspacePath, message, owned)
		} else {
			commit, err = CommitVerifiedPatch(ctx, workspacePath, branch, message, owned)
		}
		if err != nil {
			cleanupPublished()
			return "", integrations, fmt.Errorf("commit repository %s: %w", repository.Path, err)
		}
		if err := PushBranchToHost(ctx, workspacePath, hostPath, branch); err != nil {
			cleanupPublished()
			return "", integrations, fmt.Errorf("publish repository %s: %w", repository.Path, err)
		}
		published = append(published, repository)
		if repository.Path == "." {
			rootCommit = commit
			continue
		}
		integrations = append(integrations, domain.RepositoryIntegration{
			Path: repository.Path, Branch: branch, Commit: commit, TargetBranch: repository.TargetBranch, BaseCommit: repository.BaseCommit,
		})
		parentRelative := strings.TrimPrefix(repository.Path, repository.Parent+"/")
		groups[repository.Parent] = append(groups[repository.Parent], parentRelative)
	}
	if rootCommit == "" {
		cleanupPublished()
		return "", integrations, fmt.Errorf("repository tree: root gitlink commit was not created")
	}
	sort.Slice(integrations, func(i, j int) bool {
		return repositorytree.Depth(integrations[i].Path) < repositorytree.Depth(integrations[j].Path)
	})
	return rootCommit, integrations, nil
}

// ValidateRepositoryIntegrations proves every gitlink target is already in the
// matching local submodule object store before the superproject can move.
func ValidateRepositoryIntegrations(ctx context.Context, hostRoot string, integrations []domain.RepositoryIntegration) error {
	return repositorytree.Validate(ctx, hostRoot, integrations)
}

// MergeRepositoryTreeOnHost merges the superproject candidate and then moves
// every affected submodule on the branch it had when verification started.
// Git's ordinary submodule update checks out a detached HEAD; this branch-aware
// path keeps repositories such as devup, main and master selected.
func MergeRepositoryTreeOnHost(ctx context.Context, hostRoot, branch, requestBaseRef string, integrations []domain.RepositoryIntegration, identities ...hostrepo.CommitIdentity) (HostMerge, error) {
	gitlinks, err := repositoryGitlinkResolutions(ctx, hostRoot, integrations)
	if err != nil {
		return HostMerge{}, err
	}
	merged, err := mergeBranchOnHost(ctx, hostRoot, branch, requestBaseRef, gitlinks, func(before []hostrepo.Submodule) hostrepo.SyncResult {
		return repositorytree.Sync(ctx, hostRoot, before, integrations, false)
	}, identityOrDefault(identities))
	if err != nil {
		return merged, err
	}
	if blocked := repositorytree.CompletionError(ctx, hostRoot, integrations, merged.SubmoduleSync, false); blocked != nil {
		rollbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		_, rollbackErr := RevertRepositoryTreeMerge(rollbackCtx, hostRoot, merged.PreMergeSHA, integrations)
		if rollbackErr != nil {
			var refusal *hostrepo.BlockedError
			if errors.As(blocked, &refusal) {
				diagnostic := *refusal
				diagnostic.Detail += "; owned repository integration rollback failed: " + rollbackErr.Error()
				blocked = &diagnostic
			}
			return merged, errors.Join(blocked, rollbackErr)
		}
		return merged, blocked
	}
	return merged, nil
}

// repositoryGitlinkResolutions selects the descendant side of every validated
// nested candidate. Usually that is the candidate commit; after a partial old
// Apply it is the current base, which already contains the candidate and must
// never be rewound.
func repositoryGitlinkResolutions(ctx context.Context, hostRoot string, integrations []domain.RepositoryIntegration) (map[string]string, error) {
	resolutions := make(map[string]string, len(integrations))
	for _, integration := range integrations {
		repository := filepath.Join(hostRoot, filepath.FromSlash(integration.Path))
		if _, err := runGit(ctx, repository, "merge-base", "--is-ancestor", integration.BaseCommit, integration.Commit); err == nil {
			resolutions[integration.Path] = integration.Commit
			continue
		}
		if _, err := runGit(ctx, repository, "merge-base", "--is-ancestor", integration.Commit, integration.BaseCommit); err == nil {
			resolutions[integration.Path] = integration.BaseCommit
			continue
		}
		return nil, fmt.Errorf("nested repository %s candidate %s is unrelated to base %s", integration.Path, integration.Commit, integration.BaseCommit)
	}
	return resolutions, nil
}

// RevertRepositoryTreeMerge restores both the superproject and the branches
// advanced in its submodules. It is used only for the exact Apply transaction
// being rolled back, and refuses to move a branch whose HEAD changed meanwhile.
func RevertRepositoryTreeMerge(ctx context.Context, hostRoot, preMergeSHA string, integrations []domain.RepositoryIntegration) (hostrepo.SyncResult, error) {
	before, inspectErr := hostrepo.Inspect(ctx, hostRoot)
	if output, err := runGitWaitingForIndexLock(ctx, hostRoot, "reset", "--hard", preMergeSHA); err != nil {
		return hostrepo.SyncResult{}, fmt.Errorf("revert host merge to %s: %s", preMergeSHA, output)
	}
	if inspectErr != nil {
		return hostrepo.SyncResult{}, fmt.Errorf("inspect repository tree before rollback: %w", inspectErr)
	}
	if head, err := CurrentHeadSHA(ctx, hostRoot); err != nil || head != preMergeSHA {
		return hostrepo.SyncResult{}, fmt.Errorf("repository rollback HEAD is %s, expected %s: %v", head, preMergeSHA, err)
	}
	synced := repositorytree.Sync(ctx, hostRoot, before.Submodules, integrations, true)
	return synced, repositorytree.CompletionError(ctx, hostRoot, integrations, synced, true)
}
