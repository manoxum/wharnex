package app

import (
	"context"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/sandbox"
)

// retireAlreadyIntegratedCandidates drops the pending candidates the host
// already contains.
//
// Apply is not otherwise idempotent: a candidate keeps its pending record even
// after its integration commit reached HEAD, so a later Apply merges it again
// and — for a self-evolution candidate — reruns a full host rebuild for work
// that is already there. A real chat stalled on exactly that shape: its merge
// succeeded, the rebuild that follows was killed for want of memory, the
// failure was recorded against a candidate that had in fact landed, and the
// session sat holding it indefinitely.
//
// Containment is proven by Git ancestry or by an exact comparison between the
// candidate commit's changed paths and the current worktree. The latter is the
// durable proof needed by manual commit mode, where HEAD intentionally moves
// back while the verified files remain on disk.
func retireAlreadyIntegratedCandidates(ctx context.Context, projectPath string, pending []domain.PendingHostChange) (kept, retired []domain.PendingHostChange) {
	kept = make([]domain.PendingHostChange, 0, len(pending))
	for _, change := range pending {
		alreadyIntegrated := false
		if change.IntegrationCommit != "" {
			alreadyIntegrated = sandbox.CommitIsAncestorOfHead(ctx, projectPath, change.IntegrationCommit)
			if !alreadyIntegrated {
				// Manual commit mode intentionally resets HEAD after integration and
				// leaves the verified result as uncommitted work. A restart can
				// therefore see a still-pending durable candidate whose commit is
				// not an ancestor even though applying it again would duplicate the
				// exact change already present on disk. Compare only the paths the
				// candidate commit changed; unrelated dirty work must not affect the
				// proof. Any inspection error degrades safely to keeping the
				// candidate and following the normal Apply path.
				alreadyIntegrated, _ = hostrepo.WorktreeMatchesCommitPaths(ctx, projectPath, change.IntegrationCommit)
			}
		}
		if alreadyIntegrated {
			retired = append(retired, change)
			continue
		}
		kept = append(kept, change)
	}
	return kept, retired
}

// planIDsOf names candidates for an audit event.
func planIDsOf(changes []domain.PendingHostChange) []string {
	ids := make([]string, 0, len(changes))
	for _, change := range changes {
		ids = append(ids, change.Plan.PlanID)
	}
	return ids
}

// appliedEvidenceMissing reports an applied session that cannot show what it
// applied.
//
// The applied summary is inserted into the chat only when the session carries
// both the moment it was applied and the changes it applied. A session that
// reached `applied` without them therefore renders as though it were still
// stuck on whatever failure preceded it: the work is on the host, and the chat
// shows an error and no way forward.
//
// The reconstruction below is only offered when the session still holds the
// successful execution and the very plan that execution ran, so the evidence is
// recovered from its own record rather than invented.
func appliedEvidenceMissing(item domain.Session) bool {
	return item.State == "applied" &&
		len(item.LastAppliedChanges) == 0 &&
		item.Plan != nil && item.LastExecution != nil &&
		item.LastExecution.Success && item.LastExecution.PlanID == item.Plan.PlanID
}

// repairAppliedEvidence restores an applied session's record of what it
// applied, so the chat stops showing the failure that preceded it.
func (s *Service) repairAppliedEvidence(item domain.Session) {
	if !appliedEvidenceMissing(item) {
		return
	}
	appliedAt := item.LastExecution.CompletedAt
	if appliedAt.IsZero() {
		appliedAt = time.Now().UTC()
	}
	restored := domain.PendingHostChange{
		Plan: *item.Plan, Execution: *item.LastExecution, VerifiedAt: appliedAt,
	}
	updated, err := s.store.Update(item.ID, func(current *domain.Session) error {
		if !appliedEvidenceMissing(*current) {
			return nil
		}
		current.LastAppliedChanges = []domain.PendingHostChange{restored}
		if current.LastHostAppliedAt.IsZero() {
			current.LastHostAppliedAt = appliedAt
		}
		return nil
	})
	if err != nil {
		s.bus.Publish(item.ID, "integration.applied_evidence_repair_failed", map[string]any{"error": err.Error()})
		return
	}
	s.bus.Publish(item.ID, "integration.applied_evidence_repaired", map[string]any{
		"plan_id": item.Plan.PlanID, "applied_at": updated.LastHostAppliedAt,
		"reason": "an applied session must be able to show what it applied",
	})
}

// settleAlreadyIntegratedApply closes an Apply that has nothing left to do.
//
// Reaching this point means every candidate was either already contained in the
// host or superseded by a later round, both proven rather than assumed. The
// session is therefore settled rather than refused: a chat whose work is on the
// host must not keep offering an Apply that can only fail, which is how one
// session ended up parked indefinitely holding a candidate the host already had.
//
// The failure recorded by whatever earlier attempt stopped is cleared for the
// same reason — it describes a step that no longer has anything to act on.
func (s *Service) settleAlreadyIntegratedApply(sessionID string, item domain.Session) (domain.Session, error) {
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.PendingHostChanges = nil
		current.State = "applied"
		// A settle the operator cannot see is not a settle. The applied summary
		// is rendered only when both of these carry something, so a state flip
		// without them leaves the chat displaying the failure that stopped it.
		if current.LastHostAppliedAt.IsZero() {
			current.LastHostAppliedAt = time.Now().UTC()
		}
		clearSessionFailure(current)
		return nil
	})
	if err != nil {
		return item, err
	}
	s.bus.Publish(sessionID, "host.apply_settled", map[string]any{
		"state": updated.State, "applied_changes": len(updated.LastAppliedChanges),
		"reason": "no candidate remained to integrate: the host already contains this work",
	})
	return updated, nil
}

// recordHostApplyFailure persists an Apply failure together with its
// classification, and publishes both.
//
// The execution path has classified its own failures for some time — a sandbox
// that ran out of memory or disk is named as such, keeps its candidate, and
// hands the operator a host-side remedy, because no source change is its fix.
// Apply never did any of that: it recorded the raw message and returned. A
// session whose host build was OOM-killed (`signal: killed`) therefore stayed
// in `verified` with a verified candidate, an empty FailureKind, no published
// remedy and no retry — a chat that had done all its work and then silently
// stopped, which is the deadlock shape the recovery invariant exists to forbid.
//
// The session state is deliberately left alone. `verified` is the truth — the
// candidate really is verified and really can be applied again once the
// operator clears the host condition — and it is also the state Apply accepts,
// so naming the cause must not cost the session its way back.
func (s *Service) recordHostApplyFailure(sessionID, planID string, failure error, rolledBackPatches int) (domain.Session, error) {
	kind := classifyExecutionFailure(failure)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastRepairError = failure.Error()
		if kind != "" {
			current.FailureKind = kind
		}
		return nil
	})
	s.bus.Publish(sessionID, "host.apply_failed", map[string]any{
		"plan_id": planID, "error": failure.Error(),
		"rolled_back_patch_count": rolledBackPatches, "failure_kind": kind,
	})
	return updated, err
}

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
