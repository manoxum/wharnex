package app

import (
	"context"
	"errors"

	"kernl.local/harness/backend/internal/domain"
)

// plannerRepairableApplyError is the closed authority marker that permits a
// host-Apply failure to consume another planner round.
type plannerRepairableApplyError struct{ cause error }

func (e *plannerRepairableApplyError) Error() string { return e.cause.Error() }
func (e *plannerRepairableApplyError) Unwrap() error { return e.cause }

// localApplyRecoveryError overrides a nested candidate-defect marker when the
// integration engine itself could not finish rollback/recovery. A planner may
// repair source, but it cannot repair Wharnex's transaction or Git machinery.
type localApplyRecoveryError struct{ cause error }

func (e *localApplyRecoveryError) Error() string { return e.cause.Error() }
func (e *localApplyRecoveryError) Unwrap() error { return e.cause }

func localApplyRecoveryFailure(cause error) error {
	if cause == nil {
		return nil
	}
	var local *localApplyRecoveryError
	if errors.As(cause, &local) {
		return cause
	}
	return &localApplyRecoveryError{cause: cause}
}

func plannerRepairableApplyFailure(cause error) error {
	if cause == nil {
		return nil
	}
	var marked *plannerRepairableApplyError
	if errors.As(cause, &marked) {
		return cause
	}
	return &plannerRepairableApplyError{cause: cause}
}

func isPlannerRepairableApplyFailure(cause error) bool {
	var local *localApplyRecoveryError
	if errors.As(cause, &local) {
		return false
	}
	var marked *plannerRepairableApplyError
	return errors.As(cause, &marked)
}

// TriggerApplyFailureRepair either opens the bounded source-repair path or
// projects a known local blocker onto the retained candidate. Projecting the
// blocker is what makes its dedicated Attention action reachable without
// pretending a verified candidate failed sandbox verification.
func (s *Service) TriggerApplyFailureRepair(ctx context.Context, sessionID string, cause error) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if !isPlannerRepairableApplyFailure(cause) {
		kind := classifyExecutionFailure(cause)
		if kind != "" {
			item, err = s.store.Update(sessionID, func(current *domain.Session) error {
				current.FailureKind = kind
				current.LastRepairError = truncateRepairText(cause.Error(), 12000)
				return nil
			})
			if err != nil {
				return item, err
			}
		}
		planID := ""
		if item.LastExecution != nil {
			planID = item.LastExecution.PlanID
		}
		s.bus.Publish(sessionID, "automation.local_recovery_retained", map[string]any{
			"error": cause.Error(), "failure_kind": kind, "plan_id": planID,
		})
		return item, nil
	}
	if item.LastExecution != nil {
		repaired, repairErr := s.prepareRepairRequest(ctx, sessionID, *item.LastExecution, cause)
		if repairErr == nil {
			return repaired, nil
		}
		s.bus.Publish(sessionID, "repair.prepare_failed", map[string]any{"error": repairErr.Error()})
	}
	return item, nil
}

func (s *Service) projectAutomaticApplyFailure(ctx context.Context, sessionID string, result *BundleSubmission, cause error) {
	recovered, err := s.TriggerApplyFailureRepair(ctx, sessionID, cause)
	if err != nil {
		return
	}
	result.Session = recovered
	result.RepairPrepared = recovered.State == "repair_pending" && recovered.LastManualPrompt != ""
}
