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

func Validate(ctx context.Context, hostRoot string, integrations []domain.RepositoryIntegration) error {
	root, err := filepath.Abs(hostRoot)
	if err != nil {
		return err
	}
	repositories, err := Discover(ctx, root)
	if err != nil {
		return err
	}
	registered := make(map[string]bool, len(repositories))
	for _, repository := range repositories {
		registered[repository.Path] = true
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
		if _, commitErr := gitops.Combined(ctx, repository, "cat-file", "-e", integration.Commit+"^{commit}"); commitErr != nil {
			return fmt.Errorf("verified commit %s is missing from nested repository %s", integration.Commit, integration.Path)
		}
		if integration.BaseCommit == "" {
			return fmt.Errorf("nested repository %s candidate has no recorded base commit", integration.Path)
		}
		if topology.Branch != integration.TargetBranch {
			return fmt.Errorf("nested repository %s checkout moved from branch %q to %q", integration.Path, integration.TargetBranch, topology.Branch)
		}
		head, headErr := head(ctx, repository)
		if headErr != nil {
			return fmt.Errorf("resolve nested repository %s HEAD: %w", integration.Path, headErr)
		}
		if head != integration.BaseCommit {
			return fmt.Errorf("nested repository %s checkout moved from %s to %s", integration.Path, integration.BaseCommit, head)
		}
		if _, forwardErr := gitops.Combined(ctx, repository, "merge-base", "--is-ancestor", integration.BaseCommit, integration.Commit); forwardErr != nil {
			if _, integratedErr := gitops.Combined(ctx, repository, "merge-base", "--is-ancestor", integration.Commit, integration.BaseCommit); integratedErr != nil {
				return fmt.Errorf("verified commit %s is unrelated to nested repository %s base %s", integration.Commit, integration.Path, integration.BaseCommit)
			}
		}
	}
	return nil
}
