package app

import (
	"context"
	"errors"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
)

func (s *Service) SetDebugEnabled(sessionID string, enabled bool) (domain.Session, error) {
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.DebugEnabled = enabled
		// A mode transition starts a new authorization posture. In particular,
		// turning Debug off mid-chain must not convert the former standing grant
		// into an implicit one-request grant that the operator never gave.
		current.DebugApprovedRootID = ""
		current.DebugApprovedPlanID = ""
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "debug.mode_changed", map[string]any{"enabled": enabled})
	}
	return item, err
}

func debugRootRequestID(item domain.Session, requestID string) string {
	if lineage, ok := item.RequestLineages[requestID]; ok && lineage.RootRequestID != "" {
		return lineage.RootRequestID
	}
	return requestID
}

func debugPlanAuthorized(item domain.Session, plan *domain.ExecutionPlan) bool {
	if plan == nil || plan.Debug == nil {
		return false
	}
	if plan.Debug.Target == "host" && plan.Debug.EffectiveAccess() == domain.DebugAccessModify {
		return item.DebugApprovedPlanID == plan.PlanID
	}
	return item.DebugEnabled || item.DebugApprovedRootID == debugRootRequestID(item, plan.RequestID)
}

func debugAuthorized(item domain.Session) bool {
	return debugPlanAuthorized(item, item.Plan)
}

func (s *Service) ApproveDebug(ctx context.Context, sessionID string) (BundleSubmission, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	if current.Plan == nil || current.Plan.Debug == nil || current.State != "debug_approval_required" {
		return BundleSubmission{Session: current}, errors.New("no debug flow is awaiting approval")
	}
	if err := protocol.ValidateWorkflowPlan(*current.Plan); err != nil {
		return BundleSubmission{Session: current}, err
	}
	rootID := debugRootRequestID(current, current.Plan.RequestID)
	access := current.Plan.Debug.EffectiveAccess()
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		if current.Plan.Debug.Target == "host" && access == domain.DebugAccessModify {
			item.DebugApprovedPlanID = current.Plan.PlanID
		} else {
			item.DebugApprovedRootID = rootID
		}
		item.State = "workflow_planned"
		return nil
	})
	if err != nil {
		return BundleSubmission{Session: current}, err
	}
	s.bus.Publish(sessionID, "debug.approved", map[string]any{"root_request_id": rootID, "plan_id": updated.Plan.PlanID, "target": updated.Plan.Debug.Target, "access": updated.Plan.Debug.EffectiveAccess()})
	return s.runWorkflowLoop(ctx, sessionID, "debug_approved")
}
