package sandbox

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

type repositoryNode struct {
	path         string
	parent       string
	targetBranch string
	baseCommit   string
}

// CommitVerifiedRepositoryTree commits a verified patch in every repository
// that owns one of paths. Nested repositories are committed first, so their
// parent commits record the resulting gitlink. Every branch is pushed only to
// the matching local host repository.
func CommitVerifiedRepositoryTree(ctx context.Context, workspaceRoot, hostRoot, branch, message string, paths []string, rootBaseRooted bool) (string, []domain.RepositoryIntegration, error) {
	repositories, err := discoverRepositoryTree(ctx, hostRoot)
	if err != nil {
		return "", nil, err
	}
	groups := map[string][]string{}
	for _, path := range paths {
		owner := repositoryForPath(repositories, path)
		rel := strings.TrimPrefix(path, owner.path+"/")
		groups[owner.path] = append(groups[owner.path], rel)
	}
	sort.Slice(repositories, func(i, j int) bool {
		return pathDepth(repositories[i].path) > pathDepth(repositories[j].path)
	})
	integrations := make([]domain.RepositoryIntegration, 0)
	published := make([]repositoryNode, 0)
	cleanupPublished := func() {
		for index := len(published) - 1; index >= 0; index-- {
			hostPath := filepath.Join(hostRoot, filepath.FromSlash(published[index].path))
			_ = DeleteHostBranch(ctx, hostPath, branch)
		}
	}
	rootCommit := ""
	for _, repository := range repositories {
		owned := normalizedRepositoryPaths(groups[repository.path])
		if len(owned) == 0 {
			continue
		}
		workspacePath := filepath.Join(workspaceRoot, filepath.FromSlash(repository.path))
		hostPath := filepath.Join(hostRoot, filepath.FromSlash(repository.path))
		var commit string
		if repository.path == "." && rootBaseRooted {
			commit, err = CommitBaseRootedPatch(ctx, workspacePath, message, owned)
		} else {
			commit, err = CommitVerifiedPatch(ctx, workspacePath, branch, message, owned)
		}
		if err != nil {
			cleanupPublished()
			return "", integrations, fmt.Errorf("commit repository %s: %w", repository.path, err)
		}
		if err := PushBranchToHost(ctx, workspacePath, hostPath, branch); err != nil {
			cleanupPublished()
			return "", integrations, fmt.Errorf("publish repository %s: %w", repository.path, err)
		}
		published = append(published, repository)
		if repository.path == "." {
			rootCommit = commit
			continue
		}
		integrations = append(integrations, domain.RepositoryIntegration{
			Path: repository.path, Branch: branch, Commit: commit, TargetBranch: repository.targetBranch, BaseCommit: repository.baseCommit,
		})
		parentRelative := strings.TrimPrefix(repository.path, repository.parent+"/")
		groups[repository.parent] = append(groups[repository.parent], parentRelative)
	}
	if rootCommit == "" {
		cleanupPublished()
		return "", integrations, fmt.Errorf("repository tree: root gitlink commit was not created")
	}
	sort.Slice(integrations, func(i, j int) bool { return pathDepth(integrations[i].Path) < pathDepth(integrations[j].Path) })
	return rootCommit, integrations, nil
}

// ValidateRepositoryIntegrations proves every gitlink target is already in the
// matching local submodule object store before the superproject can move.
func ValidateRepositoryIntegrations(ctx context.Context, hostRoot string, integrations []domain.RepositoryIntegration) error {
	root, err := filepath.Abs(hostRoot)
	if err != nil {
		return err
	}
	repositories, err := discoverRepositoryTree(ctx, root)
	if err != nil {
		return err
	}
	registered := make(map[string]bool, len(repositories))
	for _, repository := range repositories {
		registered[repository.path] = true
	}
	for _, integration := range integrations {
		rel := filepath.Clean(filepath.FromSlash(integration.Path))
		if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("invalid nested repository path %q", integration.Path)
		}
		path := filepath.ToSlash(rel)
		if !registered[path] {
			return fmt.Errorf("nested repository %s is not an initialized registered submodule", integration.Path)
		}
		repository := filepath.Join(root, rel)
		topology, err := hostrepo.Inspect(ctx, repository)
		if err != nil {
			return fmt.Errorf("inspect nested repository %s: %w", integration.Path, err)
		}
		if !HasCommit(ctx, repository, integration.Commit) {
			return fmt.Errorf("verified commit %s is missing from nested repository %s", integration.Commit, integration.Path)
		}
		if integration.TargetBranch != "" {
			if topology.Branch != integration.TargetBranch {
				return fmt.Errorf("nested repository %s moved from branch %s to %s", integration.Path, integration.TargetBranch, topology.Branch)
			}
			head, headErr := CurrentHeadSHA(ctx, repository)
			if headErr != nil {
				return fmt.Errorf("resolve nested repository %s HEAD: %w", integration.Path, headErr)
			}
			if integration.BaseCommit != "" && head != integration.BaseCommit {
				return fmt.Errorf("nested repository %s branch %s moved from %s to %s", integration.Path, integration.TargetBranch, integration.BaseCommit, head)
			}
			if integration.BaseCommit != "" {
				if _, ancestorErr := runGit(ctx, repository, "merge-base", "--is-ancestor", integration.BaseCommit, integration.Commit); ancestorErr != nil {
					return fmt.Errorf("verified commit %s cannot fast-forward nested repository %s branch %s", integration.Commit, integration.Path, integration.TargetBranch)
				}
			}
		}
	}
	return nil
}

// MergeRepositoryTreeOnHost merges the superproject candidate and then moves
// every affected submodule on the branch it had when verification started.
// Git's ordinary submodule update checks out a detached HEAD; this branch-aware
// path keeps repositories such as devup, main and master selected.
func MergeRepositoryTreeOnHost(ctx context.Context, hostRoot, branch string, integrations []domain.RepositoryIntegration) (HostMerge, error) {
	return mergeBranchOnHost(ctx, hostRoot, branch, func(before []hostrepo.Submodule) hostrepo.SyncResult {
		return syncRepositoryIntegrations(ctx, hostRoot, before, integrations, false)
	})
}

// RevertRepositoryTreeMerge restores both the superproject and the branches
// advanced in its submodules. It is used only for the exact Apply transaction
// being rolled back, and refuses to move a branch whose HEAD changed meanwhile.
func RevertRepositoryTreeMerge(ctx context.Context, hostRoot, preMergeSHA string, integrations []domain.RepositoryIntegration) (hostrepo.SyncResult, error) {
	before, inspectErr := hostrepo.Inspect(ctx, hostRoot)
	if output, err := runGit(ctx, hostRoot, "reset", "--hard", preMergeSHA); err != nil {
		return hostrepo.SyncResult{}, fmt.Errorf("revert host merge to %s: %s", preMergeSHA, output)
	}
	if inspectErr != nil {
		return hostrepo.SyncResult{}, nil
	}
	return syncRepositoryIntegrations(ctx, hostRoot, before.Submodules, integrations, true), nil
}

func syncRepositoryIntegrations(ctx context.Context, hostRoot string, before []hostrepo.Submodule, integrations []domain.RepositoryIntegration, rollback bool) hostrepo.SyncResult {
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
		head, err := CurrentHeadSHA(ctx, repository)
		if err != nil {
			result.Skipped = append(result.Skipped, hostrepo.SyncSkip{Path: integration.Path, Reason: err.Error()})
			continue
		}
		if integration.TargetBranch == "" {
			if output, checkoutErr := runGit(ctx, repository, "checkout", "--detach", destination); checkoutErr != nil {
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
			if output, moveErr := runGit(ctx, repository, args...); moveErr != nil {
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
	for _, submodule := range before {
		for index := range integrations {
			if integrations[index].Path == submodule.Path {
				destination := integrations[index].Commit
				if rollback {
					destination = integrations[index].BaseCommit
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

func discoverRepositoryTree(ctx context.Context, root string) ([]repositoryNode, error) {
	rootTopology, err := hostrepo.Inspect(ctx, root)
	if err != nil {
		return nil, fmt.Errorf("inspect repository .: %w", err)
	}
	rootHead, _ := CurrentHeadSHA(ctx, root)
	repositories := []repositoryNode{{path: ".", parent: "", targetBranch: rootTopology.Branch, baseCommit: rootHead}}
	for index := 0; index < len(repositories); index++ {
		parent := repositories[index]
		path := filepath.Join(root, filepath.FromSlash(parent.path))
		topology, err := hostrepo.Inspect(ctx, path)
		if err != nil {
			return nil, fmt.Errorf("inspect repository %s: %w", parent.path, err)
		}
		for _, submodule := range topology.Submodules {
			if !submodule.Initialized {
				continue
			}
			child := submodule.Path
			if parent.path != "." {
				child = parent.path + "/" + child
			}
			childPath := filepath.Join(root, filepath.FromSlash(child))
			childTopology, childErr := hostrepo.Inspect(ctx, childPath)
			if childErr != nil {
				return nil, fmt.Errorf("inspect repository %s: %w", child, childErr)
			}
			childHead, headErr := CurrentHeadSHA(ctx, childPath)
			if headErr != nil {
				return nil, fmt.Errorf("resolve repository %s HEAD: %w", child, headErr)
			}
			repositories = append(repositories, repositoryNode{
				path: child, parent: parent.path, targetBranch: childTopology.Branch, baseCommit: childHead,
			})
		}
	}
	return repositories, nil
}

func repositoryForPath(repositories []repositoryNode, path string) repositoryNode {
	owner := repositories[0]
	for _, candidate := range repositories[1:] {
		if path == candidate.path || strings.HasPrefix(path, candidate.path+"/") {
			if len(candidate.path) > len(owner.path) {
				owner = candidate
			}
		}
	}
	return owner
}

func normalizedRepositoryPaths(paths []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		path = filepath.ToSlash(filepath.Clean(path))
		if path == "." || seen[path] {
			continue
		}
		seen[path] = true
		result = append(result, path)
	}
	sort.Strings(result)
	return result
}

func pathDepth(path string) int { return strings.Count(path, "/") + 1 }
