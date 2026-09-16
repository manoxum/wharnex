package app

import (
	"context"
	"errors"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
)

var ErrExecutionRecoveryInProgress = errors.New("interrupted execution is already resuming")

type ExecutionRecoveryResponse struct {
	Session domain.Session `json:"session"`
	PlanID  string         `json:"plan_id"`
	Status  string         `json:"status"`
}

func (s *Service) ResumeInterruptedExecution(sessionID string) (ExecutionRecoveryResponse, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return ExecutionRecoveryResponse{}, err
	}
	intent := item.InterruptedExecution
	if intent == nil {
		return ExecutionRecoveryResponse{}, errors.New("no interrupted execution is pending")
	}
	planID := intent.PlanID
	if item.Plan == nil || item.Plan.PlanID != planID {
		return ExecutionRecoveryResponse{}, fmt.Errorf("interrupted plan %s is no longer the active plan", planID)
	}
	if planExecutionAlreadyCompleted(item, planID) {
		cleared, clearErr := s.clearInterruptedExecution(sessionID, planID)
		if clearErr != nil {
			return ExecutionRecoveryResponse{}, clearErr
		}
		s.bus.Publish(sessionID, "execution.recovery_reconciled", map[string]any{"plan_id": planID})
		return ExecutionRecoveryResponse{Session: cleared, PlanID: planID, Status: "reconciled"}, nil
	}

	launch := false
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		currentIntent := current.InterruptedExecution
		if currentIntent == nil || currentIntent.PlanID != planID {
			return errors.New("interrupted execution changed before resume could start")
		}
		if executionRecoveryActive(currentIntent.Status) {
			return nil
		}
		currentIntent.Status = domain.InterruptedExecutionResuming
		currentIntent.LastError = ""
		launch = true
		return nil
	})
	if err != nil {
		return ExecutionRecoveryResponse{}, err
	}
	if launch {
		s.bus.Publish(sessionID, "execution.recovery_resume_requested", map[string]any{"plan_id": planID})
		go s.runInterruptedExecutionResume(sessionID, planID, intent.Approved)
	}
	status := domain.InterruptedExecutionResuming
	if updated.InterruptedExecution != nil && updated.InterruptedExecution.Status != "" {
		status = updated.InterruptedExecution.Status
	}
	return ExecutionRecoveryResponse{Session: updated, PlanID: planID, Status: status}, nil
}

func (s *Service) runInterruptedExecutionResume(sessionID, planID string, approved bool) {
	ctx := context.Background()
	result, _, err := s.executeRecordedForPlan(ctx, sessionID, approved, planID)
	if err != nil {
		s.markInterruptedExecutionFailed(sessionID, planID, err.Error())
		return
	}
	if !result.Success {
		s.markInterruptedExecutionFailed(sessionID, planID, "execution did not complete successfully")
		return
	}
	cleared, err := s.clearInterruptedExecution(sessionID, planID)
	if err != nil {
		s.bus.Publish(sessionID, "execution.recovery_failed", map[string]any{"plan_id": planID, "error": err.Error()})
		return
	}
	// A resumed execution that verified successfully carries the same
	// informed execution consent as an uninterrupted run: Execute already
	// integrates a verified Protected candidate into the host without a
	// second approval, and resuming after an interruption must reach the
	// same outcome instead of stranding the candidate in "verified" with
	// nothing left to prompt the operator to finish it.
	if approved && cleared.ExecutionMode == domain.ExecutionModeProtected && len(hostApplicablePendingChanges(pendingHostChanges(cleared))) > 0 {
		if _, applyErr := s.applyToHostWithLocalRetry(ctx, sessionID); applyErr != nil {
			s.bus.Publish(sessionID, "execution.recovery_apply_failed", map[string]any{"plan_id": planID, "error": applyErr.Error()})
			return
		}
	}
	s.bus.Publish(sessionID, "execution.recovery_completed", map[string]any{"plan_id": planID})
}

func (s *Service) markInterruptedExecutionFailed(sessionID, planID, detail string) {
	updated, updateErr := s.store.Update(sessionID, func(current *domain.Session) error {
		if current.InterruptedExecution != nil && current.InterruptedExecution.PlanID == planID {
			current.InterruptedExecution.Status = domain.InterruptedExecutionFailedRetryable
			current.InterruptedExecution.LastError = detail
		}
		return nil
	})
	data := map[string]any{"plan_id": planID, "error": detail}
	if updateErr != nil {
		data["state_error"] = updateErr.Error()
	} else if updated.InterruptedExecution != nil {
		data["status"] = updated.InterruptedExecution.Status
	}
	s.bus.Publish(sessionID, "execution.recovery_failed", data)
}

func (s *Service) markInterruptedExecutionAwaitingDecision(sessionID, planID string) (domain.Session, error) {
	return s.store.Update(sessionID, func(current *domain.Session) error {
		if current.InterruptedExecution != nil && current.InterruptedExecution.PlanID == planID {
			current.InterruptedExecution.Status = domain.InterruptedExecutionAwaitingDecision
		}
		return nil
	})
}

func executionRecoveryActive(status string) bool {
	return status == domain.InterruptedExecutionRunning || status == domain.InterruptedExecutionResuming
}
