package app

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

const (
	planControlActive    = "active"
	planControlPaused    = "paused"
	planControlSuspended = "suspended"
)

// planControlState is intentionally backward compatible: sessions persisted
// before the control existed behave as active until the operator pauses them.
func planControlState(item domain.Session, planID string) string {
	if item.PlanControl == nil || item.PlanControl.PlanID != planID || strings.TrimSpace(item.PlanControl.State) == "" {
		return planControlActive
	}
	return item.PlanControl.State
}

func planExecutionHeld(item domain.Session, planID string) bool {
	state := planControlState(item, planID)
	return state == planControlPaused || state == planControlSuspended
}

func planAlreadyApplied(item domain.Session, planID string) bool {
	for _, change := range item.LastAppliedChanges {
		if change.Plan.PlanID == planID {
			return true
		}
	}
	return false
}

func resetPlanControl(item *domain.Session, planID string) {
	if item == nil || strings.TrimSpace(planID) == "" {
		return
	}
	if item.PlanControl != nil && item.PlanControl.PlanID == planID {
		return
	}
	item.PlanControl = &domain.PlanExecutionControl{PlanID: planID, State: planControlActive, UpdatedAt: time.Now().UTC()}
}

// ControlExecutionPlan changes only the pre-host-apply execution gate. Pause
// and suspend never delete the plan or its verified candidate, so the operator
// can inspect the exact proposal and resume it later without rebuilding it.
func (s *Service) ControlExecutionPlan(sessionID, action string) (domain.Session, error) {
	action = strings.ToLower(strings.TrimSpace(action))
	if action != "pause" && action != "resume" && action != "suspend" {
		return domain.Session{}, fmt.Errorf("unsupported execution-plan control action %q", action)
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	if current.Plan == nil || strings.TrimSpace(current.Plan.PlanID) == "" {
		return current, errors.New("no execution plan is available")
	}
	planID := current.Plan.PlanID
	if planAlreadyApplied(current, planID) {
		return current, errors.New("the active plan was already applied to the host")
	}
	next := planControlActive
	switch action {
	case "pause":
		next = planControlPaused
	case "suspend":
		next = planControlSuspended
	case "resume":
		next = planControlActive
	}
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		if item.Plan == nil || item.Plan.PlanID != planID {
			return errors.New("execution plan changed before its control state could be updated")
		}
		if planAlreadyApplied(*item, planID) {
			return errors.New("the active plan was already applied to the host")
		}
		item.PlanControl = &domain.PlanExecutionControl{PlanID: planID, State: next, UpdatedAt: time.Now().UTC()}
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "plan.control_changed", map[string]any{"plan_id": planID, "action": action, "state": next})
	}
	return updated, err
}

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
		item.PlanControl = nil
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
