package repositorytree

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

type Node struct {
	Path         string
	Parent       string
	TargetBranch string
	BaseCommit   string
}

func Discover(ctx context.Context, root string) ([]Node, error) {
	rootTopology, err := hostrepo.Inspect(ctx, root)
	if err != nil {
		return nil, fmt.Errorf("inspect repository .: %w", err)
	}
	rootHead, _ := head(ctx, root)
	repositories := []Node{{Path: ".", Parent: "", TargetBranch: rootTopology.Branch, BaseCommit: rootHead}}
	for index := 0; index < len(repositories); index++ {
		parent := repositories[index]
		path := filepath.Join(root, filepath.FromSlash(parent.Path))
		topology, err := hostrepo.Inspect(ctx, path)
		if err != nil {
			return nil, fmt.Errorf("inspect repository %s: %w", parent.Path, err)
		}
		for _, submodule := range topology.Submodules {
			if !submodule.Initialized {
				continue
			}
			child := submodule.Path
			if parent.Path != "." {
				child = parent.Path + "/" + child
			}
			childPath := filepath.Join(root, filepath.FromSlash(child))
			childTopology, childErr := hostrepo.Inspect(ctx, childPath)
			if childErr != nil {
				return nil, fmt.Errorf("inspect repository %s: %w", child, childErr)
			}
			childHead, headErr := head(ctx, childPath)
			if headErr != nil {
				return nil, fmt.Errorf("resolve repository %s HEAD: %w", child, headErr)
			}
			repositories = append(repositories, Node{
				Path: child, Parent: parent.Path, TargetBranch: childTopology.Branch, BaseCommit: childHead,
			})
		}
	}
	return repositories, nil
}

func ForPath(repositories []Node, path string) Node {
	owner := repositories[0]
	for _, candidate := range repositories[1:] {
		if path == candidate.Path || strings.HasPrefix(path, candidate.Path+"/") {
			if len(candidate.Path) > len(owner.Path) {
				owner = candidate
			}
		}
	}
	return owner
}

func NormalizePaths(paths []string) []string {
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

func Depth(path string) int { return strings.Count(path, "/") + 1 }
