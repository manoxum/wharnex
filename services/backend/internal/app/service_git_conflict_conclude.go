package app

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

// concludeGitConflict applies a planner resolution to the real Git merge it
// was asked about, and commits the merge.
//
// This deliberately does not route through the Protected sandbox. The product
// here is a merge commit the operator explicitly asked for, on their own
// branch, and the planner's authority is narrowed to the conflicting paths
// alone — validateConflictResolutionPlan refuses any patch outside the
// capsule. Sandbox-verifying it would mean reconstructing the half-merged tree
// inside a container to run commands the operator never requested, and would
// still not make the merge itself safer: what makes it safe is that it is
// bounded, path-restricted, and trivially inspectable as a single commit the
// operator can reset.
func (s *Service) concludeGitConflict(ctx context.Context, sessionID string, item domain.Session, plan *domain.ExecutionPlan) (domain.Session, error) {
	resolution := item.IntegrationConflict
	gitContext := resolution.Git
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()

	patches := planPatches(plan)
	if len(patches) == 0 && len(resolution.ManualPaths) != len(resolution.Paths) {
		return item, fmt.Errorf("a Git conflict resolution must carry a patch or manual decision for: %s", strings.Join(resolution.Paths, ", "))
	}
	if gitContext.Origin == domain.GitConflictOriginRemoteMerge {
		return s.concludeRemoteGitConflictLocked(ctx, sessionID, item, plan, patches)
	}
	if err := hostrepo.BeginMergeResolution(ctx, item.ProjectPath, gitContext.Ref, resolution.Paths); err != nil {
		return item, err
	}
	workspace, err := s.hostRunner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		hostrepo.AbortMerge(ctx, item.ProjectPath)
		return item, err
	}
	defer s.hostRunner.Cleanup(workspace)
	for _, patch := range patches {
		result, applyErr := s.hostRunner.ApplyPatch(ctx, workspace, patch)
		if applyErr != nil || !result.Success {
			hostrepo.AbortMerge(ctx, item.ProjectPath)
			detail := strings.TrimSpace(result.Stderr)
			if applyErr != nil {
				detail = applyErr.Error()
			}
			return item, fmt.Errorf("apply Git conflict resolution: %s", detail)
		}
	}
	message := gitMergeCommitMessage(gitContext, resolution, plan)
	sha, err := hostrepo.CompleteMergeResolution(ctx, item.ProjectPath, resolution.Paths, message, s.projectCommitIdentity(ctx, item.ProjectPath))
	if err != nil {
		hostrepo.AbortMerge(ctx, item.ProjectPath)
		return item, err
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.IntegrationConflict = nil
		current.ConflictAttempt = 0
		current.State = "ready"
		current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, plan.RequestID)
		current.LastManualPrompt = ""
		clearSessionFailure(current)
		return nil
	})
	if err != nil {
		return item, err
	}
	s.bus.Publish(sessionID, "git.conflict_resolved", map[string]any{
		"conflict_id": resolution.ID, "commit": sha, "ref": gitContext.Ref, "origin": gitContext.Origin,
		"note": "the merge is committed locally; publishing it remains an explicit push",
	})
	return updated, nil
}

func (s *Service) concludeRemoteGitConflictLocked(ctx context.Context, sessionID string, item domain.Session, plan *domain.ExecutionPlan, patches []string) (domain.Session, error) {
	resolution := item.IntegrationConflict
	gitContext := resolution.Git
	if len(gitContext.SourceRefs) == 0 {
		return item, fmt.Errorf("remote merge conflict is missing its ordered source refs")
	}
	identity := s.projectCommitIdentity(ctx, item.ProjectPath)
	remoteWorkspace, err := hostrepo.PrepareRemoteMergeResolution(ctx, item.ProjectPath, gitContext.TargetBranch, gitContext.SourceRefs, gitContext.Ref, resolution.Paths, identity)
	if err != nil {
		return item, err
	}
	defer hostrepo.CleanupRemoteMergeResolution(item.ProjectPath, remoteWorkspace)
	workspace, err := s.hostRunner.Prepare(ctx, remoteWorkspace.Path)
	if err != nil {
		return item, err
	}
	defer s.hostRunner.Cleanup(workspace)
	for _, patch := range patches {
		result, applyErr := s.hostRunner.ApplyPatch(ctx, workspace, patch)
		if applyErr != nil || !result.Success {
			detail := strings.TrimSpace(result.Stderr)
			if applyErr != nil {
				detail = applyErr.Error()
			}
			return item, fmt.Errorf("apply remote Git conflict resolution: %s", detail)
		}
	}
	message := gitMergeCommitMessage(gitContext, resolution, plan)
	if _, err := hostrepo.CompleteMergeResolution(ctx, remoteWorkspace.Path, resolution.Paths, message, identity); err != nil {
		return item, err
	}
	result, err := hostrepo.FinishRemoteMergeResolutionWithPush(ctx, item.ProjectPath, remoteWorkspace, gitRemotePushCommit, identity)
	if err != nil {
		return item, err
	}
	if result.PushOutcome != "pushed" && result.PushOutcome != "up_to_date" {
		return item, fmt.Errorf("remote merge resolution could not publish %s: %s", gitContext.TargetBranch, result.PushOutcome)
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.IntegrationConflict = nil
		current.ConflictAttempt = 0
		current.State = "ready"
		current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, plan.RequestID)
		current.LastManualPrompt = ""
		clearSessionFailure(current)
		return nil
	})
	if err != nil {
		return item, err
	}
	s.bus.Publish(sessionID, "git.conflict_resolved", map[string]any{
		"conflict_id": resolution.ID, "commit": result.CommitSHA, "ref": gitContext.Ref, "origin": gitContext.Origin,
		"target": gitContext.TargetBranch, "push_outcome": result.PushOutcome,
	})
	return updated, nil
}

// gitMergeCommitMessage records what was merged, what had to be reconciled and
// that the reconciliation was AI-assisted — so the commit is honest about its
// own provenance when someone reads the history later.
func gitMergeCommitMessage(gitContext *domain.GitConflictContext, resolution *domain.ConflictResolution, plan *domain.ExecutionPlan) string {
	target := firstNonEmpty(gitContext.TargetBranch, "the current branch")
	body := []string{
		fmt.Sprintf("Conflicts reconciled with Wharnex assistance on: %s", strings.Join(resolution.Paths, ", ")),
	}
	if summary := strings.TrimSpace(plan.Summary); summary != "" {
		body = append(body, "", summary)
	}
	body = append(body, "", fmt.Sprintf("Conflict-Id: %s", resolution.ID), fmt.Sprintf("Request-Id: %s", plan.RequestID))
	return fmt.Sprintf("Merge %s into %s\n\n%s", gitContext.Ref, target, strings.Join(body, "\n"))
}
