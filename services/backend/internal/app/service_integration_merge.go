package app

import (
	"context"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

func (s *Service) mergeIntegrationBranches(ctx context.Context, sessionID, projectPath string, pending []domain.PendingHostChange) (integrated []integratedCandidate, preMergeSHA string, failedPlanID string, err error) {
	originalHead, err := sandbox.CurrentHeadSHA(ctx, projectPath)
	if err != nil {
		return nil, "", "", fmt.Errorf("resolve host HEAD before merge: %w", err)
	}
	preMergeSHA = originalHead
	if planID, conflict := s.preflightIntegrationBatch(ctx, sessionID, projectPath, pending); conflict != nil {
		return nil, preMergeSHA, planID, conflict
	}
	for index := range pending {
		branch := pending[index].IntegrationBranch
		if branch == "" {
			continue
		}
		planID := pending[index].Plan.PlanID
		// A missing anchor is intentionally harmless: BaseContinuationPaths
		// degrades to the ordinary merge path when the ref cannot be read.
		requestBaseRef := sandbox.RequestBaseRef(pending[index].Plan.RequestID)
		s.bus.Publish(sessionID, "integration.merge_started", map[string]any{"plan_id": planID, "branch": branch})
		// Ask Git whether this merge can succeed before letting it touch the
		// host at all. A doomed merge would otherwise still commit the host's
		// dirty tree as a pre-merge snapshot on its way to aborting, leaving a
		// bookkeeping commit behind for a merge that never happened.
		// The gitlinks this candidate's own nested repositories will move are
		// excluded from the advisory preflight. The superproject branch records
		// each submodule at the commit verification produced, so a dry-run merge
		// of the superproject alone reports a pointer conflict whenever that
		// submodule moved on either side — which is precisely the case this
		// mechanism exists to handle, and which the repository-tree transaction
		// reconciles locally. Counting it as an ordinary conflict
		// would abort a legitimate integration and hand a planner a commit id to
		// patch, which the validator rejects on arrival every round.
		conflict, preflightErr := sandbox.PreflightMergeIntoHostExcept(ctx, projectPath, branch, requestBaseRef, submoduleIntegrationPaths(pending[index].SubmoduleIntegrations))
		if preflightErr != nil {
			// The preflight is advisory, so its failure never blocks a merge —
			// but it is no longer allowed to be silent. It failing means the
			// host's shape defeated it, which is worth knowing precisely
			// because the same measurement underpins request-base rooting.
			s.bus.Publish(sessionID, "integration.merge_preflight_degraded", map[string]any{"plan_id": planID, "branch": branch, "error": preflightErr.Error()})
		} else if conflict != nil {
			s.bus.Publish(sessionID, "integration.merge_preflight_conflict", map[string]any{"plan_id": planID, "branch": branch, "paths": conflict.Paths})
			return integrated, preMergeSHA, planID, conflict
		}
		merge, mergeErr := sandbox.MergeRepositoryTreeOnHost(ctx, projectPath, branch, requestBaseRef, pending[index].SubmoduleIntegrations, s.projectCommitIdentity(ctx, projectPath))
		s.publishHostStatePreservation(sessionID, planID, merge.Preservation)
		// Preserve() may have committed an operator's dirty tree immediately
		// before the first merge. That snapshot is the true rollback boundary:
		// resetting to originalHead would erase the very work preservation was
		// designed to protect, which is what made successful auto commits appear
		// to vanish after a later verification/build failure.
		if len(integrated) == 0 && merge.PreMergeSHA != "" {
			preMergeSHA = merge.PreMergeSHA
		}
		if mergeErr != nil {
			return integrated, preMergeSHA, planID, mergeErr
		}
		s.publishSubmoduleSync(sessionID, planID, "merge", merge.SubmoduleSync)
		afterSHA, headErr := sandbox.CurrentHeadSHA(ctx, projectPath)
		if headErr != nil {
			return integrated, preMergeSHA, planID, fmt.Errorf("resolve host HEAD after merge: %w", headErr)
		}
		plan := pending[index].Plan
		integrated = append(integrated, integratedCandidate{
			planID:     planID,
			requestID:  plan.RequestID,
			sessionID:  sessionID,
			branch:     branch,
			beforeSHA:  merge.PreMergeSHA,
			afterSHA:   afterSHA,
			message:    commitMessageForPlan(&plan),
			paths:      rootIntegrationPaths(&plan, pending[index].SubmoduleIntegrations),
			submodules: append([]domain.RepositoryIntegration(nil), pending[index].SubmoduleIntegrations...),
		})
		s.bus.Publish(sessionID, "integration.merge_completed", map[string]any{"plan_id": planID, "branch": branch})
	}
	return integrated, preMergeSHA, "", nil
}

// preflightIntegrationBatch simulates the whole batch before the first merge
// (sandbox.PreflightIntegrationChain). A candidate that would stop the batch is
// reported before any candidate reaches the host, so a conflict never has to
// be undone by a revert. An unanswerable simulation is advisory only: the
// per-candidate preflight and the real merges remain authoritative.
func (s *Service) preflightIntegrationBatch(ctx context.Context, sessionID, projectPath string, pending []domain.PendingHostChange) (string, *sandbox.MergeConflictError) {
	candidates := make([]sandbox.ChainCandidate, 0, len(pending))
	owners := make([]int, 0, len(pending))
	for index := range pending {
		if pending[index].IntegrationBranch == "" {
			continue
		}
		candidates = append(candidates, sandbox.ChainCandidate{
			Branch:           pending[index].IntegrationBranch,
			RequestBaseRef:   sandbox.RequestBaseRef(pending[index].Plan.RequestID),
			IntegratingUnits: submoduleIntegrationPaths(pending[index].SubmoduleIntegrations),
		})
		owners = append(owners, index)
	}
	if len(candidates) < 2 {
		return "", nil
	}
	failed, conflict, supported, err := sandbox.PreflightIntegrationChain(ctx, projectPath, candidates)
	if err != nil || !supported {
		detail := "git cannot simulate the batch"
		if err != nil {
			detail = err.Error()
		}
		s.bus.Publish(sessionID, "integration.batch_preflight_degraded", map[string]any{"candidates": len(candidates), "error": detail})
		return "", nil
	}
	if conflict == nil {
		return "", nil
	}
	change := pending[owners[failed]]
	s.bus.Publish(sessionID, "integration.batch_preflight_conflict", map[string]any{
		"plan_id": change.Plan.PlanID, "branch": change.IntegrationBranch, "paths": conflict.Paths,
		"position": failed + 1, "candidates": len(candidates),
	})
	return change.Plan.PlanID, conflict
}

// undoBatchMerges reverts the merges an Apply batch already made when a later
// step of the same batch fails before verification. The failure used to be
// discarded, and in production a revert that did not happen left two merged,
// never-verified candidates on the host with nothing recording why. A failed
// undo is now published, so the operator learns the host is not where the
// Apply claims it left it.
func (s *Service) undoBatchMerges(ctx context.Context, sessionID, planID, projectPath, preMergeSHA string, merged []integratedCandidate) {
	if len(merged) == 0 {
		return
	}
	if err := s.revertHostMerge(ctx, sessionID, planID, projectPath, preMergeSHA, integratedSubmodules(merged, true)); err != nil {
		s.bus.Publish(sessionID, "integration.batch_revert_failed", map[string]any{
			"plan_id": planID, "pre_merge_sha": preMergeSHA, "merged_branches": len(merged), "error": err.Error(),
			"remedy": "the host still carries this batch's earlier merges; reset it to pre_merge_sha once no other Git process is running, or apply again",
		})
		return
	}
	s.bus.Publish(sessionID, "integration.batch_reverted", map[string]any{"plan_id": planID, "pre_merge_sha": preMergeSHA, "merged_branches": len(merged)})
}
