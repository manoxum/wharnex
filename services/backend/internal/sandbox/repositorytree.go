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
	path   string
	parent string
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
		integrations = append(integrations, domain.RepositoryIntegration{Path: repository.path, Branch: branch, Commit: commit})
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
		if _, err := hostrepo.Inspect(ctx, repository); err != nil {
			return fmt.Errorf("inspect nested repository %s: %w", integration.Path, err)
		}
		if !HasCommit(ctx, repository, integration.Commit) {
			return fmt.Errorf("verified commit %s is missing from nested repository %s", integration.Commit, integration.Path)
		}
	}
	return nil
}

func discoverRepositoryTree(ctx context.Context, root string) ([]repositoryNode, error) {
	repositories := []repositoryNode{{path: ".", parent: ""}}
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
			repositories = append(repositories, repositoryNode{path: child, parent: parent.path})
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
