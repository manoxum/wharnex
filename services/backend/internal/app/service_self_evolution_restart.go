package app

import (
	"errors"
	"fmt"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/selfevolution"
)

func (s *Service) RestartSelfEvolution(sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if !s.isSelfEvolution(item) || !restartConfirmationPending(item) {
		return item, errors.New("no Wharnex self-evolution restart is pending confirmation")
	}

	// The detached supervisor can finish while a confirmation request is in
	// flight. Reconcile its durable status before trying to claim a batch that
	// may already have been finalized by this or another session.
	current, alreadyAccepted, err := s.reconcileRestartConfirmation(sessionID)
	if err != nil {
		return item, err
	}
	if alreadyAccepted {
		return current, nil
	}
	if !restartConfirmationPending(current) {
		return current, errors.New("no Wharnex self-evolution restart is pending confirmation")
	}

	transaction, pending, err := s.selfEvolution.ClaimPendingForSession(sessionID)
	coveredByCurrentBatch := false
	restartSessionID := sessionID
	if err != nil {
		if settled, accepted, reconcileErr := s.reconcileRestartConfirmation(sessionID); reconcileErr == nil && accepted {
			return settled, nil
		}
		coveringTransaction, coveringPending, status, coveringErr := s.selfEvolution.ClaimPendingBatch()
		if coveringErr == nil {
			if pendingBatchCoversRestartConfirmation(current, status) {
				transaction = coveringTransaction
				pending = coveringPending
				restartSessionID = coveringPending.SessionID
				coveredByCurrentBatch = true
				err = nil
			} else {
				coveringTransaction.ReleaseStage()
			}
		}
		if err != nil {
			return current, fmt.Errorf("recover pending Wharnex self-evolution transaction: %w", err)
		}
	}
	if err := s.selfEvolution.ScheduleRestart(transaction, restartSessionID, pending.PlanID); err != nil {
		_ = s.selfEvolution.RecordStatus(transaction, restartSessionID, pending.PlanID, "restart_pending", "restart confirmation accepted but detached handoff failed: "+err.Error())
		transaction.ReleaseStage()
		return current, fmt.Errorf("schedule Wharnex restart: %w", err)
	}
	_ = s.selfEvolution.RecordStatus(transaction, restartSessionID, pending.PlanID, "restart_scheduled", "detached restart supervisor accepted the pending self-evolution batch")
	s.updateSelfEvolutionBatchSessions(transaction, "restart_scheduled", "")
	if coveredByCurrentBatch {
		_, _, _ = s.updateSessionIfChanged(sessionID, func(stale *domain.Session) error {
			if !restartConfirmationPending(*stale) {
				return nil
			}
			stale.SelfEvolutionActivation = "restart_scheduled"
			stale.SelfEvolutionImpacts = append([]string(nil), transaction.ActivationImpacts...)
			if stale.State == "restart_pending" || stale.State == "restart_scheduled" {
				stale.State = "restart_scheduled"
				clearSessionFailure(stale)
			}
			return nil
		})
	}
	transaction.ReleaseStage()
	updated, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	s.bus.Publish(sessionID, "self_evolution.restart_scheduled", map[string]any{
		"plan_id": pending.PlanID, "transaction_id": transaction.ID, "covered_by_current_batch": coveredByCurrentBatch,
	})
	go s.awaitSelfEvolutionActivation(transaction.ID)
	return updated, nil
}

func pendingBatchCoversRestartConfirmation(item domain.Session, status selfevolution.Status) bool {
	if status.Phase != "restart_pending" || item.LastHostAppliedAt.IsZero() || !restartConfirmationPending(item) {
		return false
	}
	pendingAt, err := time.Parse(time.RFC3339, status.UpdatedAt)
	if err != nil {
		return false
	}
	// Durable status timestamps are second-granularity. Compare the persisted
	// host-apply time at the same precision so an older apply completed within
	// that same second is not falsely treated as newer than the pending batch.
	return !item.LastHostAppliedAt.UTC().Truncate(time.Second).After(pendingAt)
}

func restartConfirmationPending(item domain.Session) bool {
	return item.SelfEvolutionActivation == "restart_pending" || item.State == "restart_pending"
}

func (s *Service) reconcileRestartConfirmation(sessionID string) (domain.Session, bool, error) {
	s.reconcileSelfEvolutionStatus()
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, false, err
	}
	status, err := s.selfEvolution.LastStatus()
	if err != nil {
		return current, false, nil
	}
	switch status.Phase {
	case "restart_scheduled", "restarting":
		return current, current.SelfEvolutionActivation == "restart_scheduled", nil
	case "restarted":
		return current, !restartConfirmationPending(current) && current.SelfEvolutionActivation == "", nil
	default:
		return current, false, nil
	}
}
