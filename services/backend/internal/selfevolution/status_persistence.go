package selfevolution

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// logRecovery appends one line to the same self-evolution.log the detached
// worker writes to, in the same "[timestamp] self-evolution <rest>" shape,
// so an automatic backend-side recovery decision is visible next to the
// worker's own phase transitions instead of only living in backend process
// logs that rotate away. Best-effort: a logging failure must never block the
// recovery it is describing.
func (m *Manager) logRecovery(line string) {
	logPath := filepath.Join(m.root, ".harness", "logs", "self-evolution.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return
	}
	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = fmt.Fprintf(file, "[%s] self-evolution %s\n", time.Now().UTC().Format(time.RFC3339), line)
}

func (m *Manager) RecordStatus(tx Transaction, sessionID, planID, phase, detail string) error {
	if !m.Enabled() || tx.Root != m.root || tx.ID == "" {
		return errors.New("invalid self-evolution transaction")
	}
	base := filepath.Join(m.root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		return err
	}
	statusPath := filepath.Join(base, "status")
	temp, err := os.CreateTemp(base, ".status-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	_, writeErr := fmt.Fprintf(temp, "phase=%s\nsession_id=%s\nplan_id=%s\ntransaction=txn-%s\nupdated_at=%s\n", sanitizeLabel(phase), sanitizeLabel(sessionID), sanitizeLabel(planID), sanitizeLabel(tx.ID), time.Now().UTC().Format(time.RFC3339))
	if clean := sanitizeDetail(detail); clean != "" {
		_, _ = fmt.Fprintf(temp, "detail=%s\n", clean)
	}
	if closeErr := temp.Close(); writeErr != nil {
		return writeErr
	} else if closeErr != nil {
		return closeErr
	}
	return os.Rename(tempPath, statusPath)
}

// recordReleasedStatus persists the outcome of an operator release. It writes
// the same record shape RecordStatus does, but takes a Status rather than a
// live Transaction: by this point the transaction is finished and its lock is
// gone, so there is no Transaction left to hold.
func (m *Manager) recordReleasedStatus(status Status) error {
	base := filepath.Join(m.root, ".harness", "self-evolution")
	if err := os.MkdirAll(base, 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(base, ".status-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	_, writeErr := fmt.Fprintf(temp, "phase=%s\nsession_id=%s\nplan_id=%s\ntransaction=%s\nupdated_at=%s\n",
		sanitizeLabel(status.Phase), sanitizeLabel(status.SessionID), sanitizeLabel(status.PlanID),
		sanitizeLabel(status.Transaction), time.Now().UTC().Format(time.RFC3339))
	if clean := sanitizeDetail(status.Detail); clean != "" {
		_, _ = fmt.Fprintf(temp, "detail=%s\n", clean)
	}
	if closeErr := temp.Close(); writeErr != nil {
		return writeErr
	} else if closeErr != nil {
		return closeErr
	}
	return os.Rename(tempPath, filepath.Join(base, "status"))
}

func sanitizeDetail(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 400 {
		value = value[:400]
	}
	return value
}
