package committing

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/gitops"
)

// pathsToStage leaves already-staged deletions in the index. Git add cannot
// match a path absent from both index and disk, even though HEAD still owns it
// and git commit -- <path> can commit its deletion. Renames have the same old
// path. A recreated file must still be staged so its current content wins.
func pathsToStage(ctx context.Context, root string, paths []string, failure Failure) ([]string, error) {
	args := append([]string{"diff", "--cached", "--diff-filter=D", "--no-renames", "--name-only", "-z", "--"}, literalPaths(paths)...)
	output, err := gitops.Output(ctx, root, args...)
	if err != nil {
		return nil, failure(output, "inspect staged deletions")
	}
	deleted := make(map[string]bool)
	for _, path := range strings.Split(output, "\x00") {
		if path != "" {
			deleted[path] = true
		}
	}
	stage := make([]string, 0, len(paths))
	for _, path := range paths {
		if deleted[filepath.ToSlash(filepath.Clean(path))] {
			_, statErr := os.Lstat(filepath.Join(root, path))
			if os.IsNotExist(statErr) {
				continue
			}
			if statErr != nil {
				return nil, fmt.Errorf("inspect selected worktree path %s: %w", path, statErr)
			}
		}
		stage = append(stage, path)
	}
	return stage, nil
}

func literalPaths(paths []string) []string {
	result := make([]string, len(paths))
	for i, path := range paths {
		result[i] = ":(literal)" + path
	}
	return result
}
