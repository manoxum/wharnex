package selfevolution

import (
	"fmt"
	"os/exec"
	"strings"
)

// WidenActivationImpacts adds to a built transaction every runtime component
// touched by what the host actually changed since the transaction began —
// its own patches, the pre-merge snapshot of the operator's uncommitted work,
// and anything else committed in between — and persists the result.
//
// `make build-stage` builds the whole tree, so the new runtime already
// contains all of it; deriving activation from the plan's patches alone
// recreated only those components. On 2026-09-25 an engine fix swept into the
// pre-merge snapshot was built into the backend image but never activated,
// because the plan touched only the Desktop, and the old backend kept running.
//
// A transaction without a captured pre-transaction commit keeps its patch
// derived impacts unchanged.
func (m *Manager) WidenActivationImpacts(tx Transaction) (Transaction, error) {
	if strings.TrimSpace(tx.PreTransactionSHA) == "" {
		return tx, nil
	}
	output, err := exec.Command("git", "-C", m.root, "diff", "--name-only", "--no-renames", tx.PreTransactionSHA, "--").Output()
	if err != nil {
		return tx, fmt.Errorf("list host changes since %s: %w", tx.PreTransactionSHA, err)
	}
	paths := strings.Fields(strings.TrimSpace(string(output)))
	widened := mergeActivationImpacts(tx.ActivationImpacts, impactsForPaths(paths))
	if len(widened) == len(tx.ActivationImpacts) {
		return tx, nil
	}
	metadata, err := tx.readMetadata()
	if err != nil {
		return tx, err
	}
	metadata.ActivationImpacts = mergeActivationImpacts(metadata.ActivationImpacts, widened)
	if err := tx.saveMetadata(metadata); err != nil {
		return tx, err
	}
	tx.ActivationImpacts = metadata.ActivationImpacts
	return tx, nil
}
