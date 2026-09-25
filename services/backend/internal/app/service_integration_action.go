package app

import (
	"context"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// integrationActionTimeout bounds the local reaction to a planner that
// declared an integration-layer blocker. A proven re-Apply of a self-evolving
// project rebuilds Wharnex itself, which is the long pole.
const integrationActionTimeout = 30 * time.Minute

// scheduleIntegrationAction reacts to a planner outcome classified as
// integration_action_required without holding up the bundle submission that
// delivered it.
func (s *Service) scheduleIntegrationAction(sessionID, requestID, reasonCode string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), integrationActionTimeout)
		defer cancel()
		s.recoverIntegrationAction(ctx, sessionID, requestID, reasonCode)
	}()
}

// recoverIntegrationAction performs the step the planner proved only the
// integration layer can take.
//
// On 2026-09-25 two planners returned exactly that diagnosis — a pending
// candidate that failed to replay before their plan ran, and a capsule a
// legacy candidate kept recreating — and asked for "a fresh capsule from the
// current replay failure, or an explicit re-anchor". Both ended as
// planner_guidance_required, which waits for an operator who has nothing to
// add. The engine can do what was asked:
//
//   - when the whole batch is now proven to integrate, re-apply it (the same
//     bounded resume the periodic sweep performs);
//   - otherwise, when a conflict thread is open, rebuild its capsule from the
//     live host and ask again, bounded by the thread's own attempt budget.
//
// Only Protected sessions with automatic approval are acted on, like the
// sweep; anything else keeps the failure for the operator, now named.
func (s *Service) recoverIntegrationAction(ctx context.Context, sessionID, requestID, reasonCode string) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return
	}
	pending := hostApplicablePendingChanges(pendingHostChanges(item))
	event := map[string]any{"request_id": requestID, "reason_code": reasonCode, "candidates": len(pending)}
	if integrationRecoveryEligible(item) && s.integrationConflictReleasable(ctx, item, pending) && pendingBatchProvenClean(ctx, item.ProjectPath, pending) {
		event["action"] = "reapply"
		s.bus.Publish(sessionID, "integration.action_started", event)
		s.resumeParkedIntegration(ctx, item, pending)
		return
	}
	automatic := item.ExecutionMode == domain.ExecutionModeProtected && domain.AutomationModeIsAutomatic(item.AutomationMode)
	if item.IntegrationConflict != nil && automatic && !item.PlannerInFlight {
		event["action"] = "capsule_rebuild"
		s.bus.Publish(sessionID, "integration.action_started", event)
		if _, err := s.refreshConflictCapsule(ctx, sessionID, item); err != nil {
			event["error"] = err.Error()
			s.bus.Publish(sessionID, "integration.action_failed", event)
		}
		return
	}
	event["reason"] = "no candidate batch is proven to integrate and no conflict thread is open to rebuild; the operator decides the next step"
	s.bus.Publish(sessionID, "integration.action_unavailable", event)
}
