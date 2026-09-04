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
	"syscall"
	"time"
)

var ErrBusy = errors.New("another Wharness self-evolution transaction is already active")

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
	lockPath       string
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

func (m *Manager) Prepare(planID string, patches []string) (Transaction, error) {
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
	if err := acquireLock(lockPath); err != nil {
		return Transaction{}, err
	}
	cleanupLock := true
	defer func() {
		if cleanupLock {
			_ = os.Remove(lockPath)
		}
	}()

	id := transactionID()
	dir := filepath.Join(base, "txn-"+id)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return Transaction{}, fmt.Errorf("create transaction: %w", err)
	}
	tx := Transaction{ID: id, Root: m.root, Dir: dir, Worker: filepath.Join(dir, "worker.sh"), RollbackScript: filepath.Join(dir, "rollback.sh"), lockPath: lockPath}
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
	if err := tx.writeMetadata(planID); err != nil {
		_ = os.RemoveAll(dir)
		return Transaction{}, err
	}
	cleanupLock = false
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
	if err != nil {
		return Transaction{}, err
	}
	if status.Phase != "restart_pending" || status.SessionID != sessionID || status.PlanID != planID {
		return Transaction{}, errors.New("matching self-evolution restart transaction is not pending")
	}
	transactionName := sanitizeLabel(status.Transaction)
	if transactionName == "" || transactionName != status.Transaction || !strings.HasPrefix(transactionName, "txn-") {
		return Transaction{}, errors.New("invalid pending self-evolution transaction reference")
	}
	id := strings.TrimPrefix(transactionName, "txn-")
	if id == "" {
		return Transaction{}, errors.New("invalid pending self-evolution transaction id")
	}
	dir := filepath.Join(m.root, ".harness", "self-evolution", transactionName)
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return Transaction{}, errors.New("pending self-evolution transaction directory is unavailable")
	}
	return Transaction{ID: id, Root: m.root, Dir: dir, Worker: filepath.Join(dir, "worker.sh"), RollbackScript: filepath.Join(dir, "rollback.sh"), lockPath: filepath.Join(m.root, ".harness", "self-evolution", "active.lock")}, nil
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

func (m *Manager) BuildHost(ctx context.Context, tx Transaction) (string, error) {
	if tx.Root != m.root || tx.Dir == "" {
		return "", errors.New("invalid self-evolution transaction")
	}
	before, err := buildGuardSnapshot(m.root)
	if err != nil {
		return "", fmt.Errorf("capture pre-build source guard: %w", err)
	}
	cmd := exec.CommandContext(ctx, "make", "build")
	cmd.Dir = m.root
	cmd.Env = append(os.Environ(), "WHARNESS_SELF_EVOLUTION=1")
	var output limitedBuffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	err = cmd.Run()
	text := strings.TrimSpace(output.String())
	if err != nil {
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

func (tx Transaction) Rollback() error {
	if tx.RollbackScript == "" || tx.Root == "" {
		return errors.New("invalid self-evolution rollback transaction")
	}
	cmd := exec.Command(tx.RollbackScript, tx.Root, tx.Dir)
	cmd.Dir = tx.Root
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("rollback failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func (tx Transaction) Release() {
	if tx.lockPath != "" {
		_ = os.Remove(tx.lockPath)
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

func acquireLock(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		_, _ = fmt.Fprintf(file, "pid=%d\ncreated=%s\n", os.Getpid(), time.Now().UTC().Format(time.RFC3339Nano))
		return file.Close()
	}
	if !errors.Is(err, os.ErrExist) {
		return err
	}
	if info, statErr := os.Stat(path); statErr == nil && time.Since(info.ModTime()) > time.Hour {
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

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	const limit = 512 * 1024
	original := len(p)
	if b.Len() < limit {
		remaining := limit - b.Len()
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.Buffer.Write(p)
	}
	return original, nil
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
