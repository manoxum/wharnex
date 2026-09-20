package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
)

func messageWithPendingHostChanges(message string, changes []domain.PendingHostChange, applyError string) string {
	if len(changes) == 0 {
		return message
	}
	context := pendingHostChangePrompt(changes)
	if strings.TrimSpace(applyError) != "" {
		context += "\nLAST HOST APPLY ERROR (the attempted patch mutations were rolled back):\n" + truncateRepairText(applyError, 12000) + "\n"
	}
	return message + "\n\n" + context
}

func pendingHostChangePrompt(changes []domain.PendingHostChange) string {
	if len(changes) == 0 {
		return ""
	}
	var out strings.Builder
	out.WriteString("HOST-PENDING PROTECTED CANDIDATE:\n")
	out.WriteString("The following verified plans are not yet in the host. Any new change plan must be incremental against the state after these patches. Do not repeat them. Wharnex will replay the entire ordered chain in a fresh sandbox and Apply or Reject it as one pending candidate.\n")
	for index := range changes {
		change := changes[index]
		fmt.Fprintf(&out, "\nPlan %d: %s — %s\n", index+1, change.Plan.PlanID, change.Plan.Summary)
		for patchIndex, patch := range planPatches(&change.Plan) {
			fmt.Fprintf(&out, "Patch %d:\n```diff\n%s\n```\n", patchIndex+1, truncateRepairText(patch, 24000))
		}
		if out.Len() > 60000 {
			out.WriteString("\n...[pending candidate truncated by Wharnex]\n")
			break
		}
	}
	return out.String()
}

func upsertPendingHostChange(changes []domain.PendingHostChange, next domain.PendingHostChange) []domain.PendingHostChange {
	updated := append([]domain.PendingHostChange(nil), changes...)
	for index := range updated {
		if updated[index].Plan.PlanID == next.Plan.PlanID {
			updated[index] = next
			return updated
		}
	}
	return append(updated, next)
}

func pendingHostChanges(item domain.Session) []domain.PendingHostChange {
	if len(item.PendingHostChanges) > 0 {
		return append([]domain.PendingHostChange(nil), item.PendingHostChanges...)
	}
	// Compatibility for sessions persisted before cumulative pending changes
	// became first-class state.
	if item.State == "verified" && item.Plan != nil && item.LastExecution != nil && item.LastExecution.Success && item.LastExecution.PlanID == item.Plan.PlanID {
		return []domain.PendingHostChange{{Plan: *item.Plan, Execution: *item.LastExecution, VerifiedAt: item.LastExecution.CompletedAt}}
	}
	return nil
}

// planRequiresHostApply reports whether a verified plan can mutate the host.
// Pure verification/answer plans must never join the cumulative host candidate:
// they have no ChangeSet and would force ApplyToHost back onto the legacy
// per-plan baseline path, where an unrelated stale baseline can manufacture a
// repair loop despite the real cumulative candidate already being verified.
func planRequiresHostApply(plan *domain.ExecutionPlan) bool {
	if plan == nil {
		return false
	}
	if len(actualPatchFiles(plan)) > 0 {
		return true
	}
	for _, op := range plan.Operations {
		if op.Type == "command" && policy.HostReplayGitCommand(op.Command) {
			return true
		}
	}
	return false
}

// hostApplicablePendingChanges is both the normal write filter and a migration
// adapter for sessions persisted before verification-only plans were excluded.
// Filtering at read/apply time self-heals already polluted pending chains.
func hostApplicablePendingChanges(changes []domain.PendingHostChange) []domain.PendingHostChange {
	filtered := make([]domain.PendingHostChange, 0, len(changes))
	for _, change := range changes {
		if planRequiresHostApply(&change.Plan) {
			filtered = append(filtered, change)
		}
	}
	return filtered
}

// reconcileStrandedHostApplies finds sessions whose sandbox verification
// already succeeded and durably authorized host integration, but whose
// candidate never reached the host — e.g. the backend exited between
// recording "verified" and running the automatic Apply that follows it in
// the same call. Such a session carries no InterruptedExecution marker: the
// execution itself finished successfully, so nothing else on startup
// recognizes it as needing to resume, and the protocol forbids ever asking
// for a second host-apply approval, so without this it would wait forever.
func (s *Service) reconcileStrandedHostApplies() {
	for _, item := range s.store.List() {
		if !strandedHostApply(item) {
			continue
		}
		sessionID := item.ID
		s.bus.Publish(sessionID, "integration.startup_reconcile_started", map[string]any{"plan_count": len(hostApplicablePendingChanges(pendingHostChanges(item)))})
		go func() {
			if _, err := s.applyToHostWithLocalRetry(context.Background(), sessionID); err != nil {
				s.bus.Publish(sessionID, "integration.startup_reconcile_failed", map[string]any{"error": err.Error()})
				// A reconciled Apply follows the same recovery contract as a
				// foreground Apply. Without this, a source defect discovered by a
				// post-restart host build is rolled back but left as a forever
				// "verified" candidate; infrastructure errors are classified by
				// TriggerApplyFailureRepair and retain their dedicated remedy.
				if _, repairErr := s.TriggerApplyFailureRepair(context.Background(), sessionID, err); repairErr != nil {
					s.bus.Publish(sessionID, "repair.prepare_failed", map[string]any{"error": repairErr.Error(), "source": "startup_apply_reconcile"})
				}
			}
		}()
	}
}

// strandedHostApply reports whether a session's verified candidate is stuck
// with nothing left to finish it. Sandbox verification only reaches "verified"
// after passing the Policy/approval gate that Execute enforces before it ever
// runs a command, so a verified candidate here already carries the informed
// execution consent that authorizes host integration; it is never a second
// approval decision.
func strandedHostApply(item domain.Session) bool {
	if item.ExecutionMode != domain.ExecutionModeProtected {
		return false
	}
	if item.State != "verified" || item.InterruptedExecution != nil {
		return false
	}
	if pendingHostResolutionBlocked(item) {
		return false
	}
	return len(hostApplicablePendingChanges(pendingHostChanges(item))) > 0
}

// normalizePendingHostChanges makes the public/session state use the same
// candidate set as ApplyToHost. This also materializes the legacy implicit
// verified-plan fallback, so the frontend never advertises a raw count that
// Apply later filters to zero (or misses a valid legacy candidate entirely).
func (s *Service) normalizePendingHostChanges() {
	for _, item := range s.store.List() {
		effective := hostApplicablePendingChanges(pendingHostChanges(item))
		if pendingHostChangesEqual(item.PendingHostChanges, effective) {
			continue
		}
		_, _ = s.store.Update(item.ID, func(current *domain.Session) error {
			current.PendingHostChanges = append([]domain.PendingHostChange(nil), effective...)
			return nil
		})
	}
}

func pendingHostChangesEqual(left, right []domain.PendingHostChange) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].Plan.PlanID != right[index].Plan.PlanID {
			return false
		}
	}
	return true
}

func pendingPatchCount(changes []domain.PendingHostChange) int {
	total := 0
	for index := range changes {
		total += len(planPatches(&changes[index].Plan))
	}
	return total
}

func pendingHostResolutionBlocked(item domain.Session) bool {
	if item.PlannerInFlight || len(item.PendingManualRequestIDs) > 0 || item.IntegrationConflict != nil {
		return true
	}
	switch item.State {
	case "awaiting_plan", "workflow_pending", "workflow_planned", "workflow_observed", "repair_pending", "planned", "baseline_update_pending", "conflict_resolution_pending":
		return true
	default:
		return false
	}
}

func (s *Service) rollbackHostPatches(ctx context.Context, projectPath string, patches []string, cause error) error {
	if len(patches) == 0 {
		return cause
	}
	workspace, err := s.hostRunner.Prepare(ctx, projectPath)
	if err != nil {
		return fmt.Errorf("%w; prepare automatic host rollback: %v", cause, err)
	}
	defer s.hostRunner.Cleanup(workspace)
	reverse, ok := s.hostRunner.(sandbox.ReversePatchRunner)
	if !ok {
		return fmt.Errorf("%w; automatic host rollback is unavailable", cause)
	}
	for index := len(patches) - 1; index >= 0; index-- {
		result, reverseErr := reverse.ReversePatch(ctx, workspace, patches[index])
		if reverseErr != nil {
			return fmt.Errorf("%w; automatic host rollback failed: %v", cause, reverseErr)
		}
		if !result.Success {
			return fmt.Errorf("%w; automatic host rollback failed: %s", cause, strings.TrimSpace(result.Stderr))
		}
	}
	return cause
}

func (s *Service) RejectPendingHostChanges(sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if item.ExecutionMode != domain.ExecutionModeProtected {
		return item, errors.New("pending host changes exist only in Protected mode")
	}
	pending := pendingHostChanges(item)
	if len(pending) == 0 {
		return item, errors.New("there are no pending host changes to reject")
	}
	conflictPending := item.State == "conflict_resolution_pending" && item.IntegrationConflict != nil
	if pendingHostResolutionBlocked(item) && !conflictPending {
		return item, errors.New("finish the active planner/repair turn before rejecting pending host changes")
	}
	if item.State == "restart_pending" || item.SelfEvolutionActivation == "restart_pending" {
		return item, errors.New("the self-evolution batch is already applied; use the rollback action before restart")
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if conflictPending {
			current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, current.IntegrationConflict.RequestID)
			current.LastManualPrompt = ""
			current.IntegrationConflict = nil
		}
		current.PendingHostChanges = nil
		current.Plan = nil
		current.Policy = nil
		current.LastExecution = nil
		current.LastBundle = nil
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		clearSessionFailure(current)
		current.State = "ready"
		return nil
	})
	if err != nil {
		return item, err
	}
	s.resetDevspace(sessionID)
	s.bus.Publish(sessionID, "host.pending_rejected", map[string]any{"plan_count": len(pending), "patch_count": pendingPatchCount(pending)})
	if conflictPending {
		s.bus.Publish(sessionID, "conflict.cancelled", map[string]any{"reason": "pending candidate rejected by user"})
	}
	if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
		updated = refreshed
	} else {
		s.bus.Publish(sessionID, "context.refresh_after_reject_failed", map[string]any{"error": refreshErr.Error()})
	}
	return updated, nil
}

// CancelPendingRequest terminates the active remote/planner request while
// preserving durable history and any already verified Protected candidate.
// It makes the conversation available for a new main request.
func (s *Service) CancelPendingRequest(sessionID string) (domain.Session, error) {
	return s.CancelPendingRequestByID(sessionID, "")
}

// CancelPendingRequestByID rejects stale UI actions before releasing the
// session-wide request chain. A session has one active planner chain; clearing
// only one of several legacy pending identifiers would leave Desktop and the
// backend supervising different requests.
func (s *Service) CancelPendingRequestByID(sessionID, requestedID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	requestID := activePendingRequestID(item)
	if requestID == "" || (len(item.PendingManualRequestIDs) == 0 && !item.PlannerInFlight && item.State != "failed" && item.State != "repair_pending" && item.State != "conflict_resolution_pending") {
		return item, errors.New("there is no active request to cancel")
	}
	if requestedID = strings.TrimSpace(requestedID); requestedID != "" && requestedID != requestID {
		return item, fmt.Errorf("request %s is no longer the active request", requestedID)
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.PendingManualRequestIDs = nil
		current.PendingKnowledgeReviewRequestID = ""
		current.LastManualPrompt = ""
		current.PlannerInFlight = false
		current.InterruptedExecution = nil
		if current.Plan != nil && current.Plan.RequestID == requestID {
			current.Plan = nil
			current.Policy = nil
		}
		if current.IntegrationConflict != nil && current.IntegrationConflict.RequestID == requestID {
			current.IntegrationConflict = nil
		}
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		clearSessionFailure(current)
		if len(current.PendingHostChanges) > 0 {
			current.State = "verified"
		} else {
			current.State = "ready"
		}
		return nil
	})
	if err != nil {
		return item, err
	}
	s.releaseSupersededRemoteInputLeases(sessionID, nil)
	s.closeRemoteInputChannel(sessionID, "request.cancelled")
	s.bus.Publish(sessionID, "request.cancelled", map[string]any{"request_id": requestID, "pending_changes_preserved": len(updated.PendingHostChanges)})
	return updated, nil
}

func activePendingRequestID(item domain.Session) string {
	if requestID := strings.TrimSpace(item.PendingKnowledgeReviewRequestID); requestID != "" && containsString(item.PendingManualRequestIDs, requestID) {
		return requestID
	}
	if requestID := strings.TrimSpace(item.LastRequestID); requestID != "" && (containsString(item.PendingManualRequestIDs, requestID) || len(item.PendingManualRequestIDs) == 0) {
		return requestID
	}
	for index := len(item.PendingManualRequestIDs) - 1; index >= 0; index-- {
		if requestID := strings.TrimSpace(item.PendingManualRequestIDs[index]); requestID != "" {
			return requestID
		}
	}
	return ""
}
