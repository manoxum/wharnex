package selfevolution

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func (m *Manager) transactionFromStatus(status Status) (Transaction, error) {
	transactionName := sanitizeLabel(status.Transaction)
	if transactionName == "" || transactionName != status.Transaction || !strings.HasPrefix(transactionName, "txn-") {
		return Transaction{}, errors.New("invalid self-evolution transaction reference")
	}
	id := strings.TrimPrefix(transactionName, "txn-")
	if id == "" {
		return Transaction{}, errors.New("invalid self-evolution transaction id")
	}
	dir := filepath.Join(m.root, ".harness", "self-evolution", transactionName)
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return Transaction{}, errTransactionDirectoryUnavailable
	}
	tx := Transaction{ID: id, Root: m.root, Dir: dir, Worker: filepath.Join(dir, "worker.sh"), RollbackScript: filepath.Join(dir, "rollback.sh"), lockPath: filepath.Join(m.root, ".harness", "self-evolution", "active.lock")}
	// Best-effort: an older transaction created before PreTransactionSHA
	// existed simply rolls back without the overlap safety check below,
	// exactly like before this field was introduced. Identity mismatches are
	// surfaced to the caller; extension is the only path that repairs them,
	// after it owns the short-lived stage lock.
	metadata, metaErr := tx.readMetadata()
	if metaErr == nil {
		tx.PreTransactionSHA = metadata.PreTransactionSHA
		tx.ActivationImpacts = recoveredActivationImpacts(metadata.ActivationImpacts)
	} else if errors.Is(metaErr, ErrTransactionMetadataMismatch) {
		return tx, metaErr
	}
	return tx, nil
}

func recoveredActivationImpacts(persisted []string) []string {
	if persisted == nil {
		return []string{"backend", "desktop", "frontend", "gateway", "tunnel", "webapp"}
	}
	return append([]string{}, persisted...)
}

func (m *Manager) repairTransactionMetadata(status Status, tx Transaction) (transactionMetadata, error) {
	metadata, err := tx.readMetadataUnchecked()
	if err != nil {
		return transactionMetadata{}, fmt.Errorf("%w: cannot read retained metadata: %v", ErrTransactionMetadataMismatch, err)
	}
	if !extendablePendingPhase(status.Phase) {
		return transactionMetadata{}, fmt.Errorf("%w: phase %s is not safe for automatic identity repair", ErrTransactionMetadataMismatch, status.Phase)
	}
	if !m.retainedMetadataRootMatches(metadata) {
		return transactionMetadata{}, fmt.Errorf("%w: retained metadata root does not resolve to the active Wharnex root", ErrTransactionMetadataMismatch)
	}
	memberFound := false
	for _, pending := range metadata.Plans {
		if pending.SessionID == status.SessionID && pending.PlanID == status.PlanID {
			memberFound = true
			break
		}
	}
	if status.SessionID == "" || status.PlanID == "" || !memberFound {
		return transactionMetadata{}, fmt.Errorf("%w: status member is absent from retained pending-plan metadata", ErrTransactionMetadataMismatch)
	}
	if err := validateRetainedTransactionArtifacts(tx); err != nil {
		return transactionMetadata{}, fmt.Errorf("%w: %v", ErrTransactionMetadataMismatch, err)
	}
	previousID := metadata.TransactionID
	if previousID != "" && previousID != tx.ID {
		previousName := "txn-" + previousID
		if sanitizeLabel(previousName) == previousName {
			if info, statErr := os.Stat(filepath.Join(m.root, ".harness", "self-evolution", previousName)); statErr == nil && info.IsDir() {
				return transactionMetadata{}, fmt.Errorf("%w: retained metadata names another transaction directory that still exists", ErrTransactionMetadataMismatch)
			}
		}
	}
	metadata.TransactionID = tx.ID
	metadata.Root = m.root
	if err := tx.saveMetadata(metadata); err != nil {
		return transactionMetadata{}, fmt.Errorf("%w: persist verified identity repair: %v", ErrTransactionMetadataMismatch, err)
	}
	m.logRecovery(fmt.Sprintf("metadata_repaired transaction=%s previous_transaction=%s phase=%s session=%s plan=%s", sanitizeLabel(tx.ID), sanitizeLabel(previousID), sanitizeLabel(status.Phase), sanitizeLabel(status.SessionID), sanitizeLabel(status.PlanID)))
	return metadata, nil
}

func (m *Manager) retainedMetadataRootMatches(metadata transactionMetadata) bool {
	metadataRoot, err := canonicalPath(metadata.Root)
	if err == nil {
		return metadataRoot == m.root
	}

	// A project-root rename moves .harness together with the checkout while
	// transaction.json necessarily retains the old absolute root. Allow that
	// one recoverable shape only when the former root is actually gone and the
	// transaction's captured Git baseline is still an ancestor of this active
	// checkout. Existing-but-different roots, non-Git legacy transactions and
	// unrelated repositories remain fail-closed.
	storedRoot := filepath.Clean(strings.TrimSpace(metadata.Root))
	if !errors.Is(err, os.ErrNotExist) || !filepath.IsAbs(storedRoot) || metadata.PreTransactionSHA == "" {
		return false
	}
	if _, statErr := os.Stat(storedRoot); !errors.Is(statErr, os.ErrNotExist) {
		return false
	}
	return gitCommitIsAncestor(m.root, metadata.PreTransactionSHA)
}

func gitCommitIsAncestor(root, ancestor string) bool {
	ancestor = strings.TrimSpace(ancestor)
	if ancestor == "" {
		return false
	}
	repoCmd := exec.Command("git", "-C", root, "rev-parse", "--show-toplevel")
	repoCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	repoOutput, err := repoCmd.Output()
	if err != nil {
		return false
	}
	repoRoot, err := canonicalPath(strings.TrimSpace(string(repoOutput)))
	if err != nil || repoRoot != root {
		return false
	}
	cmd := exec.Command("git", "-C", root, "merge-base", "--is-ancestor", ancestor, "HEAD")
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	return cmd.Run() == nil
}

func validateRetainedTransactionArtifacts(tx Transaction) error {
	for _, name := range []string{"source-backup.json", "rollback.sh", "worker.sh", "start-known-good.sh", "stop-known-good.sh", "stack-known-good.sh"} {
		info, err := os.Lstat(filepath.Join(tx.Dir, name))
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("retained transaction artifact %s is unavailable", name)
		}
	}
	info, err := os.Stat(filepath.Join(tx.Dir, "runtime"))
	if err != nil || !info.IsDir() {
		return errors.New("retained transaction runtime snapshot is unavailable")
	}
	return nil
}

func (m *Manager) TransactionForStatus(status Status) (Transaction, error) {
	if !m.Enabled() {
		return Transaction{}, errors.New("Wharnex runtime root is not available")
	}
	return m.transactionFromStatus(status)
}
