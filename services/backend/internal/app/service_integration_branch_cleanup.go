package app

import (
	"context"
	"os"
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
		path                string
		sessionIDs          []string
		pendingSessionIDs   []string
		pendingCandidateCnt int
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
		// An archived chat retains nothing: closing it disposes its candidates
		// (ADR-0031). One still holding them was archived before that disposal
		// existed, or while the backend was down, so startup is the second
		// chance to release the branches they are still pinning. The stale
		// records are cleared here too — the branch is about to go, and a
		// restore must not be offered an Apply that can only fail.
		if item.ArchivedAt != nil {
			s.discardArchivedPendingCandidates(item)
			continue
		}
		pendingChanges := hostApplicablePendingChanges(pendingHostChanges(item))
		if len(pendingChanges) > 0 {
			project.pendingSessionIDs = append(project.pendingSessionIDs, item.ID)
			project.pendingCandidateCnt += len(pendingChanges)
		}
		for _, pending := range pendingChanges {
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
		if _, err := os.Stat(project.path); err != nil && os.IsNotExist(err) {
			if project.pendingCandidateCnt > 0 {
				fields := map[string]any{"repository": project.path, "reason": "startup_repository_unavailable", "candidate_count": project.pendingCandidateCnt, "action": "restore_project_root_or_discard_candidate"}
				s.publishIntegrationCleanup(project.pendingSessionIDs, "integration.branch_cleanup_deferred", fields)
			}
			continue
		}
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

// discardArchivedPendingCandidates clears candidates an archived chat is still
// holding, so the sweep that follows treats their branches as the orphans they
// are. The branch deletion itself is left to that sweep rather than repeated
// here: it already reports every refusal per repository, and doing it once
// keeps a single owner for the decision of what is safe to remove.
func (s *Service) discardArchivedPendingCandidates(item domain.Session) {
	if len(pendingHostChanges(item)) == 0 {
		return
	}
	updated, err := s.store.Update(item.ID, func(current *domain.Session) error {
		// Re-read under the store's own lock: a restore may have landed
		// between the listing above and this update, and a reopened chat's
		// candidates are live again.
		if current.ArchivedAt == nil {
			return nil
		}
		current.PendingHostChanges = nil
		return nil
	})
	if err != nil || len(updated.PendingHostChanges) > 0 {
		return
	}
	s.bus.Publish(item.ID, "host.pending_disposed", map[string]any{"reason": "archived_chat_startup_reconcile"})
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
