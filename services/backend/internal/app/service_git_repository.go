package app

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

type gitRepositoryContextKey struct{}

// WithGitRepository scopes one Git-surface request to a measured repository
// inside the project. The empty path selects the superproject. The path is
// validated against hostrepo.InspectUnits before any Git command runs, so a
// caller cannot use this surface as an arbitrary filesystem selector.
func WithGitRepository(ctx context.Context, repository string) context.Context {
	return context.WithValue(ctx, gitRepositoryContextKey{}, normalizeGitRepositoryPath(repository))
}

// GitRepository describes one repository selectable by the Git UI. Paths are
// always project-relative; the superproject uses the empty path.
type GitRepository struct {
	Path          string `json:"path"`
	Label         string `json:"label"`
	Depth         int    `json:"depth"`
	Root          bool   `json:"root"`
	Initialized   bool   `json:"initialized"`
	Available     bool   `json:"available"`
	Unavailable   string `json:"unavailable,omitempty"`
	CurrentBranch string `json:"current_branch,omitempty"`
	Detached      bool   `json:"detached"`
	CommitSHA     string `json:"commit_sha,omitempty"`
}

func normalizeGitRepositoryPath(path string) string {
	path = filepath.ToSlash(strings.TrimSpace(path))
	path = strings.TrimPrefix(path, "./")
	path = strings.Trim(path, "/")
	if path == "." {
		return ""
	}
	return path
}

func requestedGitRepository(ctx context.Context) string {
	value, _ := ctx.Value(gitRepositoryContextKey{}).(string)
	return normalizeGitRepositoryPath(value)
}

// gitRepositoryRoot resolves the repository selected by the request and also
// returns the full measured inventory used by the frontend selector.
func (s *Service) gitRepositoryRoot(ctx context.Context, projectPath string) (root string, path string, repositories []GitRepository, err error) {
	units, err := hostrepo.InspectUnits(ctx, projectPath)
	if err != nil {
		return "", "", nil, err
	}
	requested := requestedGitRepository(ctx)
	selected := -1
	repositories = make([]GitRepository, 0, len(units.List))
	for index, unit := range units.List {
		entry := GitRepository{
			Path: unit.Path, Label: unit.Label(), Depth: unit.Depth, Root: unit.IsRoot(),
			Initialized: unit.Initialized, Available: unit.Integrable(), Unavailable: unit.Unmeasurable,
		}
		if unit.Measured {
			entry.CurrentBranch = unit.Topology.Branch
			entry.Detached = unit.Topology.Detached
			entry.CommitSHA, _ = hostrepo.HeadSHA(ctx, unit.Root)
		}
		repositories = append(repositories, entry)
		if unit.Path == requested {
			selected = index
		}
	}
	if selected < 0 {
		return "", "", repositories, fmt.Errorf("unknown project repository %q", requested)
	}
	unit := units.List[selected]
	if !unit.Integrable() {
		detail := strings.TrimSpace(unit.Unmeasurable)
		if detail == "" {
			detail = "the repository has no usable checkout"
		}
		return "", unit.Path, repositories, fmt.Errorf("repository %s is unavailable: %s", unit.Label(), detail)
	}
	return unit.Root, unit.Path, repositories, nil
}
