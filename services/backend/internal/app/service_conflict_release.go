package app

import (
	"context"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

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
	if conflict == nil || !conflictThreadIdle(item) {
		return false
	}
	return item.LastRequestID != conflict.RequestID
}

// conflictThreadIdle reports that nothing is still working on the open
// conflict: no planner in flight, no pending manual request for its exact id,
// and no in-progress session state.
func conflictThreadIdle(item domain.Session) bool {
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
	return true
}

// healPendingIntegrationState retires what later rounds already superseded and
// releases an orphaned conflict record (retiring nothing for it), so a session that accumulated either
// one converges on its own instead of needing the operator to discard verified
// work by hand.
//
// It reports what it healed rather than doing it silently: both conditions mean
// earlier rounds left state behind, which is worth seeing in the audit trail.
func (s *Service) healPendingIntegrationState(ctx context.Context, sessionID string, item domain.Session, pending []domain.PendingHostChange) ([]domain.PendingHostChange, domain.Session, error) {
	if kept, alreadyIntegrated := retireAlreadyIntegratedCandidates(ctx, item.ProjectPath, pending); len(alreadyIntegrated) > 0 {
		updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
			current.PendingHostChanges = kept
			// Record what the host proved it carries, not just that it carries
			// something. The applied summary the operator reads is built from
			// these two fields, so settling the state without them leaves the
			// chat showing the failure that stopped it and nothing else — which
			// is indistinguishable, on screen, from still being stuck.
			current.LastAppliedChanges = append(current.LastAppliedChanges, alreadyIntegrated...)
			if current.LastHostAppliedAt.IsZero() {
				current.LastHostAppliedAt = time.Now().UTC()
			}
			return nil
		})
		if err != nil {
			return pending, item, err
		}
		s.bus.Publish(sessionID, "integration.already_integrated", map[string]any{
			"plans": planIDsOf(alreadyIntegrated), "remaining_candidates": len(kept),
			"reason": "the host already contains these candidates, proven by Git ancestry or exact candidate-path worktree state",
		})
		pending, item = kept, updated
	}
	orphan := orphanedIntegrationConflict(item)
	if !orphan && s.integrationConflictDissolved(ctx, item, pending) {
		updated, err := s.releaseDissolvedConflict(sessionID, item)
		if err != nil {
			return pending, item, err
		}
		item = updated
	}
	// An orphan's record is released, but nothing is retired from its
	// candidates: no round will ever deliver a replacement for its paths, so
	// retiring them discarded the candidate's own verified work — production
	// lost a component's implementation this way while keeping the tests
	// written for it. The next Apply measures those paths again from each
	// candidate's request base, and a collision that still exists becomes a
	// fresh capsule carrying the candidate's version.
	retirements := make([]*domain.ConflictResolution, 0, 1)
	if superseded := supersededConflictResolution(item, pending); superseded != nil {
		retirements = append(retirements, superseded)
	}
	if len(retirements) == 0 && !orphan {
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
