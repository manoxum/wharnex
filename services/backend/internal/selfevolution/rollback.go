package selfevolution

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"kernl.local/harness/backend/internal/sandbox"
	"os"
	"os/exec"
	"strings"
)

// Rollback restores this transaction's captured pre-patch file snapshots by
// raw file copy — it does not go through Git at all, by design, since it
// must work even when Root has no Git repository. When Root IS a Git
// repository (every real Wharnex project, since projectgit.Ensure
// guarantees it) and PreTransactionSHA was captured, Rollback first checks
// whether host HEAD has advanced past that baseline. If it has, an
// unrelated integration merge may have landed since this transaction
// started — restoring this transaction's stale snapshot over one of the
// exact paths that merge touched would silently discard that unrelated
// work with no error surfaced anywhere (git HEAD would keep claiming the
// merge succeeded while the file on disk reverted underneath it). Rollback
// refuses and returns ErrRollbackUnsafe in that case rather than guessing;
// the caller's existing "rollback_failed" handling already routes any
// Rollback error to human attention, so no caller-side change is needed
// beyond passing ctx through.
func (tx Transaction) Rollback(ctx context.Context) error {
	if tx.RollbackScript == "" || tx.Root == "" {
		return errors.New("invalid self-evolution rollback transaction")
	}
	if tx.PreTransactionSHA != "" {
		currentSHA, shaErr := sandbox.CurrentHeadSHA(ctx, tx.Root)
		if shaErr == nil && currentSHA != tx.PreTransactionSHA {
			backups, backupErr := tx.readSourceBackups()
			changed, diffErr := tx.foreignChangedPaths(ctx, tx.PreTransactionSHA, currentSHA)
			if backupErr != nil || diffErr != nil {
				// Can't verify safety — fail closed rather than risk silently
				// discarding unrelated work.
				return fmt.Errorf("%w: unable to verify host history since baseline %s: backup=%v diff=%v", ErrRollbackUnsafe, tx.PreTransactionSHA, backupErr, diffErr)
			}
			if overlap := overlappingPaths(backups, changed); len(overlap) > 0 {
				diverged, compareErr := tx.divergedBackupPaths(overlap, backups)
				if compareErr != nil {
					return fmt.Errorf("%w: unable to compare overlapping host paths with the captured baseline: %v", ErrRollbackUnsafe, compareErr)
				}
				if len(diverged) > 0 {
					return fmt.Errorf("%w: host advanced from %s to %s with unrelated changes to %s", ErrRollbackUnsafe, tx.PreTransactionSHA, currentSHA, strings.Join(diverged, ", "))
				}
			}
		}
	}
	cmd := exec.Command(tx.RollbackScript, tx.Root, tx.Dir)
	cmd.Dir = tx.Root
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("rollback failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return tx.rewindOwnIntegrationCommits(ctx)
}

// rewindOwnIntegrationCommits returns HEAD to the transaction's baseline when
// every commit after it is Wharnex's own integration bookkeeping. Restoring the
// source alone left HEAD on the failed integration merge, so the worktree read
// as reverting a change HEAD claimed and the next request saw an unstable
// baseline. A mixed reset keeps the restored files and any pre-transaction
// uncommitted work as they are; a commit by anyone else leaves HEAD untouched.
func (tx Transaction) rewindOwnIntegrationCommits(ctx context.Context) error {
	if tx.PreTransactionSHA == "" {
		return nil
	}
	current, err := sandbox.CurrentHeadSHA(ctx, tx.Root)
	if err != nil || current == tx.PreTransactionSHA {
		return nil
	}
	if exec.CommandContext(ctx, "git", "-C", tx.Root, "merge-base", "--is-ancestor", tx.PreTransactionSHA, current).Run() != nil {
		return nil
	}
	authors, err := exec.CommandContext(ctx, "git", "-C", tx.Root, "log", "--format=%an", tx.PreTransactionSHA+".."+current).Output()
	if err != nil {
		return nil
	}
	for _, author := range strings.Split(strings.TrimSpace(string(authors)), "\n") {
		if author != "Wharnex" && !strings.HasPrefix(author, "WHX - ") {
			return nil
		}
	}
	if output, err := exec.CommandContext(ctx, "git", "-C", tx.Root, "reset", "-q", "--mixed", tx.PreTransactionSHA).CombinedOutput(); err != nil {
		return fmt.Errorf("rewind failed integration commits to %s: %w: %s", tx.PreTransactionSHA, err, strings.TrimSpace(string(output)))
	}
	return nil
}

// divergedBackupPaths separates a real concurrent write from Git merely
// committing the exact dirty-tree bytes Prepare already captured. The latter
// is MergeBranchOnHost's preservation snapshot and restoring the backup is a
// no-op; treating the path name alone as evidence of divergence permanently
// parked otherwise recoverable transactions in rollback_failed.
func (tx Transaction) divergedBackupPaths(paths []string, backups []sourceBackup) ([]string, error) {
	byPath := make(map[string]sourceBackup, len(backups))
	for _, backup := range backups {
		byPath[backup.Path] = backup
	}
	diverged := make([]string, 0, len(paths))
	for _, path := range paths {
		backup, ok := byPath[path]
		if !ok {
			return nil, fmt.Errorf("missing source backup metadata for %s", path)
		}
		matches, err := tx.sourceMatchesBackup(backup)
		if err != nil {
			return nil, fmt.Errorf("compare %s: %w", path, err)
		}
		if !matches {
			diverged = append(diverged, path)
		}
	}
	return diverged, nil
}

func (tx Transaction) sourceMatchesBackup(backup sourceBackup) (bool, error) {
	currentPath, err := containedPath(tx.Root, backup.Path)
	if err != nil {
		return false, err
	}
	currentInfo, err := os.Lstat(currentPath)
	if !backup.Existed {
		if errors.Is(err, os.ErrNotExist) {
			return true, nil
		}
		return false, err
	}
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	if !currentInfo.Mode().IsRegular() || uint32(currentInfo.Mode().Perm()) != backup.Mode {
		return false, nil
	}
	backupPath, err := containedPath(tx.Dir, backup.Backup)
	if err != nil {
		return false, err
	}
	current, err := os.ReadFile(currentPath)
	if err != nil {
		return false, err
	}
	captured, err := os.ReadFile(backupPath)
	if err != nil {
		return false, err
	}
	return bytes.Equal(current, captured), nil
}

func overlappingPaths(backups []sourceBackup, changed []string) []string {
	if len(backups) == 0 || len(changed) == 0 {
		return nil
	}
	known := make(map[string]struct{}, len(backups))
	for _, backup := range backups {
		known[backup.Path] = struct{}{}
	}
	overlap := make([]string, 0)
	for _, path := range changed {
		if _, ok := known[path]; ok {
			overlap = append(overlap, path)
		}
	}
	return overlap
}

func (tx Transaction) ReleaseStage() {
	if tx.stageLockPath != "" {
		_ = os.Remove(tx.stageLockPath)
	}
}

func (tx Transaction) Release() {
	tx.ReleaseStage()
	if tx.lockPath != "" {
		_ = os.Remove(tx.lockPath)
	}
}

func (tx Transaction) Finalize() {
	if tx.Dir != "" {
		_ = os.RemoveAll(tx.Dir)
	}
}
