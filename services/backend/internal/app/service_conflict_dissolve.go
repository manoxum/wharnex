package app

import (
	"context"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// integrationConflictDissolved reports an idle conflict record that the live
// host no longer reproduces: every pending candidate is proven, by Git's own
// merge from that candidate's request base, to integrate with no
// planner-resolvable conflict.
//
// Such a record is not a disagreement waiting for a resolver. It is a
// measurement taken by an earlier merge — typically from the wrong base
// before adr/ADR-0077, or against operator work that has since moved on — and
// it still blocks every Apply. It differs from an orphan in the one way that
// matters: its round did arrive, so the orphan rule leaves it in place, and
// nothing else ever would.
//
// Proof is strict. An unanswerable preflight, a candidate that is neither a
// branch nor plain patches that apply to the host as it stands, or an
// operator's manual resolution in the record all keep it, because releasing a
// live conflict would integrate a collision.
func (s *Service) integrationConflictDissolved(ctx context.Context, item domain.Session, pending []domain.PendingHostChange) bool {
	conflict := item.IntegrationConflict
	if conflict == nil || conflict.Git != nil || len(conflict.ManualPaths) > 0 || !conflictThreadIdle(item) || len(pending) == 0 {
		return false
	}
	for _, change := range pending {
		if change.IntegrationBranch == "" {
			if !patchCandidateAppliesToHost(ctx, item.ProjectPath, change) {
				return false
			}
			continue
		}
		requestBaseRef := sandbox.RequestBaseRef(change.Plan.RequestID)
		units := submoduleIntegrationPaths(change.SubmoduleIntegrations)
		if !sandbox.MergeIntoHostProvenClean(ctx, item.ProjectPath, change.IntegrationBranch, requestBaseRef, units) {
			return false
		}
	}
	return true
}

// releaseDissolvedConflict drops the record and nothing else. Unlike an
// orphan's release, no candidate mutation is retired: the candidates were just
// proven to integrate whole, so retiring their conflicting paths would discard
// verified work for a collision that no longer exists.
func (s *Service) releaseDissolvedConflict(sessionID string, item domain.Session) (domain.Session, error) {
	conflict := item.IntegrationConflict
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if current.IntegrationConflict != nil && current.IntegrationConflict.ID == conflict.ID {
			current.IntegrationConflict = nil
			current.ConflictAttempt = 0
		}
		return nil
	})
	if err != nil {
		return item, err
	}
	s.bus.Publish(sessionID, "integration.conflict_dissolved", map[string]any{
		"conflict_id": conflict.ID, "request_id": conflict.RequestID, "paths": conflict.Paths,
		"reason": "every pending candidate now integrates cleanly from its own request base against the live host",
	})
	return updated, nil
}

// patchCandidateAppliesToHost proves a branchless candidate — one an earlier
// retirement narrowed to plain patch bytes — the only way such a candidate can
// be proven: every one of its patches applies to the host's working tree.
// A legacy ChangeSet candidate has no such proof and is never counted clean.
func patchCandidateAppliesToHost(ctx context.Context, projectPath string, change domain.PendingHostChange) bool {
	patches := planPatches(&change.Plan)
	if change.ChangeSet != nil || len(patches) == 0 {
		return false
	}
	for _, patch := range patches {
		if !sandbox.PatchAppliesToHost(ctx, projectPath, patch) {
			return false
		}
	}
	return true
}
