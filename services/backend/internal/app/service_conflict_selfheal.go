package app

import (
	"context"

	"kernl.local/harness/backend/internal/domain"
)

// supersededConflictResolution reconstructs, from durable request lineage,
// which pending candidates a conflict-resolution round has already replaced.
//
// It exists because the record that used to carry this — the session's single
// IntegrationConflict slot — could be overwritten by a later collision before
// the retirement it was supposed to drive ever ran. The superseded candidate
// then kept its conflicting content, collided again on the next Apply, and each
// round added yet another candidate for the same path instead of replacing one.
// A session could reach Apply holding three candidates all claiming one file,
// which no merge can reconcile and no planner round can resolve: every Apply
// reproduced the same collision, and the two threads alternated indefinitely.
//
// Lineage is the deliberate criterion, never path overlap. Two independent
// candidates that happen to touch one file are an ordinary three-way merge and
// must stay one. Only a candidate that is itself the conflict resolution of
// another request may supersede that request's candidate, and only for the
// paths it actually writes.
//
// The result is shaped as a ConflictResolution so it drives the same retirement
// the live path already uses, rather than growing a second implementation of it.
func supersededConflictResolution(item domain.Session, pending []domain.PendingHostChange) *domain.ConflictResolution {
	if len(pending) < 2 || len(item.RequestLineages) == 0 {
		return nil
	}
	planForRequest := make(map[string]string, len(pending))
	pathsForPlan := make(map[string][]string, len(pending))
	for _, change := range pending {
		requestID := change.Plan.RequestID
		if requestID == "" {
			continue
		}
		planForRequest[requestID] = change.Plan.PlanID
		pathsForPlan[change.Plan.PlanID] = actualPatchFiles(&change.Plan)
	}
	supersededPaths := map[string]struct{}{}
	supersededPlans := map[string]struct{}{}
	for _, change := range pending {
		lineage, ok := item.RequestLineages[change.Plan.RequestID]
		if !ok || lineage.Kind != requestKindConflict {
			continue
		}
		resolved := pathsForPlan[change.Plan.PlanID]
		if len(resolved) == 0 {
			continue
		}
		for _, ancestorPlan := range pendingAncestorPlans(item, planForRequest, lineage.ParentRequestID, change.Plan.PlanID) {
			ancestorPaths := pathsForPlan[ancestorPlan]
			for _, path := range resolved {
				if !containsString(ancestorPaths, path) {
					continue
				}
				supersededPaths[path] = struct{}{}
				supersededPlans[ancestorPlan] = struct{}{}
			}
		}
	}
	if len(supersededPaths) == 0 {
		return nil
	}
	return &domain.ConflictResolution{
		Paths:           sortedKeys(supersededPaths),
		OriginalPlanIDs: sortedKeys(supersededPlans),
	}
}

// pendingAncestorPlans walks a resolution's lineage upwards and returns every
// ancestor request that still has a pending candidate of its own.
//
// The walk is bounded by the lineage map itself and skips the resolution's own
// plan: a candidate never supersedes itself, and a chain of resolutions
// (r1 -> r2 -> r3) must retire every earlier link, not only the nearest one.
func pendingAncestorPlans(item domain.Session, planForRequest map[string]string, parentRequestID, selfPlanID string) []string {
	plans := make([]string, 0, 2)
	seen := map[string]bool{}
	for requestID := parentRequestID; requestID != "" && !seen[requestID]; {
		seen[requestID] = true
		if planID, ok := planForRequest[requestID]; ok && planID != selfPlanID {
			plans = append(plans, planID)
		}
		lineage, ok := item.RequestLineages[requestID]
		if !ok {
			break
		}
		requestID = lineage.ParentRequestID
	}
	return plans
}

// orphanedIntegrationConflict reports a conflict record whose resolution round
// can no longer arrive.
//
// A conflict record is cleared only by the exact request it was created for, so
// a thread that moved on — a repair round taken instead, a superseding request,
// a resolution that never completed — left the record behind forever. Because
// pendingHostResolutionBlocked refuses Apply while any record exists, that
// orphan blocked every later Apply on the project with no expiry and no other
// way out, parking verified work permanently.
//
// The predicate is deliberately narrow: a genuinely live conflict always has
// its own round outstanding, as an in-flight planner, a pending manual request
// for that exact id, or an in-progress session state.
func orphanedIntegrationConflict(item domain.Session) bool {
	conflict := item.IntegrationConflict
	if conflict == nil || item.PlannerInFlight {
		return false
	}
	for _, requestID := range item.PendingManualRequestIDs {
		if requestID == conflict.RequestID {
			return false
		}
	}
	switch item.State {
	case "awaiting_plan", "workflow_pending", "workflow_planned", "workflow_observed",
		"repair_pending", "planned", "baseline_update_pending", "conflict_resolution_pending":
		return false
	}
	return item.LastRequestID != conflict.RequestID
}

// healPendingIntegrationState retires what later rounds already superseded and
// releases an orphaned conflict record, so a session that accumulated either
// one converges on its own instead of needing the operator to discard verified
// work by hand.
//
// It reports what it healed rather than doing it silently: both conditions mean
// earlier rounds left state behind, which is worth seeing in the audit trail.
func (s *Service) healPendingIntegrationState(ctx context.Context, sessionID string, item domain.Session, pending []domain.PendingHostChange) ([]domain.PendingHostChange, domain.Session, error) {
	orphan := orphanedIntegrationConflict(item)
	retirements := make([]*domain.ConflictResolution, 0, 2)
	if orphan {
		retirements = append(retirements, item.IntegrationConflict)
	}
	if superseded := supersededConflictResolution(item, pending); superseded != nil {
		retirements = append(retirements, superseded)
	}
	if len(retirements) == 0 {
		return pending, item, nil
	}
	healed := pending
	retiredBranches := make([]string, 0, 2)
	for _, retirement := range retirements {
		next, branches, err := retireConflictingMutations(ctx, item.ProjectPath, item.Context.Manifest.SHA256, healed, retirement)
		if err != nil {
			// Healing is best effort: a candidate that cannot be rebuilt is left
			// exactly as it was, because refusing the Apply over it would
			// reproduce the very deadlock this exists to clear.
			s.bus.Publish(sessionID, "integration.selfheal_degraded", map[string]any{
				"paths": retirement.Paths, "plans": retirement.OriginalPlanIDs, "error": err.Error(),
			})
			continue
		}
		healed = next
		retiredBranches = append(retiredBranches, branches...)
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if orphan && current.IntegrationConflict != nil && current.IntegrationConflict.ID == item.IntegrationConflict.ID {
			current.IntegrationConflict = nil
			current.ConflictAttempt = 0
		}
		current.PendingHostChanges = healed
		return nil
	})
	if err != nil {
		return pending, item, err
	}
	s.bus.Publish(sessionID, "integration.selfheal_applied", map[string]any{
		"orphaned_conflict_released": orphan, "retired_branches": retiredBranches,
		"remaining_candidates": len(healed),
	})
	s.deleteIntegrationBranches(ctx, sessionID, item.ProjectPath, retiredBranches)
	return healed, updated, nil
}
