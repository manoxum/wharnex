package selfevolution

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"kernl.local/harness/backend/internal/sandbox"
)

var (
	ErrBusy                            = errors.New("another Wharness self-evolution transaction is already active")
	ErrSelfEvolutionInProgress         = errors.New("a Wharness self-evolution restart is already in progress")
	errTransactionDirectoryUnavailable = errors.New("self-evolution transaction directory is unavailable")
	// ErrHostBuildToolchainMismatch marks a BuildHost failure that no source
	// patch can fix: the host's installed toolchain (observed: Node.js) is
	// older than a pinned dependency's engine requirement (observed:
	// Electron requiring a newer Node than `make build-stage` found on the
	// host). Callers must never route a cause matching this sentinel into
	// the ChatGPT repair loop.
	ErrHostBuildToolchainMismatch = errors.New("self-evolution host build failed due to a host toolchain mismatch, not a source defect")
	// ErrRollbackUnsafe marks a Transaction.Rollback refusal: the host's real
	// Git HEAD advanced past this transaction's own pre-transaction baseline
	// with changes overlapping the exact paths Rollback would otherwise
	// silently overwrite by raw file copy. See Rollback's doc comment.
	ErrRollbackUnsafe = errors.New("self-evolution rollback refused: host git history advanced with overlapping unrelated changes since this transaction's baseline")
	runtimeInstanceID = makeInstanceID()
)

// hostToolchainMismatchMarkers are literal substrings observed in real
// `make build-stage` output when a pinned dependency's install/postinstall
// step fails because the host's own runtime is too old to run it — not
// because of anything in the patched source. Kept narrow and literal
// (rather than a broad EBADENGINE match, which is only ever a warning and
// fires on every build): a false positive here would silently swallow a
// genuine, repairable source defect.
var hostToolchainMismatchMarkers = []string{
	"ERR_REQUIRE_ESM",
	"Electron failed to install correctly",
}

func IsHostToolchainMismatch(output string) bool {
	for _, marker := range hostToolchainMismatchMarkers {
		if strings.Contains(output, marker) {
			return true
		}
	}
	return false
}

func makeInstanceID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type Manager struct {
	root string
}

type Status struct {
	Phase       string
	SessionID   string
	PlanID      string
	Transaction string
	UpdatedAt   string
	Detail      string
}

type Transaction struct {
	ID             string
	Root           string
	Dir            string
	Worker         string
	RollbackScript string
	// PreTransactionSHA is the host's real Git HEAD captured when this
	// transaction's source backups were taken (empty when the host has no
	// Git repository, or for a transaction created before this field
	// existed). See Rollback.
	PreTransactionSHA string
	lockPath          string
	stageLockPath     string
}

type PendingPlan struct {
	SessionID string `json:"session_id"`
	PlanID    string `json:"plan_id"`
}

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
		return Transaction{}, errors.New("Wharness runtime root is not available")
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
	tx := Transaction{ID: id, Root: m.root, Dir: dir, Worker: filepath.Join(dir, "worker.sh"), RollbackScript: filepath.Join(dir, "rollback.sh"), lockPath: lockPath, stageLockPath: stageLockPath}
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
		err = nil
	}
	if err != nil {
		return Transaction{}, err
	}
	tx.lockPath = lockPath
	tx.stageLockPath = stageLockPath
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

func (m *Manager) LastStatus() (Status, error) {
	if !m.Enabled() {
		return Status{}, errors.New("Wharness runtime root is not available")
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
		return Transaction{}, errors.New("Wharness runtime root is not available")
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
		return Transaction{}, PendingPlan{}, errors.New("Wharness runtime root is not available")
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
	} else if errors.Is(metaErr, ErrTransactionMetadataMismatch) {
		return tx, metaErr
	}
	return tx, nil
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
		return transactionMetadata{}, fmt.Errorf("%w: retained metadata root does not resolve to the active Wharness root", ErrTransactionMetadataMismatch)
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
		return Transaction{}, errors.New("Wharness runtime root is not available")
	}
	return m.transactionFromStatus(status)
}

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

func sanitizeDetail(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 400 {
		value = value[:400]
	}
	return value
}

// BuildOutputCallback receives incremental chunks of `make build-stage`
// output as they are produced. It exists so the host build — which can run
// for minutes (dependency hydration, npm ci, vite/tsc, go build) — can be
// shown live instead of appearing to hang until it finally succeeds or
// fails; see buildOutputWriter.
type BuildOutputCallback func(stream, text string)

// buildOutputWriter both accumulates the full output (limitedBuffer already
// bounds it) and forwards each chunk to onOutput as it is written, so the
// caller can publish it immediately rather than waiting for cmd.Run to
// return the complete text.
type buildOutputWriter struct {
	stream     string
	buffer     *limitedBuffer
	onOutput   BuildOutputCallback
	callbackMu *sync.Mutex
}

func (w *buildOutputWriter) Write(p []byte) (int, error) {
	n, err := w.buffer.Write(p)
	if w.onOutput != nil && len(p) > 0 {
		w.callbackMu.Lock()
		w.onOutput(w.stream, string(p))
		w.callbackMu.Unlock()
	}
	return n, err
}

func (m *Manager) BuildHost(ctx context.Context, tx Transaction, onOutput BuildOutputCallback) (string, error) {
	if tx.Root != m.root || tx.Dir == "" {
		return "", errors.New("invalid self-evolution transaction")
	}
	before, err := buildGuardSnapshot(m.root)
	if err != nil {
		return "", fmt.Errorf("capture pre-build source guard: %w", err)
	}
	cmd := exec.CommandContext(ctx, "make", "build-stage")
	cmd.Dir = m.root
	cmd.Env = append(os.Environ(), "WHARNESS_SELF_EVOLUTION=1")
	var output limitedBuffer
	var callbackMu sync.Mutex
	cmd.Stdout = &buildOutputWriter{stream: "stdout", buffer: &output, onOutput: onOutput, callbackMu: &callbackMu}
	cmd.Stderr = &buildOutputWriter{stream: "stderr", buffer: &output, onOutput: onOutput, callbackMu: &callbackMu}
	err = cmd.Run()
	text := strings.TrimSpace(output.String())
	if err != nil {
		if IsHostToolchainMismatch(text) {
			return text, fmt.Errorf("%w: self-evolution host build failed: %w", ErrHostBuildToolchainMismatch, err)
		}
		return text, fmt.Errorf("self-evolution host build failed: %w", err)
	}
	after, guardErr := buildGuardSnapshot(m.root)
	if guardErr != nil {
		return text, fmt.Errorf("capture post-build source guard: %w", guardErr)
	}
	if changed := changedGuardPaths(before, after); len(changed) > 0 {
		return text, fmt.Errorf("self-evolution host build mutated source dependency metadata outside the verified patch result: %s", strings.Join(changed, ", "))
	}
	return text, nil
}

func buildGuardSnapshot(root string) (map[string]string, error) {
	state := make(map[string]string, len(buildGuardPaths))
	for _, relative := range buildGuardPaths {
		path := filepath.Join(root, relative)
		data, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			state[relative] = "<absent>"
			continue
		}
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		state[relative] = hex.EncodeToString(sum[:])
	}
	return state, nil
}

func changedGuardPaths(before, after map[string]string) []string {
	changed := make([]string, 0)
	for _, relative := range buildGuardPaths {
		if before[relative] != after[relative] {
			changed = append(changed, relative)
		}
	}
	return changed
}

func (m *Manager) ScheduleRestart(tx Transaction, sessionID, planID string) error {
	if tx.Root != m.root || tx.Worker == "" {
		return errors.New("invalid self-evolution transaction")
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("WHARNESS_SERVICES_MODE")), "stack") {
		return m.scheduleStackRestart(tx, sessionID, planID)
	}
	logPath := filepath.Join(m.root, ".harness", "logs", "self-evolution.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return err
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer logFile.Close()
	cmd := exec.Command(tx.Worker, m.root, tx.Dir, sanitizeLabel(sessionID), sanitizeLabel(planID))
	cmd.Dir = m.root
	cmd.Env = append(os.Environ(), "WHARNESS_ROOT="+m.root)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start detached self-restart worker: %w", err)
	}
	return cmd.Process.Release()
}

func (m *Manager) scheduleStackRestart(tx Transaction, sessionID, planID string) error {
	image := strings.TrimSpace(os.Getenv("WHARNESS_BACKEND_IMAGE"))
	dockerGID := strings.TrimSpace(os.Getenv("WHARNESS_DOCKER_GID"))
	home := strings.TrimSpace(os.Getenv("HOME"))
	if image == "" || dockerGID == "" || home == "" {
		return errors.New("stack self-restart environment is incomplete")
	}
	name := "wharness-self-restart-" + sanitizeLabel(tx.ID)
	args := []string{
		"run", "-d", "--rm", "--name", name,
		"--network", "host",
		"--user", fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()),
		"--group-add", dockerGID,
		"-e", "HOME=" + home,
		"-e", "WHARNESS_ROOT=" + m.root,
		"-e", "WHARNESS_SERVICES_MODE=stack",
		"-e", "WHARNESS_BACKEND_IMAGE=" + image,
		"-e", "WHARNESS_DOCKER_GID=" + dockerGID,
		"-v", home + ":" + home,
		"-v", "/var/run/docker.sock:/var/run/docker.sock",
		"--entrypoint", tx.Worker,
		image,
		m.root, tx.Dir, sanitizeLabel(sessionID), sanitizeLabel(planID),
	}
	output, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("start stack self-restart supervisor: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

// Rollback restores this transaction's captured pre-patch file snapshots by
// raw file copy — it does not go through Git at all, by design, since it
// must work even when Root has no Git repository. When Root IS a Git
// repository (every real Wharness project, since projectgit.Ensure
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
			changed, diffErr := sandbox.ChangedPathsBetween(ctx, tx.Root, tx.PreTransactionSHA, currentSHA)
			if backupErr != nil || diffErr != nil {
				// Can't verify safety — fail closed rather than risk silently
				// discarding unrelated work.
				return fmt.Errorf("%w: unable to verify host history since baseline %s: backup=%v diff=%v", ErrRollbackUnsafe, tx.PreTransactionSHA, backupErr, diffErr)
			}
			if overlap := overlappingPaths(backups, changed); len(overlap) > 0 {
				return fmt.Errorf("%w: host advanced from %s to %s with unrelated changes to %s", ErrRollbackUnsafe, tx.PreTransactionSHA, currentSHA, strings.Join(overlap, ", "))
			}
		}
	}
	cmd := exec.Command(tx.RollbackScript, tx.Root, tx.Dir)
	cmd.Dir = tx.Root
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("rollback failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
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

func sanitizeLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	var cleaned strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("._-", r) {
			cleaned.WriteRune(r)
		}
		if cleaned.Len() >= 180 {
			break
		}
	}
	if cleaned.Len() == 0 {
		return "unknown"
	}
	return cleaned.String()
}

func canonicalPath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("empty path")
	}
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	return filepath.Clean(resolved), nil
}

func ascendForRoot(start string) string {
	current, err := canonicalPath(start)
	if err != nil {
		return ""
	}
	for range 8 {
		if looksLikeWharness(current) {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return ""
}

func looksLikeWharness(root string) bool {
	for _, relative := range []string{"Makefile", "scripts/start.sh", "services/backend/go.mod", "services/desktop/package.json"} {
		if info, err := os.Stat(filepath.Join(root, relative)); err != nil || info.IsDir() {
			return false
		}
	}
	return true
}

func acquireActiveLock(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		_, _ = fmt.Fprintf(file, "pid=%d\nrun_id=%s\ncreated=%s\n", os.Getpid(), runtimeInstanceID, time.Now().UTC().Format(time.RFC3339Nano))
		return file.Close()
	}
	if errors.Is(err, os.ErrExist) {
		return ErrBusy
	}
	return err
}

func activeLockOwnerAlive(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(key) != "run_id" {
			continue
		}
		return strings.TrimSpace(value) == runtimeInstanceID
	}
	// No run_id: the lock predates run-id stamping, so its owner cannot be
	// this runtime instance. Its `pid` is deliberately NOT consulted: the
	// backend runs as PID 1 inside its own container, so a recorded `pid=1`
	// answers "alive" for every future backend process too and the lock can
	// never be reclaimed. That is not hypothetical — an orphaned stage.lock
	// holding `pid=1` blocked every self-evolution host apply for hours,
	// and because each blocked apply asks ChatGPT for a correction that
	// cannot possibly release a local lock file, it turned into an
	// unbounded request/repair ping-pong. Treat it as stale and let the
	// caller reclaim it.
	return false
}

func extendablePendingPhase(phase string) bool {
	return phase == "restart_pending" || phase == "restart_failed"
}

func persistentSelfEvolutionPhase(phase string) bool {
	switch phase {
	case "restart_pending", "restart_failed", "restart_scheduled", "restarting", "rollback_runtime", "rollback_restored", "rollback_deps", "rollback_failed":
		return true
	default:
		return false
	}
}

func acquireLock(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		// run_id is what makes this lock reclaimable after a crash or
		// restart: activeLockOwnerAlive can only recognize a lock as stale
		// when it can tell which runtime instance wrote it. A pid alone is
		// useless here (the backend is PID 1 in its container).
		_, _ = fmt.Fprintf(file, "pid=%d\nrun_id=%s\ncreated=%s\n", os.Getpid(), runtimeInstanceID, time.Now().UTC().Format(time.RFC3339Nano))
		return file.Close()
	}
	if !errors.Is(err, os.ErrExist) {
		return err
	}
	if !activeLockOwnerAlive(path) {
		_ = os.Remove(path)
		return acquireLock(path)
	}
	return ErrBusy
}

func transactionID() string {
	var raw [6]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return time.Now().UTC().Format("20060102T150405") + "-" + hex.EncodeToString(raw[:])
	}
	return fmt.Sprintf("%d", time.Now().UTC().UnixNano())
}

type limitedBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	const limit = 512 * 1024
	original := len(p)
	if b.buffer.Len() < limit {
		remaining := limit - b.buffer.Len()
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.buffer.Write(p)
	}
	return original, nil
}

func (b *limitedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

func copyFile(source, destination string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode.Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func uniqueSorted(values map[string]struct{}) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
