package selfevolution

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func New(root string) *Manager {
	canonical, _ := canonicalPath(root)
	return &Manager{root: canonical}
}

func DiscoverRoot() string {
	if value := strings.TrimSpace(os.Getenv("WHARNESS_ROOT")); value != "" {
		if root, err := canonicalPath(value); err == nil && looksLikeWharness(root) {
			return root
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		if root := ascendForRoot(cwd); root != "" {
			return root
		}
	}
	if executable, err := os.Executable(); err == nil {
		if root := ascendForRoot(filepath.Dir(executable)); root != "" {
			return root
		}
	}
	return ""
}

func (m *Manager) Enabled() bool { return m != nil && m.root != "" }
func (m *Manager) Root() string {
	if m == nil {
		return ""
	}
	return m.root
}

func (m *Manager) IsProject(project string) bool {
	if !m.Enabled() {
		return false
	}
	canonical, err := canonicalPath(project)
	return err == nil && canonical == m.root
}

func (m *Manager) Prepare(sessionID, planID string, patches []string) (Transaction, error) {
	if !m.Enabled() {
		return Transaction{}, errors.New("Wharnex runtime root is not available")
	}
	if len(patches) == 0 {
		return Transaction{}, errors.New("self-evolution requires at least one patch")
	}
	base := filepath.Join(m.root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		return Transaction{}, fmt.Errorf("create self-evolution directory: %w", err)
	}
	lockPath := filepath.Join(base, "active.lock")
	stageLockPath := filepath.Join(base, "stage.lock")
	if err := acquireActiveLock(lockPath); err == nil {
		if status, statusErr := m.LastStatus(); statusErr == nil && extendablePendingPhase(status.Phase) {
			tx, extendErr := m.extendPendingBatch(base, lockPath, stageLockPath, sessionID, planID, patches)
			if extendErr != nil {
				_ = os.Remove(lockPath)
			}
			return tx, extendErr
		}
		if err := acquireLock(stageLockPath); err != nil {
			_ = os.Remove(lockPath)
			return Transaction{}, err
		}
		return m.prepareNewBatch(base, lockPath, stageLockPath, sessionID, planID, patches)
	} else if !errors.Is(err, ErrBusy) {
		return Transaction{}, err
	}
	status, statusErr := m.LastStatus()
	if statusErr == nil && extendablePendingPhase(status.Phase) {
		return m.extendPendingBatch(base, lockPath, stageLockPath, sessionID, planID, patches)
	}
	if activeLockOwnerAlive(lockPath) {
		return Transaction{}, ErrBusy
	}
	if statusErr != nil || !persistentSelfEvolutionPhase(status.Phase) {
		_ = os.Remove(lockPath)
		return m.Prepare(sessionID, planID, patches)
	}
	if held := m.blockedTransaction(status); held != nil {
		if _, txErr := m.transactionFromStatus(status); txErr == nil {
			return Transaction{}, held
		}
	}
	if _, txErr := m.transactionFromStatus(status); txErr != nil {
		if !errors.Is(txErr, errTransactionDirectoryUnavailable) {
			return Transaction{}, txErr
		}
		// The status file still claims a fail-closed phase (e.g.
		// rollback_failed) that is meant to hold the batch lock for manual
		// recovery, but the transaction directory it points to no longer
		// exists on disk — there is no rollback baseline, source backup or
		// pending-plan list left to protect. Continuing to refuse here would
		// not guard anything real; it would only deadlock every future
		// self-evolution apply behind an unrecoverable ErrBusy that no
		// ChatGPT-side correction can ever resolve, because nothing short of
		// removing this local lock file can release it. Treat the orphaned
		// record as reclaimable and leave an audit trail of why.
		m.logRecovery(fmt.Sprintf("lock_reclaimed plan=%s orphaned %s (phase=%s) has no transaction directory on disk; automatically releasing the stale batch lock for recovery: %s", sanitizeLabel(planID), status.Transaction, status.Phase, txErr))
		_ = os.Remove(lockPath)
		return m.Prepare(sessionID, planID, patches)
	}
	return Transaction{}, ErrBusy
}

// blockedTransaction describes a fail-closed transaction that is holding the
// batch lock, so the refusal can name what an operator has to decide.
// BlockedStatus exposes blockedTransaction so the application layer can show
// the operator what is holding self-evolution without duplicating the phase
// classification.
func (m *Manager) BlockedStatus(status Status) *BlockedTransactionError {
	return m.blockedTransaction(status)
}

func (m *Manager) blockedTransaction(status Status) *BlockedTransactionError {
	// An extendable pending phase is a batch legitimately waiting for its
	// restart, not a fail-closed block: Prepare joins it rather than refusing,
	// and offering to release it would discard work that is still on its way.
	if !persistentSelfEvolutionPhase(status.Phase) || extendablePendingPhase(status.Phase) {
		return nil
	}
	return &BlockedTransactionError{
		Phase:       status.Phase,
		Transaction: status.Transaction,
		PlanID:      status.PlanID,
		Detail:      status.Detail,
		Remedy: "inspect that transaction's recorded baseline under .harness/self-evolution/" + status.Transaction +
			", finish the recovery it describes, then release it explicitly to allow self-evolution again",
	}
}

// ReleaseBlockedTransaction is the operator's explicit acknowledgement that a
// fail-closed transaction has been dealt with, and the only supported way to
// free the batch lock it holds.
//
// It is deliberately narrow. The caller must name the exact transaction, which
// makes releasing an accident impossible and makes the audit trail say which
// state a human actually looked at. Only a fail-closed phase is releasable: a
// live or pending transaction is real work and must never be freed from under
// itself. The transaction directory is left on disk, because it holds the
// rollback baseline and source backup that are the evidence for whatever the
// operator just did.
func (m *Manager) ReleaseBlockedTransaction(transactionID string) (Status, error) {
	transactionID = strings.TrimSpace(transactionID)
	if transactionID == "" {
		return Status{}, errors.New("the transaction to release must be named")
	}
	status, err := m.LastStatus()
	if err != nil {
		return Status{}, fmt.Errorf("read self-evolution status: %w", err)
	}
	if status.Transaction != transactionID {
		return Status{}, fmt.Errorf("transaction %s does not hold the self-evolution lock; %s does", transactionID, status.Transaction)
	}
	if m.blockedTransaction(status) == nil {
		return Status{}, fmt.Errorf("transaction %s is in phase %q, which is active work rather than a fail-closed state", transactionID, status.Phase)
	}
	base := filepath.Join(m.root, ".harness", "self-evolution")
	m.logRecovery(fmt.Sprintf("lock_released_by_operator transaction=%s phase=%s plan=%s detail=%s",
		sanitizeLabel(transactionID), sanitizeLabel(status.Phase), sanitizeLabel(status.PlanID), sanitizeLabel(status.Detail)))
	_ = os.Remove(filepath.Join(base, "stage.lock"))
	if err := os.Remove(filepath.Join(base, "active.lock")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return Status{}, fmt.Errorf("release self-evolution lock: %w", err)
	}
	released := status
	released.Phase = "released"
	released.Detail = "released by the operator after " + status.Phase
	if err := m.recordReleasedStatus(released); err != nil {
		return Status{}, err
	}
	return released, nil
}
