// Package submodules reads gitlink topology without retaining ordinary files.
package submodules

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/gitops"
)

// Link is one gitlink recorded in the index, including unregistered entries.
type Link struct {
	Path        string
	CommitSHA   string
	Registered  bool
	Initialized bool
}

func Inspect(ctx context.Context, root string) ([]Link, error) {
	output, err := gitops.IndexGitlinks(ctx, root)
	if err != nil {
		return nil, fmt.Errorf("list index gitlinks: %w", err)
	}
	registered := registeredPaths(ctx, root)
	links := make([]Link, 0)
	for _, entry := range strings.Split(output, "\x00") {
		meta, path, found := strings.Cut(entry, "\t")
		if !found {
			continue
		}
		fields := strings.Fields(meta)
		if len(fields) < 2 {
			continue
		}
		path = filepath.ToSlash(path)
		_, err := os.Lstat(filepath.Join(root, filepath.FromSlash(path), ".git"))
		links = append(links, Link{Path: path, CommitSHA: fields[1], Registered: registered[path], Initialized: err == nil})
	}
	return links, nil
}

func registeredPaths(ctx context.Context, root string) map[string]bool {
	paths := map[string]bool{}
	output, err := gitops.Combined(ctx, root, "config", "-f", ".gitmodules", "--get-regexp", `^submodule\..*\.path$`)
	if err != nil {
		return paths
	}
	for _, line := range strings.Split(output, "\n") {
		if _, value, found := strings.Cut(strings.TrimSpace(line), " "); found {
			paths[filepath.ToSlash(strings.TrimSpace(value))] = true
		}
	}
	return paths
}
