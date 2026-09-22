package app

import (
	"context"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/sandbox"
)

const integrationBranchPrefix = "whx/req_"

// reconcileGitIntegrationStartup cleans temporary integration refs before
// resuming any verified host Apply. The ordering prevents startup recovery
// from publishing work while the orphan sweep is deciding what is durable.
func (s *Service) reconcileGitIntegrationStartup() {
	s.reconcileOrphanedIntegrationBranches()
	s.reconcileStrandedHostApplies()
}

// reconcileOrphanedIntegrationBranches removes Wharnex-owned temporary refs
// that survived a prior process lifetime without deleting branches that still
// back a durable pending candidate.
func (s *Service) reconcileOrphanedIntegrationBranches() {
	type cleanupProject struct {
		path       string
		sessionIDs []string
	}
	projects := map[string]*cleanupProject{}
	keep := map[string]map[string]struct{}{}
	for _, item := range s.store.List() {
		projectPath := integrationRepositoryKey(item.ProjectPath)
		if projectPath == "" {
			continue
		}
		project := projects[projectPath]
		if project == nil {
			project = &cleanupProject{path: projectPath}
			projects[projectPath] = project
		}
		project.sessionIDs = append(project.sessionIDs, item.ID)
		for _, pending := range hostApplicablePendingChanges(pendingHostChanges(item)) {
			retainIntegrationBranch(keep, projectPath, pending.IntegrationBranch)
			for _, integration := range pending.SubmoduleIntegrations {
				repository := filepath.Join(projectPath, filepath.FromSlash(integration.Path))
				retainIntegrationBranch(keep, repository, integration.Branch)
			}
		}
	}

	ctx := context.Background()
	seenRepositories := map[string]struct{}{}
	for _, project := range projects {
		units, err := hostrepo.InspectUnits(ctx, project.path)
		if err != nil {
			s.publishIntegrationCleanup(project.sessionIDs, "integration.branch_cleanup_failed", map[string]any{"error": err.Error(), "reason": "startup_repository_inventory"})
			continue
		}
		for _, unit := range units.List {
			if !unit.Integrable() {
				continue
			}
			repositoryRoot := integrationRepositoryKey(unit.Root)
			if _, seen := seenRepositories[repositoryRoot]; seen {
				continue
			}
			seenRepositories[repositoryRoot] = struct{}{}
			branches, err := hostrepo.Branches(ctx, unit.Root)
			if err != nil {
				s.publishIntegrationCleanup(project.sessionIDs, "integration.branch_cleanup_failed", map[string]any{"repository": unit.Label(), "error": err.Error(), "reason": "startup_branch_inventory"})
				continue
			}
			for _, branch := range branches {
				if branch.Remote != "" || !strings.HasPrefix(branch.Name, integrationBranchPrefix) {
					continue
				}
				if retainedIntegrationBranch(keep, repositoryRoot, branch.Name) {
					continue
				}
				fields := map[string]any{"branch": branch.Name, "repository": unit.Label()}
				if branch.Current {
					fields["error"] = "temporary integration branch is currently checked out"
					fields["reason"] = "startup_orphan_reconcile"
					s.publishIntegrationCleanup(project.sessionIDs, "integration.branch_cleanup_failed", fields)
					continue
				}
				if err := sandbox.DeleteHostBranch(ctx, unit.Root, branch.Name); err != nil {
					fields["error"] = err.Error()
					fields["reason"] = "startup_orphan_reconcile"
					s.publishIntegrationCleanup(project.sessionIDs, "integration.branch_cleanup_failed", fields)
					continue
				}
				s.publishIntegrationCleanup(project.sessionIDs, "integration.branch_cleanup_reconciled", fields)
			}
		}
	}
}

func integrationRepositoryKey(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if absolute, err := filepath.Abs(path); err == nil {
		return filepath.Clean(absolute)
	}
	return filepath.Clean(path)
}

func retainIntegrationBranch(keep map[string]map[string]struct{}, repositoryRoot, branch string) {
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return
	}
	repositoryRoot = integrationRepositoryKey(repositoryRoot)
	branches := keep[repositoryRoot]
	if branches == nil {
		branches = map[string]struct{}{}
		keep[repositoryRoot] = branches
	}
	branches[branch] = struct{}{}
}

func retainedIntegrationBranch(keep map[string]map[string]struct{}, repositoryRoot, branch string) bool {
	_, ok := keep[integrationRepositoryKey(repositoryRoot)][branch]
	return ok
}

func (s *Service) publishIntegrationCleanup(sessionIDs []string, event string, fields map[string]any) {
	for _, sessionID := range sessionIDs {
		s.bus.Publish(sessionID, event, fields)
	}
}

func (s *Service) cleanupFailedIntegrationPublish(ctx context.Context, sessionID string, item domain.Session, result domain.ExecutionResult, integrationBranch string, submodules []domain.RepositoryIntegration, cause error) (domain.ExecutionResult, domain.Session, error) {
	if integrationBranch != "" {
		s.deleteIntegrationBranches(ctx, sessionID, item.ProjectPath, []string{integrationBranch})
	}
	if len(submodules) > 0 {
		s.deleteSubmoduleIntegrationBranches(ctx, sessionID, item.ProjectPath, submodules)
	}
	return result, item, cause
}
