package app

import (
	"errors"

	"kernl.local/harness/backend/internal/domain"
)

// RejectExecutionPlan dismisses an executable proposal before it has started.
// It is intentionally distinct from rejecting an already verified host
// candidate, which has its own lifecycle and cleanup path.
func (s *Service) RejectExecutionPlan(sessionID string) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	if current.Plan == nil || current.State != "planned" {
		return current, errors.New("no unexecuted plan is awaiting a decision")
	}
	if current.InterruptedExecution != nil || planExecutionAlreadyCompleted(current, current.Plan.PlanID) {
		return current, errors.New("the plan already started and cannot be rejected as an unexecuted proposal")
	}
	planID := current.Plan.PlanID
	requestID := current.Plan.RequestID
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		item.Plan = nil
		item.Policy = nil
		item.LastExecution = nil
		item.State = "plan_rejected"
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "plan.execution_rejected", map[string]any{"plan_id": planID, "request_id": requestID})
		s.closeRemoteInputChannel(sessionID, "plan.execution_rejected")
	}
	return updated, err
}
