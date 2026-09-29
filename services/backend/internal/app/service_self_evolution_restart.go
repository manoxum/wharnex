package app

import (
	"errors"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
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
	if err != nil {
		if settled, accepted, reconcileErr := s.reconcileRestartConfirmation(sessionID); reconcileErr == nil && accepted {
			return settled, nil
		}
		return current, fmt.Errorf("recover pending Wharnex self-evolution transaction: %w", err)
	}
	if err := s.selfEvolution.ScheduleRestart(transaction, sessionID, pending.PlanID); err != nil {
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, pending.PlanID, "restart_pending", "restart confirmation accepted but detached handoff failed: "+err.Error())
		transaction.ReleaseStage()
		return current, fmt.Errorf("schedule Wharnex restart: %w", err)
	}
	_ = s.selfEvolution.RecordStatus(transaction, sessionID, pending.PlanID, "restart_scheduled", "detached restart supervisor accepted the pending self-evolution batch")
	s.updateSelfEvolutionBatchSessions(transaction, "restart_scheduled", "")
	transaction.ReleaseStage()
	updated, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	s.bus.Publish(sessionID, "self_evolution.restart_scheduled", map[string]any{"plan_id": pending.PlanID, "transaction_id": transaction.ID})
	go s.awaitSelfEvolutionActivation(transaction.ID)
	return updated, nil
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
