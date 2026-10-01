package selfevolution

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func (m *Manager) LastStatus() (Status, error) {
	if !m.Enabled() {
		return Status{}, errors.New("Wharnex runtime root is not available")
	}
	data, err := os.ReadFile(filepath.Join(m.root, ".harness", "self-evolution", "status"))
	if err != nil {
		return Status{}, err
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			values[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return Status{
		Phase: values["phase"], SessionID: values["session_id"], PlanID: values["plan_id"],
		Transaction: values["transaction"], UpdatedAt: values["updated_at"], Detail: values["detail"],
	}, nil
}

func (m *Manager) PendingTransaction(sessionID, planID string) (Transaction, error) {
	if !m.Enabled() {
		return Transaction{}, errors.New("Wharnex runtime root is not available")
	}
	status, err := m.LastStatus()
	if err != nil || !extendablePendingPhase(status.Phase) {
		return Transaction{}, errors.New("matching self-evolution restart transaction is not pending")
	}
	tx, err := m.transactionFromStatus(status)
	if err != nil {
		return Transaction{}, err
	}
	plans, err := tx.PendingPlans()
	if err != nil {
		return Transaction{}, err
	}
	if len(plans) == 0 && status.SessionID == sessionID && status.PlanID == planID {
		return tx, nil
	}
	for _, pending := range plans {
		if pending.SessionID == sessionID && pending.PlanID == planID {
			return tx, nil
		}
	}
	return Transaction{}, errors.New("matching self-evolution restart transaction is not pending")
}

func (m *Manager) PendingPlanForSession(sessionID string) (Transaction, PendingPlan, error) {
	if !m.Enabled() {
		return Transaction{}, PendingPlan{}, errors.New("Wharnex runtime root is not available")
	}
	status, err := m.LastStatus()
	if err != nil || !extendablePendingPhase(status.Phase) {
		return Transaction{}, PendingPlan{}, errors.New("matching self-evolution restart transaction is not pending")
	}
	tx, err := m.transactionFromStatus(status)
	if err != nil {
		return Transaction{}, PendingPlan{}, err
	}
	plans, err := tx.PendingPlans()
	if err != nil {
		return Transaction{}, PendingPlan{}, err
	}
	for index := len(plans) - 1; index >= 0; index-- {
		if plans[index].SessionID == sessionID {
			return tx, plans[index], nil
		}
	}
	if len(plans) == 0 && status.SessionID == sessionID {
		return tx, PendingPlan{SessionID: sessionID, PlanID: status.PlanID}, nil
	}
	return Transaction{}, PendingPlan{}, errors.New("matching self-evolution restart transaction is not pending")
}

func (m *Manager) ClaimPendingForSession(sessionID string) (Transaction, PendingPlan, error) {
	tx, pending, err := m.PendingPlanForSession(sessionID)
	if err != nil {
		return Transaction{}, PendingPlan{}, err
	}
	stageLockPath := filepath.Join(m.root, ".harness", "self-evolution", "stage.lock")
	if err := acquireLock(stageLockPath); err != nil {
		return Transaction{}, PendingPlan{}, ErrBusy
	}
	status, err := m.LastStatus()
	if err != nil || !extendablePendingPhase(status.Phase) || status.Transaction != "txn-"+tx.ID {
		_ = os.Remove(stageLockPath)
		return Transaction{}, PendingPlan{}, ErrBusy
	}
	tx.stageLockPath = stageLockPath
	return tx, pending, nil
}

// ClaimPendingBatch claims the currently pending restart batch without
// requiring the caller's session to be a member. This is used only to recover
// an older stranded restart confirmation after a newer pending batch has
// already rebuilt the cumulative host tree. The returned pending plan is the
// member named by the durable status so the supervisor handoff remains tied to
// the batch that actually owns the stage lock.
func (m *Manager) ClaimPendingBatch() (Transaction, PendingPlan, Status, error) {
	if !m.Enabled() {
		return Transaction{}, PendingPlan{}, Status{}, errors.New("Wharnex runtime root is not available")
	}
	stageLockPath := filepath.Join(m.root, ".harness", "self-evolution", "stage.lock")
	if err := acquireLock(stageLockPath); err != nil {
		return Transaction{}, PendingPlan{}, Status{}, ErrBusy
	}
	releaseStage := func() {
		_ = os.Remove(stageLockPath)
	}

	status, err := m.LastStatus()
	if err != nil || !extendablePendingPhase(status.Phase) {
		releaseStage()
		return Transaction{}, PendingPlan{}, Status{}, errors.New("matching self-evolution restart transaction is not pending")
	}
	tx, err := m.transactionFromStatus(status)
	if err != nil {
		releaseStage()
		return Transaction{}, PendingPlan{}, Status{}, err
	}
	plans, err := tx.PendingPlans()
	if err != nil {
		releaseStage()
		return Transaction{}, PendingPlan{}, Status{}, err
	}
	for index := len(plans) - 1; index >= 0; index-- {
		pending := plans[index]
		if pending.SessionID == status.SessionID && pending.PlanID == status.PlanID {
			tx.stageLockPath = stageLockPath
			return tx, pending, status, nil
		}
	}
	if len(plans) == 0 && status.SessionID != "" && status.PlanID != "" {
		tx.stageLockPath = stageLockPath
		return tx, PendingPlan{SessionID: status.SessionID, PlanID: status.PlanID}, status, nil
	}
	releaseStage()
	return Transaction{}, PendingPlan{}, Status{}, errors.New("matching self-evolution restart transaction is not pending")
}

func (m *Manager) ClaimPendingTransaction(sessionID, planID string) (Transaction, error) {
	tx, err := m.PendingTransaction(sessionID, planID)
	if err != nil {
		return Transaction{}, err
	}
	stageLockPath := filepath.Join(m.root, ".harness", "self-evolution", "stage.lock")
	if err := acquireLock(stageLockPath); err != nil {
		return Transaction{}, ErrBusy
	}
	status, err := m.LastStatus()
	if err != nil || !extendablePendingPhase(status.Phase) || status.Transaction != "txn-"+tx.ID {
		_ = os.Remove(stageLockPath)
		return Transaction{}, ErrBusy
	}
	tx.stageLockPath = stageLockPath
	return tx, nil
}
