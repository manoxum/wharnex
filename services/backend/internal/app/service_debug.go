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

func debugAuthorized(item domain.Session) bool {
	if item.Plan == nil || item.Plan.Debug == nil {
		return false
	}
	return item.DebugEnabled || item.DebugApprovedRootID == debugRootRequestID(item, item.Plan.RequestID)
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
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		item.DebugApprovedRootID = rootID
		item.State = "workflow_planned"
		return nil
	})
	if err != nil {
		return BundleSubmission{Session: current}, err
	}
	s.bus.Publish(sessionID, "debug.approved", map[string]any{"root_request_id": rootID, "target": updated.Plan.Debug.Target})
	return s.runWorkflowLoop(ctx, sessionID, "debug_approved")
}
