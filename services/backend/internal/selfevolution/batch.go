package selfevolution

import (
	"context"
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/sandbox"
	"os"
	"path/filepath"
)

func (m *Manager) prepareNewBatch(base, lockPath, stageLockPath, sessionID, planID string, patches []string) (Transaction, error) {
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(stageLockPath)
			_ = os.Remove(lockPath)
		}
	}()
	id := transactionID()
	dir := filepath.Join(base, "txn-"+id)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return Transaction{}, fmt.Errorf("create transaction: %w", err)
	}
	tx := Transaction{ID: id, Root: m.root, Dir: dir, Worker: filepath.Join(dir, "worker.sh"), RollbackScript: filepath.Join(dir, "rollback.sh"), ActivationImpacts: activationImpacts(patches), lockPath: lockPath, stageLockPath: stageLockPath}
	// Best-effort: a host with no Git repository (development-only local
	// sandbox mode) leaves PreTransactionSHA empty, which simply disables
	// the overlap safety check in Rollback below rather than blocking
	// self-evolution.
	if sha, shaErr := sandbox.CurrentHeadSHA(context.Background(), m.root); shaErr == nil {
		tx.PreTransactionSHA = sha
	}
	if err := m.RecordStatus(tx, sessionID, planID, "preparing", "capturing rollback baseline for pending self-evolution batch"); err != nil {
		_ = os.RemoveAll(dir)
		return Transaction{}, err
	}
	if err := tx.captureSource(patches); err != nil {
		_ = os.RemoveAll(dir)
		return Transaction{}, err
	}
	if err := tx.captureRuntime(); err != nil {
		_ = os.RemoveAll(dir)
		return Transaction{}, err
	}
	if err := tx.captureLifecycleScripts(); err != nil {
		_ = os.RemoveAll(dir)
		return Transaction{}, err
	}
	if err := tx.writeMetadata(sessionID, planID); err != nil {
		_ = os.RemoveAll(dir)
		return Transaction{}, err
	}
	if err := m.RecordStatus(tx, sessionID, planID, "prepared", "rollback baseline captured; host apply pending"); err != nil {
		_ = os.RemoveAll(dir)
		return Transaction{}, err
	}
	cleanup = false
	return tx, nil
}

func (m *Manager) extendPendingBatch(base, lockPath, stageLockPath, sessionID, planID string, patches []string) (Transaction, error) {
	status, err := m.LastStatus()
	if err != nil || !extendablePendingPhase(status.Phase) {
		return Transaction{}, ErrBusy
	}
	if err := acquireLock(stageLockPath); err != nil {
		return Transaction{}, ErrBusy
	}
	releaseStage := true
	defer func() {
		if releaseStage {
			_ = os.Remove(stageLockPath)
		}
	}()
	latest, err := m.LastStatus()
	if err != nil || !extendablePendingPhase(latest.Phase) || latest.Transaction != status.Transaction {
		return Transaction{}, ErrBusy
	}
	tx, err := m.transactionFromStatus(latest)
	if errors.Is(err, ErrTransactionMetadataMismatch) {
		metadata, repairErr := m.repairTransactionMetadata(latest, tx)
		if repairErr != nil {
			return Transaction{}, repairErr
		}
		tx.PreTransactionSHA = metadata.PreTransactionSHA
		tx.ActivationImpacts = recoveredActivationImpacts(metadata.ActivationImpacts)
		err = nil
	}
	if err != nil {
		return Transaction{}, err
	}
	tx.lockPath = lockPath
	tx.stageLockPath = stageLockPath
	tx.Extended = true
	tx.ActivationImpacts = mergeActivationImpacts(tx.ActivationImpacts, activationImpacts(patches))
	tx.PreviousPending = PendingPlan{SessionID: latest.SessionID, PlanID: latest.PlanID}
	if plans, plansErr := tx.PendingPlans(); plansErr == nil {
		tx.ExtensionAddedPlan = true
		for _, pending := range plans {
			if pending.SessionID == sessionID && pending.PlanID == planID {
				tx.ExtensionAddedPlan = false
				break
			}
		}
	}
	if err := m.RecordStatus(tx, sessionID, planID, "preparing", "extending pending self-evolution batch without restarting the running runtime"); err != nil {
		return Transaction{}, err
	}
	if err := tx.captureSource(patches); err != nil {
		_ = m.RecordStatus(tx, latest.SessionID, latest.PlanID, "restart_pending", "previous pending batch retained after extension preparation failed")
		return Transaction{}, err
	}
	if err := tx.appendPendingPlan(sessionID, planID); err != nil {
		_ = m.RecordStatus(tx, latest.SessionID, latest.PlanID, "restart_pending", "previous pending batch retained after extension metadata failed")
		return Transaction{}, err
	}
	if err := m.RecordStatus(tx, sessionID, planID, "prepared", "pending batch extended; host apply pending"); err != nil {
		_ = m.RecordStatus(tx, latest.SessionID, latest.PlanID, "restart_pending", "previous pending batch retained after extension status update failed")
		return Transaction{}, err
	}
	releaseStage = false
	return tx, nil
}
