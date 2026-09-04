package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
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
	out.WriteString("The following verified plans are not yet in the host. Any new change plan must be incremental against the state after these patches. Do not repeat them. Wharness will replay the entire ordered chain in a fresh sandbox and Apply or Reject it as one pending candidate.\n")
	for index := range changes {
		change := changes[index]
		fmt.Fprintf(&out, "\nPlan %d: %s — %s\n", index+1, change.Plan.PlanID, change.Plan.Summary)
		for patchIndex, patch := range planPatches(&change.Plan) {
			fmt.Fprintf(&out, "Patch %d:\n```diff\n%s\n```\n", patchIndex+1, truncateRepairText(patch, 24000))
		}
		if out.Len() > 60000 {
			out.WriteString("\n...[pending candidate truncated by Wharness]\n")
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

func pendingPatchCount(changes []domain.PendingHostChange) int {
	total := 0
	for index := range changes {
		total += len(planPatches(&changes[index].Plan))
	}
	return total
}

func pendingHostResolutionBlocked(item domain.Session) bool {
	if item.PlannerInFlight || len(item.PendingManualRequestIDs) > 0 {
		return true
	}
	switch item.State {
	case "awaiting_plan", "workflow_pending", "workflow_planned", "workflow_observed", "repair_pending", "planned", "baseline_update_pending":
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
	if pendingHostResolutionBlocked(item) {
		return item, errors.New("finish the active planner/repair turn before rejecting pending host changes")
	}
	if item.State == "restart_pending" || item.SelfEvolutionActivation == "restart_pending" {
		return item, errors.New("the self-evolution batch is already applied; use the rollback action before restart")
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.PendingHostChanges = nil
		current.Plan = nil
		current.Policy = nil
		current.LastExecution = nil
		current.LastBundle = nil
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		current.LastRepairError = ""
		current.State = "ready"
		return nil
	})
	if err != nil {
		return item, err
	}
	s.resetDevspace(sessionID)
	s.bus.Publish(sessionID, "host.pending_rejected", map[string]any{"plan_count": len(pending), "patch_count": pendingPatchCount(pending)})
	if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
		updated = refreshed
	} else {
		s.bus.Publish(sessionID, "context.refresh_after_reject_failed", map[string]any{"error": refreshErr.Error()})
	}
	return updated, nil
}
